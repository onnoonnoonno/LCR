/**
 * API Router (DB-backed architecture)
 *
 * All routes require authentication (requireAuth + requirePasswordChanged).
 * Admin-only mutation routes additionally require requireRole('admin').
 */

import { Router, Request, Response } from 'express';
import { uploadMiddleware } from '../middleware/upload';
import { requireAuth, requirePasswordChanged, requireRole } from '../middleware/auth';
import {
  handleUploadAndProcess,
  handleUploadRaw,
  handleGetRawRows,
  handleListHistory,
  handleDeleteRun,
  handleResetHistory,
  handleGetSummary,
  handleGetDebugRows,
  handleVerifyColumnL,
  handleVerify7DayForecast,
  handleVerifyLmgSummary,
  handleVerifyCfTable,
  handleDebugBsRe33,
  handleDebugRawCells,
  handleGetLatestRun,
  handleGetAccountMappings,
  handleGetAccountMappingDistinct,
  handleCreateAccountMapping,
  handleUpdateAccountMapping,
  handleDeleteAccountMapping,
  handleLcrForecast,
  handleIrrbb,
  handleMonthlyAverageLcr,
} from '../controllers/reportController';

export const apiRouter = Router();

// Apply authentication to all business API routes
apiRouter.use(requireAuth);
apiRouter.use(requirePasswordChanged);

// ---------------------------------------------------------------------------
// Multer wrapper
// ---------------------------------------------------------------------------
function applyUpload(
  req: Request,
  res: Response,
  next: (err?: unknown) => void,
): void {
  uploadMiddleware(req, res, (err) => {
    if (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
      return;
    }
    next();
  });
}

// ---------------------------------------------------------------------------
// Health check (still behind auth — internal tool)
// ---------------------------------------------------------------------------
apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status:    'ok',
    service:   'lcr-web-backend',
    version:   3,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Upload + process pipeline
// ---------------------------------------------------------------------------
apiRouter.post('/upload', applyUpload, handleUploadAndProcess);

// ---------------------------------------------------------------------------
// Upload raw only (verification workflow — no pipeline processing)
// ---------------------------------------------------------------------------
apiRouter.post('/upload-raw', applyUpload, handleUploadRaw);

// ---------------------------------------------------------------------------
// Raw rows retrieval (verification workflow)
// ---------------------------------------------------------------------------
apiRouter.get('/raw-rows', handleGetRawRows);

// ---------------------------------------------------------------------------
// History retrieval
// ---------------------------------------------------------------------------
apiRouter.get('/history', handleListHistory);
apiRouter.delete('/history/run/:runId', requireRole('admin'), handleDeleteRun);
apiRouter.delete('/history/reset', requireRole('admin'), handleResetHistory);
apiRouter.get('/summary', handleGetSummary);
apiRouter.get('/latest-run', handleGetLatestRun);

// ---------------------------------------------------------------------------
// Reference data inspection (read — any authenticated user)
// ---------------------------------------------------------------------------
apiRouter.get('/account-mappings', handleGetAccountMappings);
apiRouter.get('/account-mappings/distinct', handleGetAccountMappingDistinct);

// ---------------------------------------------------------------------------
// Reference data mutations (admin only)
// ---------------------------------------------------------------------------
apiRouter.post('/account-mappings', requireRole('admin'), handleCreateAccountMapping);
apiRouter.put('/account-mappings/:id', requireRole('admin'), handleUpdateAccountMapping);
apiRouter.delete('/account-mappings/:id', requireRole('admin'), handleDeleteAccountMapping);

// ---------------------------------------------------------------------------
// Verification routes (step-by-step column verification)
// ---------------------------------------------------------------------------
apiRouter.get('/verify/column-l', handleVerifyColumnL);
apiRouter.get('/verify/gap-forecast', handleVerify7DayForecast);
apiRouter.get('/verify/lmg-summary', handleVerifyLmgSummary);
apiRouter.get('/verify/cf-table', handleVerifyCfTable);
apiRouter.get('/verify/lcr-forecast', handleLcrForecast);
apiRouter.get('/verify/irrbb', handleIrrbb);
apiRouter.get('/monthly-average-lcr', handleMonthlyAverageLcr);

// ---------------------------------------------------------------------------
// Debug routes (admin only)
// ---------------------------------------------------------------------------
apiRouter.get('/debug/rows', requireRole('admin'), handleGetDebugRows);
apiRouter.get('/debug/bs-re33', requireRole('admin'), handleDebugBsRe33);
apiRouter.post('/debug/raw-cells', requireRole('admin'), applyUpload, handleDebugRawCells);
