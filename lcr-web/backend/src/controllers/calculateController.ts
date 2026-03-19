/**
 * Calculate Controller
 *
 * POST /api/calculate
 *
 * Full pipeline:
 *   1. Accept Excel file upload (same mechanism as /api/upload)
 *   2. Extract reportDate from filename
 *   3. Parse Excel rows A:K
 *   4. Validate rows
 *   5. Run BS_RE33 calculation engine
 *   6. Store result in memory store
 *   7. Return summary + calculationId
 */

import { Request, Response, NextFunction } from 'express';
import { extractReportDate, parseExcelBuffer } from '../services/excelParser';
import { validateRows } from '../services/validator';
import { runBS_RE33 } from '../services/calculationEngine';
import { storeCalculation } from '../store/calculationStore';
import { CalculateResponse } from '../types/bs-re33';

export async function handleCalculate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // -----------------------------------------------------------------------
    // 1. File presence check
    // -----------------------------------------------------------------------
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: 'No file uploaded. Attach the Excel file under the field name "file".',
      } satisfies CalculateResponse);
      return;
    }

    const { originalname, buffer } = req.file;

    // -----------------------------------------------------------------------
    // 2. Extract report date from filename
    // -----------------------------------------------------------------------
    const reportDate = extractReportDate(originalname);

    // -----------------------------------------------------------------------
    // 3. Parse Excel rows A:K
    // -----------------------------------------------------------------------
    const { rows: allRows } = parseExcelBuffer(buffer);

    // -----------------------------------------------------------------------
    // 4. Validate rows (only valid rows go to the engine)
    // -----------------------------------------------------------------------
    const { validRows } = validateRows(allRows);

    // -----------------------------------------------------------------------
    // 5. Run BS_RE33 calculation engine
    // -----------------------------------------------------------------------
    const output = runBS_RE33({ reportDate, rows: validRows });

    // -----------------------------------------------------------------------
    // 6. Store result for subsequent GET requests
    // -----------------------------------------------------------------------
    storeCalculation(output);

    // -----------------------------------------------------------------------
    // 7. Respond with summary (not the full row array — use GET /api/bs-re33)
    // -----------------------------------------------------------------------
    const warningCount = output.rows.reduce((acc, r) => acc + r.warnings.length, 0);

    const response: CalculateResponse = {
      success: true,
      calculationId: output.calculationId,
      reportDate: output.reportDate,
      rowCount: allRows.length,
      calculatedRows: output.rows.length,
      summary: output.summary,
      warnings: warningCount,
      errors: output.calculationErrors.length,
    };

    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
}
