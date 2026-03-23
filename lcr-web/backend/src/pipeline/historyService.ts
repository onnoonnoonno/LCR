/**
 * History Service
 *
 * Retrieves previously stored report summaries from the database.
 *
 *  - listReportDates()       → available dates with summary snapshot
 *  - getSummaryByDate(date)  → full summary for a specific date
 *  - getSummaryByRunId(id)   → full summary for a specific run
 *  - getRunMetadata(runId)   → report run metadata
 *  - getProcessedRows(runId) → processed row details (debug use)
 */

import { getPool } from '../db/client';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReportSummaryRecord {
  summaryId:       string;
  runId:           string;
  reportDate:      string;
  sourceFilename:  string;
  uploadedAt:      string;
  eligibleHqla:    number;
  grossOutflows:   number;
  grossInflows:    number;
  cappedInflows:   number;
  netCashOutflows: number;
  lcrRatio:        number | null;
  ratio7d:         number | null;
  ratio1m:         number | null;
  ratio3m:         number | null;
  ratio3mLr:       number | null;
  createdAt:       string;
}

export interface HistoryListItem {
  reportDate:      string;
  runId:           string;
  sourceFilename:  string;
  uploadedAt:      string;
  lcrRatio:        number | null;
  eligibleHqla:    number;
  grossOutflows:   number;
  netCashOutflows: number;
  ratio3mLr:       number | null;
  status:          string;
}

// ---------------------------------------------------------------------------
// List available report dates
// ---------------------------------------------------------------------------

export async function listReportDates(): Promise<HistoryListItem[]> {
  const pool = getPool();

  const { rows } = await pool.query(`
    SELECT
      rr.id              AS run_id,
      rr.report_date,
      rr.source_filename,
      rr.uploaded_at,
      rr.status,
      rs.eligible_hqla,
      rs.gross_outflows,
      rs.net_cash_outflows,
      rs.lcr_ratio,
      rs.ratio_3m_lr
    FROM report_runs rr
    LEFT JOIN report_summaries rs ON rs.report_run_id = rr.id
    ORDER BY rr.report_date DESC, rr.uploaded_at DESC
  `);

  return (rows as Array<{
    run_id: string; report_date: string; source_filename: string;
    uploaded_at: string; status: string;
    eligible_hqla: number | null; gross_outflows: number | null;
    net_cash_outflows: number | null; lcr_ratio: number | null;
    ratio_3m_lr: number | null;
  }>).map((r) => ({
    reportDate:      r.report_date,
    runId:           r.run_id,
    sourceFilename:  r.source_filename,
    uploadedAt:      r.uploaded_at,
    lcrRatio:        r.lcr_ratio,
    eligibleHqla:    r.eligible_hqla ?? 0,
    grossOutflows:   r.gross_outflows ?? 0,
    netCashOutflows: r.net_cash_outflows ?? 0,
    ratio3mLr:       r.ratio_3m_lr,
    status:          r.status,
  }));
}

// ---------------------------------------------------------------------------
// Get summary by report date (latest run for that date)
// ---------------------------------------------------------------------------

