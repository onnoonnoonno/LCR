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
import { calculateIrrbb } from './irrbbService';

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
  userId?: number,
): UploadResult {
  const db = getDb();

  // Use manual report date if provided, otherwise extract from filename
  const reportDate = manualReportDate || extractReportDate(originalFilename);

  // Create report run record
  const runId = uuidv4();
  const now   = new Date().toISOString();

  db.prepare(`
    INSERT INTO report_runs (id, report_date, uploaded_at, source_filename, status, user_id)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(runId, reportDate, now, originalFilename, userId ?? null);

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

  // Calculate and store IRRBB data from raw rows
  try {
    const irrbbRows = rows.map(r => ({
      acCode:                r.acCode,
      counterpartyNo:        r.counterpartyNo,
      counterpartyName:      r.counterpartyName,
      ccy:                   r.ccy,
      baseCcyAmt:            r.baseCcyAmt,
      nextInterestResetDate: r.nextInterestResetDate,
    }));
    const irrbb = calculateIrrbb(irrbbRows, reportDate);
    db.prepare(`UPDATE report_runs SET irrbb_data = ? WHERE id = ?`)
      .run(JSON.stringify(irrbb), runId);
  } catch (e) {
    console.warn('[uploadService] IRRBB calculation failed:', e);
  }

  // Update run status
  db.prepare(`UPDATE report_runs SET status = 'uploaded' WHERE id = ?`).run(runId);

  console.log(`[uploadService] runId=${runId} date=${reportDate} rows=${rows.length}`);

  return { runId, reportDate, sourceFilename: originalFilename, rawRowCount: rows.length };
}
