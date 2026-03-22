/**
 * Admin action password middleware.
 *
 * Reads ADMIN_ACTION_PASSWORD from the environment and compares it against
 * the value supplied by the client in the x-admin-password header using
 * a timing-safe comparison (crypto.timingSafeEqual) to prevent timing attacks.
 *
 * If ADMIN_ACTION_PASSWORD is not set, the middleware logs a warning and
 * blocks the request — unprotected mutation endpoints are not allowed in
 * production.  Set the variable to an empty string only if you explicitly
 * want to disable protection (development only).
 */

import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

export function requireAdminPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = process.env.ADMIN_ACTION_PASSWORD;

  // No password configured at all → refuse with a clear server-side message
  if (expected === undefined) {
    console.warn('[adminAuth] ADMIN_ACTION_PASSWORD is not set — blocking protected action');
    res.status(503).json({
      success: false,
      error: 'Server is not configured for protected actions (ADMIN_ACTION_PASSWORD missing).',
    });
    return;
  }

  // Empty string in env → protection explicitly disabled (dev convenience)
  if (expected === '') {
    next();
    return;
  }

  const provided = (req.headers['x-admin-password'] as string | undefined) ?? '';

  if (!provided) {
    res.status(401).json({ success: false, error: 'Password required.' });
    return;
  }

  // Timing-safe comparison — both buffers must be the same byte length
  try {
    const a = Buffer.from(provided,  'utf8');
    const b = Buffer.from(expected,  'utf8');
    const match = a.length === b.length && timingSafeEqual(a, b);
    if (!match) {
      res.status(403).json({ success: false, error: 'Incorrect password.' });
      return;
    }
  } catch {
    res.status(403).json({ success: false, error: 'Incorrect password.' });
    return;
  }

  next();
}
