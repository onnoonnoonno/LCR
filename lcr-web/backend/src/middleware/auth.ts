/**
 * JWT Authentication & Authorization middleware.
 *
 * requireAuth         — verifies Bearer token, attaches req.user
 * requirePasswordChanged — blocks access if must_change_password = true
 * requireRole(role)   — requires req.user.role === role (call after requireAuth)
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set.');
  }
  return secret;
}

export interface JwtPayload {
  userId:             number;
  employeeId:         string;
  role:               string;
  mustChangePassword: boolean;
  iat?:               number;
  exp?:               number;
}

/** Issue a signed JWT for a user record. */
export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  // Cast to any to avoid expiresIn StringValue type narrowing issues across @types/jsonwebtoken versions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign(payload as any, getJwtSecret(), {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as any,
  });
}

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['authorization'];

  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return;
  }

  const token = header.slice(7);

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
    req.user = {
      userId:             decoded.userId,
      employeeId:         decoded.employeeId,
      role:               decoded.role,
      mustChangePassword: decoded.mustChangePassword,
    };
    next();
  } catch {
    res.status(403).json({ success: false, error: 'Invalid or expired token.' });
  }
}

// ---------------------------------------------------------------------------
// requirePasswordChanged
// Blocks access to normal business routes until first-login password change.
// Place this AFTER requireAuth.
// ---------------------------------------------------------------------------

export function requirePasswordChanged(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.mustChangePassword) {
    res.status(403).json({
      success: false,
      error: 'Password change required before using the system.',
      mustChangePassword: true,
    });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// requireRole
// ---------------------------------------------------------------------------

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required.' });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ success: false, error: 'Insufficient permissions.' });
      return;
    }
    next();
  };
}
