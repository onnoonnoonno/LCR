/**
 * Summary Controller
 *
 * GET /api/summary?calculationId=<id>
 *   → Returns the LcrSummary for a stored calculation.
 *
 * GET /api/bs-re33?calculationId=<id>&page=1&pageSize=100
 *   → Returns paginated BS_RE33Row array.
 */

import { Request, Response } from 'express';
import { getCalculation } from '../store/calculationStore';
import { SummaryResponse, BS_RE33PageResponse } from '../types/bs-re33';

// ---------------------------------------------------------------------------
// GET /api/summary
// ---------------------------------------------------------------------------

export function handleGetSummary(req: Request, res: Response): void {
  const { calculationId } = req.query;

  if (!calculationId || typeof calculationId !== 'string') {
    res.status(400).json({ success: false, error: 'calculationId query parameter is required.' });
    return;
  }

  const output = getCalculation(calculationId);
  if (!output) {
    res.status(404).json({
      success: false,
      error: `Calculation "${calculationId}" not found. It may have expired (TTL: 4 hours) or never existed.`,
    });
    return;
  }

  const response: SummaryResponse = {
    calculationId: output.calculationId,
    summary: output.summary,
  };

  res.status(200).json(response);
}

// ---------------------------------------------------------------------------
// GET /api/bs-re33
// ---------------------------------------------------------------------------

export function handleGetBS_RE33(req: Request, res: Response): void {
  const { calculationId } = req.query;

  if (!calculationId || typeof calculationId !== 'string') {
    res.status(400).json({ success: false, error: 'calculationId query parameter is required.' });
    return;
  }

  const output = getCalculation(calculationId);
  if (!output) {
    res.status(404).json({
      success: false,
      error: `Calculation "${calculationId}" not found or expired.`,
    });
    return;
  }

  // Pagination
  const page     = Math.max(1, parseInt(String(req.query.page     ?? '1'),    10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(String(req.query.pageSize ?? '100'), 10) || 100));
  const start    = (page - 1) * pageSize;
  const end      = start + pageSize;

  const totalRows  = output.rows.length;
  const totalPages = Math.ceil(totalRows / pageSize);
  const pageRows   = output.rows.slice(start, end);

  const response: BS_RE33PageResponse = {
    calculationId: output.calculationId,
    reportDate:    output.reportDate,
    page,
    pageSize,
    totalRows,
    totalPages,
    rows: pageRows,
  };

  res.status(200).json(response);
}
