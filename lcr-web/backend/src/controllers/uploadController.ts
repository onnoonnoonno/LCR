/**
 * Upload controller.
 *
 * Orchestrates:
 *   1. Filename date extraction
 *   2. Excel parsing
 *   3. Row validation
 *   4. (Phase 2) Calculation engine invocation
 *   5. JSON response
 *
 * The controller is intentionally thin – all business logic lives in services.
 */

import { Request, Response, NextFunction } from 'express';
import { extractReportDate, parseExcelBuffer } from '../services/excelParser';
import { validateRows } from '../services/validator';
import { UploadResponse } from '../types/lcr';

export async function handleUpload(
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
      } satisfies UploadResponse);
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
    const { rows } = parseExcelBuffer(buffer);

    // -----------------------------------------------------------------------
    // 4. Validate rows
    // -----------------------------------------------------------------------
    const { validRows, invalidRows, errors } = validateRows(rows);

    // -----------------------------------------------------------------------
    // 5. (Phase 2) Run BS_RE33 calculation engine
    //    Uncomment and pass `calculationResult` into the response when ready.
    // -----------------------------------------------------------------------
    // import { runBS_RE33 } from '../services/calculationEngine';
    // const calculationResult = runBS_RE33({ reportDate, rows: validRows });

    // -----------------------------------------------------------------------
    // 6. Respond
    // -----------------------------------------------------------------------
    const response: UploadResponse = {
      success: true,
      reportDate,
      totalRows: rows.length,
      validRows: validRows.length,
      invalidRows: invalidRows.length,
      rows,
      validationErrors: errors,
    };

    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
}
