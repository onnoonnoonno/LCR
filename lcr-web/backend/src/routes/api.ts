/**
 * API Router (DB-backed architecture)
 *
 * Endpoints:
 *   GET  /api/health          – liveness probe
 *   POST /api/upload          – upload Excel → run pipeline → return summary
 *   GET  /api/history         – list all available report dates
 *   GET  /api/summary         – get summary by ?date=YYYY-MM-DD or ?runId=<id>
 *   GET  /api/debug/rows      – processed row details (debug only, not shown in main UI)
 */

import { Router, Request, Response } from 'express';
import { uploadMiddleware } from '../middleware/upload';
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
} from '../controllers/reportController';

export const apiRouter = Router();

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
// Health check
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
apiRouter.delete('/history/run/:runId', handleDeleteRun);
apiRouter.delete('/history/reset', handleResetHistory);
apiRouter.get('/summary', handleGetSummary);
apiRouter.get('/latest-run', handleGetLatestRun);

// ---------------------------------------------------------------------------
// Reference data inspection
// ---------------------------------------------------------------------------
apiRouter.get('/account-mappings', handleGetAccountMappings);
apiRouter.get('/account-mappings/distinct', handleGetAccountMappingDistinct);
apiRouter.post('/account-mappings', handleCreateAccountMapping);
apiRouter.put('/account-mappings/:id', handleUpdateAccountMapping);
apiRouter.delete('/account-mappings/:id', handleDeleteAccountMapping);

// ---------------------------------------------------------------------------
// Verification routes (step-by-step column verification)
// ---------------------------------------------------------------------------
apiRouter.get('/verify/column-l', handleVerifyColumnL);
apiRouter.get('/verify/gap-forecast', handleVerify7DayForecast);
apiRouter.get('/verify/lmg-summary', handleVerifyLmgSummary);
apiRouter.get('/verify/cf-table', handleVerifyCfTable);
apiRouter.get('/verify/lcr-forecast', handleLcrForecast);

// ---------------------------------------------------------------------------
// Debug routes (not linked from main UI)
// ---------------------------------------------------------------------------
apiRouter.get('/debug/rows', handleGetDebugRows);
apiRouter.get('/debug/bs-re33', handleDebugBsRe33);
apiRouter.post('/debug/raw-cells', applyUpload, handleDebugRawCells);
