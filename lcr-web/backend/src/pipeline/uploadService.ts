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
import { getPool } from '../db/client';
import { parseExcelBuffer, extractReportDate } from '../services/excelParser';
import { calculateIrrbb } from './irrbbService';
import { isIndexReady, validateAgainstMappings } from '../reference/accountMappingService';
import { loadReferenceDataFromDb } from './pipelineService';

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

export async function uploadRawData(
  buffer: Buffer,
  originalFilename: string,
  manualReportDate?: string,
  userId?: number,
): Promise<UploadResult> {
  const pool = getPool();

  // Use manual report date if provided, otherwise extract from filename
  const reportDate = manualReportDate || extractReportDate(originalFilename);

  // Parse Excel FIRST (before any DB writes)
  const { rows } = parseExcelBuffer(buffer);

  // Validate account codes/names against the mapping list
  if (!isIndexReady()) await loadReferenceDataFromDb();
  const { unmappedCodes, unmappedNames } = validateAgainstMappings(rows);
  if (unmappedCodes.length || unmappedNames.length) {
    throw new Error(
      `UNMAPPED_ACCOUNTS:${JSON.stringify({ codes: unmappedCodes, names: unmappedNames })}`
    );
  }

  // Create report run record (only after validation passes)
  const runId = uuidv4();
  const now   = new Date().toISOString();

  await pool.query(
    `INSERT INTO report_runs (id, report_date, uploaded_at, source_filename, status, user_id)
     VALUES ($1, $2, $3, $4, 'pending', $5)`,
    [runId, reportDate, now, originalFilename, userId ?? null]
  );

  // Store raw rows in a single transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(
        `INSERT INTO raw_rows (
           report_run_id, row_number, ac_code, ac_name, ref_no,
           counterparty_no, counterparty_name, ccy, balance_amt,
           base_ccy_amt, approval_contract_date, maturity_date,
           next_interest_reset_date
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
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
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

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
    await pool.query(
      'UPDATE report_runs SET irrbb_data = $1 WHERE id = $2',
      [JSON.stringify(irrbb), runId]
    );
  } catch (e) {
    console.warn('[uploadService] IRRBB calculation failed:', e);
  }

  // Update run status
  await pool.query(
    "UPDATE report_runs SET status = 'uploaded' WHERE id = $1",
    [runId]
  );

  // Delete older uploads for the same report date (keep only this new one)
  try {
    const { rows: oldRuns } = await pool.query(
      'SELECT id FROM report_runs WHERE report_date = $1 AND id != $2',
      [reportDate, runId]
    );
    if (oldRuns.length > 0) {
      const oldIds = oldRuns.map((r: { id: string }) => r.id);
      console.log(`[uploadService] Cleaning up ${oldIds.length} older run(s) for date=${reportDate}: [${oldIds.join(', ')}]`);
      // Delete child records first (FK order), then parent
      await pool.query('DELETE FROM report_summaries WHERE report_run_id = ANY($1)', [oldIds]);
      await pool.query('DELETE FROM processed_rows WHERE report_run_id = ANY($1)', [oldIds]);
      await pool.query('DELETE FROM raw_rows WHERE report_run_id = ANY($1)', [oldIds]);
      await pool.query('DELETE FROM report_runs WHERE id = ANY($1)', [oldIds]);
    }
  } catch (e) {
    console.warn('[uploadService] Cleanup of older same-date runs failed:', e);
    // Non-fatal: the new upload succeeded, older data just wasn't cleaned up
  }

  console.log(`[uploadService] runId=${runId} date=${reportDate} rows=${rows.length}`);

  return { runId, reportDate, sourceFilename: originalFilename, rawRowCount: rows.length };
}
