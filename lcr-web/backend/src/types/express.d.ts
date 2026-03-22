/**
 * Express Request augmentation — adds req.user from JWT middleware.
 */

declare namespace Express {
  interface Request {
    user?: {
      userId: number;
      employeeId: string;
      role: string;
      mustChangePassword: boolean;
    };
  }
}
