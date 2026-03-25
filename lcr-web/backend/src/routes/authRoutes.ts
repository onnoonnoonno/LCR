/**
 * Auth Routes
 *
 *   POST /api/auth/login           — employee_id + password → JWT
 *   POST /api/auth/change-password — (requireAuth) change own password
 *   GET  /api/auth/me              — (requireAuth) return current user info
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { getPool } from '../db/client';
import { signToken, requireAuth, requireRole } from '../middleware/auth';

export const authRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

const MAX_FAILED_ATTEMPTS = 5;

authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { employeeId, password } = req.body as {
    employeeId?: string;
    password?: string;
  };

  if (!employeeId || !password) {
    res.status(400).json({ success: false, error: 'employeeId and password are required.' });
    return;
  }

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE employee_id = $1',
      [employeeId]
    );
    const user = rows[0] as {
      id: number;
      employee_id: string;
      password_hash: string;
      role: string;
      must_change_password: number;
      failed_login_attempts: number | null;
      is_locked: number | null;
    } | undefined;

    // Check if account is locked (before bcrypt to avoid timing leaks on locked accounts)
    if (user && (user.is_locked ?? 0) === 1) {
      // Still run bcrypt against dummy to prevent timing-based user enumeration
      bcrypt.compareSync(password, '$2b$12$invalidhashpaddingtomakethissafe00000000000000000000000');
      res.status(403).json({ success: false, error: 'Account is locked. Please contact an administrator.' });
      return;
    }

    // Always run bcrypt compare to prevent user-enumeration via timing
    const dummyHash = '$2b$12$invalidhashpaddingtomakethissafe00000000000000000000000';
    const hashToCompare = user ? user.password_hash : dummyHash;
    const match = bcrypt.compareSync(password, hashToCompare);

    if (!user || !match) {
      // Increment failed attempts for existing users
      if (user) {
        try {
          const newAttempts = (user.failed_login_attempts ?? 0) + 1;
          if (newAttempts >= MAX_FAILED_ATTEMPTS) {
            await pool.query(
              'UPDATE users SET failed_login_attempts = $1, is_locked = 1, locked_at = $2 WHERE id = $3',
              [newAttempts, new Date().toISOString(), user.id]
            );
            res.status(403).json({ success: false, error: 'Account has been locked due to too many failed login attempts. Please contact an administrator.' });
            return;
          }
          await pool.query(
            'UPDATE users SET failed_login_attempts = $1 WHERE id = $2',
            [newAttempts, user.id]
          );
        } catch (lockErr) {
          // Columns may not exist yet; don't break login flow
          console.warn('[auth] Failed to update login attempt count:', lockErr);
        }
      }
      res.status(401).json({ success: false, error: 'Invalid employee ID or password.' });
      return;
    }

    // Successful login — reset failed attempts
    try {
      await pool.query(
        'UPDATE users SET failed_login_attempts = 0 WHERE id = $1',
        [user.id]
      );
    } catch (resetErr) {
      console.warn('[auth] Failed to reset login attempt count:', resetErr);
    }

    const mustChangePassword = user.must_change_password === 1;

    const token = signToken({
      userId:             user.id,
      employeeId:         user.employee_id,
      role:               user.role,
      mustChangePassword,
    });

    res.json({
      success: true,
      token,
      mustChangePassword,
      user: {
        id:         user.id,
        employeeId: user.employee_id,
        role:       user.role,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/change-password
// ---------------------------------------------------------------------------

authRouter.post('/change-password', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    res.status(400).json({ success: false, error: 'currentPassword and newPassword are required.' });
    return;
  }

  // Enforce password policy
  const policyErrors: string[] = [];
  if (newPassword.length < 8)           policyErrors.push('at least 8 characters');
  if (!/[A-Z]/.test(newPassword))       policyErrors.push('an uppercase letter');
  if (!/[a-z]/.test(newPassword))       policyErrors.push('a lowercase letter');
  if (!/[0-9]/.test(newPassword))       policyErrors.push('a number');
  if (!/[^A-Za-z0-9]/.test(newPassword)) policyErrors.push('a special character');
  if (policyErrors.length > 0) {
    res.status(400).json({ success: false, error: `Password must contain: ${policyErrors.join(', ')}.` });
    return;
  }

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [req.user!.userId]
    );
    const user = rows[0] as { id: number; password_hash: string } | undefined;

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found.' });
      return;
    }

    const match = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!match) {
      res.status(401).json({ success: false, error: 'Current password is incorrect.' });
      return;
    }

    const newHash = bcrypt.hashSync(newPassword, 12);
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = 0 WHERE id = $2',
      [newHash, user.id]
    );

    // Issue a fresh token so the caller's JWT no longer carries mustChangePassword=true.
    const newToken = signToken({
      userId:             req.user!.userId,
      employeeId:         req.user!.employeeId,
      role:               req.user!.role,
      mustChangePassword: false,
    });

    res.json({ success: true, token: newToken });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

authRouter.get('/me', requireAuth, (req: Request, res: Response): void => {
  res.json({
    success: true,
    user: {
      id:         req.user!.userId,
      employeeId: req.user!.employeeId,
      role:       req.user!.role,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/users — Admin only: list all users with lock status
// ---------------------------------------------------------------------------

authRouter.get('/users', requireAuth, requireRole('admin'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT id, employee_id, role, must_change_password, failed_login_attempts, is_locked, locked_at, created_at FROM users ORDER BY employee_id'
    );
    res.json({
      success: true,
      users: rows.map((r: any) => ({
        id:                  r.id,
        employeeId:          r.employee_id,
        role:                r.role,
        mustChangePassword:  r.must_change_password === 1,
        failedLoginAttempts: r.failed_login_attempts ?? 0,
        isLocked:            r.is_locked === 1,
        lockedAt:            r.locked_at,
        createdAt:           r.created_at,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/users/:id/unlock — Admin only: unlock a locked account
// ---------------------------------------------------------------------------

authRouter.post('/users/:id/unlock', requireAuth, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const userId = req.params.id;
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(
      'UPDATE users SET is_locked = 0, failed_login_attempts = 0, locked_at = NULL WHERE id = $1',
      [userId]
    );
    if (rowCount === 0) {
      res.status(404).json({ success: false, error: 'User not found.' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});
