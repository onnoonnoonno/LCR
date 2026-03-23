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
import { signToken } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';

export const authRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

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
      'SELECT id, employee_id, password_hash, role, must_change_password FROM users WHERE employee_id = $1',
      [employeeId]
    );
    const user = rows[0] as {
      id: number;
      employee_id: string;
      password_hash: string;
      role: string;
      must_change_password: number;
    } | undefined;

    // Always run bcrypt compare to prevent user-enumeration via timing
    const dummyHash = '$2b$12$invalidhashpaddingtomakethissafe00000000000000000000000';
    const hashToCompare = user ? user.password_hash : dummyHash;

    const match = bcrypt.compareSync(password, hashToCompare);

    if (!user || !match) {
      res.status(401).json({ success: false, error: 'Invalid employee ID or password.' });
      return;
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

  if (newPassword.length < 8) {
    res.status(400).json({ success: false, error: 'New password must be at least 8 characters.' });
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