export async function getSummaryByDate(reportDate: string): Promise<ReportSummaryRecord | null> {
  const pool = getPool();

  const { rows } = await pool.query(`
    SELECT
      rs.id              AS summary_id,
      rs.report_run_id   AS run_id,
      rs.report_date,
      rr.source_filename,
      rr.uploaded_at,
      rs.eligible_hqla,
      rs.gross_outflows,
      rs.gross_inflows,
      rs.capped_inflows,
      rs.net_cash_outflows,
      rs.lcr_ratio,
      rs.ratio_7d,
      rs.ratio_1m,
      rs.ratio_3m,
      rs.ratio_3m_lr,
      rs.created_at
    FROM report_summaries rs
    JOIN report_runs rr ON rr.id = rs.report_run_id
    WHERE rs.report_date = $1
    ORDER BY rs.created_at DESC
    LIMIT 1
  `, [reportDate]);

  const row = rows[0] as {
    summary_id: string; run_id: string; report_date: string;
    source_filename: string; uploaded_at: string;
    eligible_hqla: number; gross_outflows: number; gross_inflows: number;
    capped_inflows: number; net_cash_outflows: number; lcr_ratio: number | null;
    ratio_7d: number | null; ratio_1m: number | null; ratio_3m: number | null;
    ratio_3m_lr: number | null; created_at: string;
  } | undefined;

  if (!row) return null;

  return {
    summaryId:       row.summary_id,
    runId:           row.run_id,
    reportDate:      row.report_date,
    sourceFilename:  row.source_filename,
    uploadedAt:      row.uploaded_at,
    eligibleHqla:    row.eligible_hqla,
    grossOutflows:   row.gross_outflows,
    grossInflows:    row.gross_inflows,
    cappedInflows:   row.capped_inflows,
    netCashOutflows: row.net_cash_outflows,
    lcrRatio:        row.lcr_ratio,
    ratio7d:         row.ratio_7d,
    ratio1m:         row.ratio_1m,
    ratio3m:         row.ratio_3m,
    ratio3mLr:       row.ratio_3m_lr,
    createdAt:       row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Get summary by run ID
// ---------------------------------------------------------------------------

export async function getSummaryByRunId(runId: string): Promise<ReportSummaryRecord | null> {
  const pool = getPool();

  const { rows } = await pool.query(`
    SELECT
      rs.id              AS summary_id,
      rs.report_run_id   AS run_id,
      rs.report_date,
      rr.source_filename,
      rr.uploaded_at,
      rs.eligible_hqla,
      rs.gross_outflows,
      rs.gross_inflows,
      rs.capped_inflows,
      rs.net_cash_outflows,
      rs.lcr_ratio,
      rs.ratio_7d,
      rs.ratio_1m,
      rs.ratio_3m,
      rs.ratio_3m_lr,
      rs.created_at
    FROM report_summaries rs
    JOIN report_runs rr ON rr.id = rs.report_run_id
    WHERE rs.report_run_id = $1
  `, [runId]);

  const row = rows[0] as any | undefined;
  if (!row) return null;

  return {
    summaryId:       row.summary_id,
    runId:           row.run_id,
    reportDate:      row.report_date,
    sourceFilename:  row.source_filename,
    uploadedAt:      row.uploaded_at,
    eligibleHqla:    row.eligible_hqla,
    grossOutflows:   row.gross_outflows,
    grossInflows:    row.gross_inflows,
    cappedInflows:   row.capped_inflows,
    netCashOutflows: row.net_cash_outflows,
    lcrRatio:        row.lcr_ratio,
    ratio7d:         row.ratio_7d,
    ratio1m:         row.ratio_1m,
    ratio3m:         row.ratio_3m,
    ratio3mLr:       row.ratio_3m_lr,
    createdAt:       row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Get raw rows for a run (verification view)
// ---------------------------------------------------------------------------

export interface RawRowRecord {
  id:                    number;
  rowNumber:             number;
  acCode:                string | null;
  acName:                string | null;
  refNo:                 string | null;
  counterpartyNo:        string | null;
  counterpartyName:      string | null;
  ccy:                   string | null;
  balanceAmt:            number | null;
  baseCcyAmt:            number | null;
  approvalContractDate:  string | null;
  maturityDate:          string | null;
  nextInterestResetDate: string | null;
}

export async function getRawRows(
  runId: string,
  page = 1,
  pageSize = 100,
): Promise<{ rows: RawRowRecord[]; total: number }> {
  const pool = getPool();

  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*) AS cnt FROM raw_rows WHERE report_run_id = $1',
    [runId]
  );
  const total = parseInt(countRows[0].cnt, 10);

  const offset = (page - 1) * pageSize;

  const { rows } = await pool.query(`
    SELECT
      id, row_number, ac_code, ac_name, ref_no,
      counterparty_no, counterparty_name, ccy,
      balance_amt, base_ccy_amt,
      approval_contract_date, maturity_date, next_interest_reset_date
    FROM raw_rows
    WHERE report_run_id = $1
    ORDER BY row_number
    LIMIT $2 OFFSET $3
  `, [runId, pageSize, offset]);

  return {
    total,
    rows: (rows as Array<{
      id: number; row_number: number; ac_code: string | null; ac_name: string | null;
      ref_no: string | null; counterparty_no: string | null; counterparty_name: string | null;
      ccy: string | null; balance_amt: number | null; base_ccy_amt: number | null;
      approval_contract_date: string | null; maturity_date: string | null;
      next_interest_reset_date: string | null;
    }>).map((r) => ({
      id:                    r.id,
      rowNumber:             r.row_number,
      acCode:                r.ac_code,
      acName:                r.ac_name,
      refNo:                 r.ref_no,
      counterpartyNo:        r.counterparty_no,
      counterpartyName:      r.counterparty_name,
      ccy:                   r.ccy,
      balanceAmt:            r.balance_amt,
      baseCcyAmt:            r.base_ccy_amt,
      approvalContractDate:  r.approval_contract_date,
      maturityDate:          r.maturity_date,
      nextInterestResetDate: r.next_interest_reset_date,
    })),
  };
}

// ---------------------------------------------------------------------------
// Get processed rows for a run (debug / reconciliation)
// ---------------------------------------------------------------------------

export interface ProcessedRowRecord {
  id:                  number;
  rowNumber:           number;
  acCode:              string | null;
  acName:              string | null;
  category:            string | null;
  middleCategory:      string | null;
  customerType:        string | null;
  assumptionRate:      number | null;
  adjustedAmount:      number | null;
  weightedAmount:      number | null;
  isHqla:              boolean;
  hqlaLevel:           string | null;
  effectiveMaturity:   string | null;
  daysToMaturity:      number | null;
  maturityBucket:      string | null;
  in30dWindow:         boolean;
  isCashInflow:        boolean;
  isCashOutflow:       boolean;
  warningFlag:         boolean;
  warningReason:       string | null;
}

export async function getProcessedRows(
  runId: string,
  page = 1,
  pageSize = 100,
): Promise<{ rows: ProcessedRowRecord[]; total: number }> {
  const pool = getPool();

  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*) AS cnt FROM processed_rows WHERE report_run_id = $1',
    [runId]
  );
  const total = parseInt(countRows[0].cnt, 10);

  const offset = (page - 1) * pageSize;

  const { rows } = await pool.query(`
    SELECT
      pr.id, rr.row_number, rr.ac_code, rr.ac_name,
      pr.category, pr.middle_category, pr.customer_type,
      pr.assumption_rate, pr.adjusted_amount, pr.weighted_amount,
      pr.is_hqla, pr.hqla_level,
      pr.effective_maturity, pr.days_to_maturity, pr.maturity_bucket,
      pr.in_30d_window, pr.is_cash_inflow, pr.is_cash_outflow,
      pr.warning_flag, pr.warning_reason
    FROM processed_rows pr
    JOIN raw_rows rr ON rr.id = pr.raw_row_id
    WHERE pr.report_run_id = $1
    ORDER BY rr.row_number
    LIMIT $2 OFFSET $3
  `, [runId, pageSize, offset]);

  return {
    total,
    rows: (rows as Array<{
      id: number; row_number: number; ac_code: string | null; ac_name: string | null;
      category: string | null; middle_category: string | null; customer_type: string | null;
      assumption_rate: number | null; adjusted_amount: number | null; weighted_amount: number | null;
      is_hqla: number; hqla_level: string | null;
      effective_maturity: string | null; days_to_maturity: number | null; maturity_bucket: string | null;
      in_30d_window: number; is_cash_inflow: number; is_cash_outflow: number;
      warning_flag: number; warning_reason: string | null;
    }>).map((r) => ({
      id:                r.id,
      rowNumber:         r.row_number,
      acCode:            r.ac_code,
      acName:            r.ac_name,
      category:          r.category,
      middleCategory:    r.middle_category,
      customerType:      r.customer_type,
      assumptionRate:    r.assumption_rate,
      adjustedAmount:    r.adjusted_amount,
      weightedAmount:    r.weighted_amount,
      isHqla:            r.is_hqla === 1,
      hqlaLevel:         r.hqla_level,
      effectiveMaturity: r.effective_maturity,
      daysToMaturity:    r.days_to_maturity,
      maturityBucket:    r.maturity_bucket,
      in30dWindow:       r.in_30d_window === 1,
      isCashInflow:      r.is_cash_inflow === 1,
      isCashOutflow:     r.is_cash_outflow === 1,
      warningFlag:       r.warning_flag === 1,
      warningReason:     r.warning_reason,
    })),
  };
}
