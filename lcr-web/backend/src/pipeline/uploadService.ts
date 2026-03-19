/**
 * Upload Service
 *
 * Responsibilities:
 *  1. Accept a raw Excel buffer + filename.
 *  2. Create a ReportRun record in the DB.
 *  3. Parse the Excel file into raw rows.
 *  4. Store raw rows in the raw_rows table exactly as parsed.
 *
 * Returns the runId so the pipeline can continue.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/client';
import { parseExcelBuffer, extractReportDate } from '../services/excelParser';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UploadResult {
  runId: string;
  reportDate: string;
  sourceFilename: string;
  rawRowCount: number;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function uploadRawData(
  buffer: Buffer,
  originalFilename: string,
  manualReportDate?: string,
): UploadResult {
  const db = getDb();

  // Use manual report date if provided, otherwise extract from filename
  const reportDate = manualReportDate || extractReportDate(originalFilename);

  // Create report run record
  const runId = uuidv4();
  const now   = new Date().toISOString();

  db.prepare(`
    INSERT INTO report_runs (id, report_date, uploaded_at, source_filename, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(runId, reportDate, now, originalFilename);

  // Parse Excel
  const { rows } = parseExcelBuffer(buffer);

  // Store raw rows
  const insertRaw = db.prepare(`
    INSERT INTO raw_rows (
      report_run_id, row_number, ac_code, ac_name, ref_no,
      counterparty_no, counterparty_name, ccy, balance_amt,
      base_ccy_amt, approval_contract_date, maturity_date,
      next_interest_reset_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    for (const row of rows) {
      insertRaw.run(
        runId,
        row.rowNumber,
        row.acCode,
        row.acName,
        row.refNo,
        row.counterpartyNo,
        row.counterpartyName,
        row.ccy,
        row.balanceAmt,
        row.baseCcyAmt,
        row.approvalContractDate,
        row.maturityDate,
        row.nextInterestResetDate,
      );
    }
  });
  insertAll();

  // Update run status
  db.prepare(`UPDATE report_runs SET status = 'uploaded' WHERE id = ?`).run(runId);

  console.log(`[uploadService] runId=${runId} date=${reportDate} rows=${rows.length}`);

  return { runId, reportDate, sourceFilename: originalFilename, rawRowCount: rows.length };
}
