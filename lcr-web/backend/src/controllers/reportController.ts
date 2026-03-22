/**
 * Report Controller
 *
 * Handles the new DB-backed pipeline endpoints:
 *
 *   POST /api/upload      → upload file, run pipeline, return summary
 *   GET  /api/history     → list all available report dates
 *   GET  /api/summary     → get summary by date (query: ?date=YYYY-MM-DD)
 *   GET  /api/debug/rows  → processed rows for a run (query: ?runId=&page=&pageSize=)
 */

import { Request, Response } from 'express';
import { uploadRawData }    from '../pipeline/uploadService';
import { processReportRun, loadReferenceDataFromDb } from '../pipeline/pipelineService';
import { getDb } from '../db/client';
import { lookupAccountMapping } from '../reference/accountMappingService';
import {
  listReportDates,
  getSummaryByDate,
  getSummaryByRunId,
  getProcessedRows,
  getRawRows,
} from '../pipeline/historyService';

// ---------------------------------------------------------------------------
// Access helper
// Policy (shared visibility model):
//   Any authenticated user → can read any run
//   Run does not exist     → false (caller returns 404 or 403)
// Destructive actions (delete/mutate) are enforced at the route level
// via requireRole('admin') and are not handled here.
// ---------------------------------------------------------------------------
function canAccessRun(runId: string, req: Request): boolean {
  if (!req.user) return false; // not authenticated
  const db = getDb();
  const run = db.prepare('SELECT id FROM report_runs WHERE id = ?').get(runId);
  return run != null; // run exists → any authenticated user may read it
}

// ---------------------------------------------------------------------------
// POST /api/upload
// Accepts an Excel file, runs the full pipeline, stores results, returns summary.
// ---------------------------------------------------------------------------

export function handleUploadAndProcess(req: Request, res: Response): void {
  const file = req.file;
  if (!file) {
    res.status(400).json({ success: false, error: 'No file uploaded.' });
    return;
  }

  try {
    // Step 1: store raw data
    const uploadResult = uploadRawData(file.buffer, file.originalname, undefined, req.user?.userId);

    // Step 2: run full pipeline (classify → calculate → aggregate → persist)
    const pipelineResult = processReportRun(uploadResult.runId);

    const s = pipelineResult.summary;

    res.json({
      success:        true,
      runId:          uploadResult.runId,
      reportDate:     pipelineResult.reportDate,
      sourceFilename: uploadResult.sourceFilename,
      rawRowCount:    uploadResult.rawRowCount,
      summary: {
        reportDate:      pipelineResult.reportDate,
        eligibleHqla:    s.hqla.eligibleTotal,
        grossOutflows:   s.grossOutflows,
        grossInflows:    s.cashInflows.total,
        cappedInflows:   s.cappedInflowsTotal,
        netCashOutflows: s.netCashOutflows,
        lcrRatio:        s.lcrRatio,
        ratio7d:         s.lmgRatio7d,
        ratio1m:         s.lmgRatio1m,
        ratio3m:         s.lmgRatio3m,
        ratio3mLr:       s.lmgRatio3mLr,
        meetsMinimum:    s.meetsMinimum,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[reportController] Upload/pipeline error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// POST /api/upload-raw
// Upload only — parse and store raw rows, no pipeline processing.
// Returns runId, reportDate, rawRowCount for the verification workflow.
// ---------------------------------------------------------------------------

export function handleUploadRaw(req: Request, res: Response): void {
  const file = req.file;
  if (!file) {
    res.status(400).json({ success: false, error: 'No file uploaded.' });
    return;
  }

  try {
    // Manual report date from form field (takes priority over filename extraction)
    const manualDate = req.body?.reportDate as string | undefined;
    const uploadResult = uploadRawData(file.buffer, file.originalname, manualDate, req.user?.userId);

    res.json({
      success:        true,
      runId:          uploadResult.runId,
      reportDate:     uploadResult.reportDate,
      sourceFilename: uploadResult.sourceFilename,
      rawRowCount:    uploadResult.rawRowCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[reportController] Upload-raw error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// GET /api/raw-rows?runId=<id>&page=1&pageSize=100
// Returns paginated raw rows for a given report run.
// ---------------------------------------------------------------------------

export function handleGetRawRows(req: Request, res: Response): void {
  const { runId, page, pageSize } = req.query as {
    runId?: string; page?: string; pageSize?: string;
  };

  if (!runId) {
    res.status(400).json({ success: false, error: 'Provide ?runId=<id>' });
    return;
  }

  if (!canAccessRun(runId, req)) {
    res.status(403).json({ success: false, error: 'Access denied.' });
    return;
  }

  try {
    const p  = parseInt(page     ?? '1',   10);
    const ps = parseInt(pageSize ?? '100', 10);
    const result = getRawRows(runId, p, ps);
    res.json({
      success:    true,
      runId,
      page:       p,
      pageSize:   ps,
      total:      result.total,
      totalPages: Math.ceil(result.total / ps),
      rows:       result.rows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// GET /api/latest-run
// Returns metadata for the most recently uploaded run (any user).
// Used by the frontend to auto-load the latest report on page open.
// ---------------------------------------------------------------------------

export function handleGetLatestRun(_req: Request, res: Response): void {
  try {
    const db = getDb();
    // Shared visibility: return the most recently uploaded run across all users.
    // Among runs for the same report_date, only the latest upload is considered
    // (consistent with the deduplication rule applied in handleListHistory).
    type LatestRunRow = { run_id: string; report_date: string; source_filename: string; uploaded_at: string; row_count: number };
    const row = db.prepare(`
      SELECT rr.id AS run_id, rr.report_date, rr.source_filename, rr.uploaded_at,
             (SELECT COUNT(*) FROM raw_rows WHERE report_run_id = rr.id) AS row_count
      FROM report_runs rr
      WHERE rr.id = (
        SELECT sub.id FROM report_runs sub
        WHERE sub.report_date = rr.report_date
        ORDER BY sub.uploaded_at DESC LIMIT 1
      )
      ORDER BY rr.uploaded_at DESC LIMIT 1
    `).get() as LatestRunRow | undefined;

    if (!row) {
      res.json({ success: true, found: false });
      return;
    }

    res.json({
      success: true,
      found: true,
      runId: row.run_id,
      reportDate: row.report_date,
      sourceFilename: row.source_filename,
      uploadedAt: row.uploaded_at,
      rawRowCount: row.row_count,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// GET /api/history
// Returns a list of all available report dates with summary snapshots.
// ---------------------------------------------------------------------------

export function handleListHistory(_req: Request, res: Response): void {
  try {
    const db = getDb();

    // Shared visibility: all authenticated users see the same history.
    // Deduplication: for each report_date, only the most recently uploaded run is returned.
    // Older duplicate uploads for the same date are soft-hidden (still in DB for audit).
    const rows = db.prepare(`
      SELECT rr.id AS run_id, rr.report_date, rr.source_filename, rr.uploaded_at, rr.status,
             rs.eligible_hqla, rs.gross_outflows, rs.net_cash_outflows, rs.lcr_ratio, rs.ratio_3m_lr
      FROM report_runs rr
      LEFT JOIN report_summaries rs ON rs.report_run_id = rr.id
      WHERE rr.id = (
        SELECT id FROM report_runs
        WHERE report_date = rr.report_date
        ORDER BY uploaded_at DESC LIMIT 1
      )
      ORDER BY rr.report_date DESC
    `).all() as Array<{
      run_id: string; report_date: string; source_filename: string; uploaded_at: string; status: string;
      eligible_hqla: number | null; gross_outflows: number | null;
      net_cash_outflows: number | null; lcr_ratio: number | null; ratio_3m_lr: number | null;
    }>;

    const items = rows.map((r: any) => ({
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

    res.json({ success: true, items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/history/reset
// Deletes ALL run history data (report_summaries, processed_rows, raw_rows,
// report_runs). Does NOT touch reference tables (account_mappings, etc.).
// ---------------------------------------------------------------------------

export function handleDeleteRun(req: Request, res: Response): void {
  try {
    const { runId } = req.params;
    if (!runId) {
      res.status(400).json({ success: false, error: 'runId is required' });
      return;
    }

    const db = getDb();
    const exists = db.prepare('SELECT id FROM report_runs WHERE id = ?').get(runId);
    if (!exists) {
      res.status(404).json({ success: false, error: 'Run not found.' });
      return;
    }
    db.prepare('DELETE FROM report_summaries WHERE report_run_id = ?').run(runId);
    db.prepare('DELETE FROM processed_rows WHERE report_run_id = ?').run(runId);
    db.prepare('DELETE FROM raw_rows WHERE report_run_id = ?').run(runId);
    db.prepare('DELETE FROM report_runs WHERE id = ?').run(runId);

    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

export function handleResetHistory(_req: Request, res: Response): void {
  try {
    const db = getDb();
    db.exec(`
      DELETE FROM report_summaries;
      DELETE FROM processed_rows;
      DELETE FROM raw_rows;
      DELETE FROM report_runs;
    `);
    res.json({ success: true, message: 'All history data has been deleted.' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// GET /api/summary?date=YYYY-MM-DD
// Returns the summary for a specific report date (latest run for that date).
// Also accepts ?runId=<uuid> to load a specific run.
// ---------------------------------------------------------------------------

export function handleGetSummary(req: Request, res: Response): void {
  const { date, runId } = req.query as { date?: string; runId?: string };

  try {
    let summary = null;

    if (runId) {
      summary = getSummaryByRunId(runId);
    } else if (date) {
      summary = getSummaryByDate(date);
    } else {
      res.status(400).json({ success: false, error: 'Provide ?date=YYYY-MM-DD or ?runId=<id>' });
      return;
    }

    if (!summary) {
      res.status(404).json({ success: false, error: 'No summary found for the requested date/run.' });
      return;
    }

    res.json({ success: true, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// GET /api/debug/rows?runId=<id>&page=1&pageSize=100
// Returns processed row details for debugging/reconciliation.
// Intentionally kept separate from main UI flow.
// ---------------------------------------------------------------------------

export function handleGetDebugRows(req: Request, res: Response): void {
  const { runId, page, pageSize } = req.query as {
    runId?: string; page?: string; pageSize?: string;
  };

  if (!runId) {
    res.status(400).json({ success: false, error: 'Provide ?runId=<id>' });
    return;
  }

  if (!canAccessRun(runId, req)) {
    res.status(403).json({ success: false, error: 'Access denied.' });
    return;
  }

  try {
    const p  = parseInt(page     ?? '1',   10);
    const ps = parseInt(pageSize ?? '100', 10);
    const result = getProcessedRows(runId, p, ps);
    res.json({
      success:   true,
      runId,
      page:      p,
      pageSize:  ps,
      total:     result.total,
      totalPages: Math.ceil(result.total / ps),
      rows:      result.rows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// GET /api/verify/column-l?runId=<id>&page=1&pageSize=50
// For each raw row, run the account mapping VLOOKUP and return the L-column
// equivalent value so the user can compare against their Excel row by row.
// ---------------------------------------------------------------------------

export function handleVerifyColumnL(req: Request, res: Response): void {
  const { runId, page, pageSize } = req.query as {
    runId?: string; page?: string; pageSize?: string;
  };

  if (!runId) {
    res.status(400).json({ success: false, error: 'Provide ?runId=<id>' });
    return;
  }

  if (!canAccessRun(runId, req)) {
    res.status(403).json({ success: false, error: 'Access denied.' });
    return;
  }

  try {
    // Ensure account mapping index is built
    loadReferenceDataFromDb();

    const db = getDb();
    const p  = parseInt(page     ?? '1',  10);
    const ps = parseInt(pageSize ?? '50', 10);

    // Total count
    const total = (db.prepare(
      'SELECT COUNT(*) AS cnt FROM raw_rows WHERE report_run_id = ?'
    ).get(runId) as { cnt: number }).cnt;

    const offset = (p - 1) * ps;

    // Fetch report date for this run
    const runMeta = db.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as
      { report_date: string } | undefined;
    const reportDate = runMeta?.report_date ?? '';

    // Fetch raw rows for this page
    const rawDbRows = db.prepare(`
      SELECT id, row_number, ac_code, ac_name, ref_no, counterparty_no,
             base_ccy_amt, maturity_date
      FROM raw_rows
      WHERE report_run_id = ?
      ORDER BY row_number
      LIMIT ? OFFSET ?
    `).all(runId, ps, offset) as Array<{
      id: number; row_number: number; ac_code: string | null;
      ac_name: string | null; ref_no: string | null;
      counterparty_no: string | null; base_ccy_amt: number | null;
      maturity_date: string | null;
    }>;

    // ---------------------------------------------------------------
    // N-column override (BS_RE33 H4:H6, I4)
    // ---------------------------------------------------------------
    const N_OVERRIDE_REFNOS = new Set(['RCH3001AUD', 'RCH3002AUD', 'RCH4001USD']);
    const N_OVERRIDE_VALUE  = 'Non Cash Flow';

    // ---------------------------------------------------------------
    // O-column: Customer Type lookup
    // Excel: =IF(OR(L="Loan",L="Deposit_Liability",L="OFF_Unused Loan Commitment",L="HQLA"),
    //            VLOOKUP(D7,'Customer Type'!$A$3:$C$38, 3, 0), "")
    //
    // O is populated ONLY when L (Category) is one of these 4 values.
    // Otherwise O = "" (blank).
    // ---------------------------------------------------------------
    const O_ELIGIBLE_CATEGORIES = new Set([
      'Loan', 'Deposit_Liability', 'OFF_Unused Loan Commitment', 'HQLA',
    ]);

    // ---------------------------------------------------------------
    // Q-column: Adjusted Base Ccy Amt (sign flip)
    // Excel: =IF(COUNTIF('Account Mapping'!$H$12:$H$45, A7)>0, -H7, H7)
    // If the account code is in the sign-flip list → Q = -H, else Q = H.
    // ---------------------------------------------------------------
    const Q_SIGN_FLIP_CODES = new Set([
      '10690001','10690002','10690003','10690004','10690005','10690006','10690007','10690008',
      '16100001','16100002','18800002',
      '20920001','20920002','20920003','20920004','20920005','20920006','20920007','20920008',
      '20920009','20920011','20920012','20920013','20920014','20920015','20920016','20920017',
      '20920018','20920019','20920021','20920022','20920023','20920024','20920025',
    ]);

    // Build customer type lookup map from DB (raw Excel values)
    const ctRows = db.prepare(
      'SELECT counterparty_no, customer_type FROM customer_types'
    ).all() as Array<{ counterparty_no: string; customer_type: string }>;
    const ctMap = new Map(ctRows.map((r) => [r.counterparty_no.trim(), r.customer_type]));

    // ---------------------------------------------------------------
    // R-column: Assumption rate lookup
    // Excel: =VLOOKUP(P7, Assumptions!$C$2:$D$64, 2, 0)
    // Lookup key = P (pKey), returns assumption rate (%).
    // If no match → #N/A in Excel (we return null).
    // ---------------------------------------------------------------
    const arRows = db.prepare(
      'SELECT p_key, assumption_rate FROM assumption_rules'
    ).all() as Array<{ p_key: string; assumption_rate: number }>;
    const arMap = new Map(arRows.map((r) => [r.p_key.trim(), r.assumption_rate]));

    // ---------------------------------------------------------------
    // S-column: LCR Maturity
    // Excel: =IFERROR(VLOOKUP(A7,'Maturity Adjustment'!$A$3:$C$81,3,0),
    //                  IF(J7<$N$4,"Tomorrow",J7))
    //
    // 1. VLOOKUP acCode in Maturity Adjustment → get column C
    //    Types: "Tomorrow" (string), far_future (2999-12-31 date),
    //           year_end, eomonth_plus_N, edate_year_end_60M (formulas)
    // 2. If no match → IF(J < reportDate, "Tomorrow", J)
    //    If J is empty → empty < any date → "Tomorrow"
    // ---------------------------------------------------------------
    const moRows = db.prepare(
      'SELECT ac_code, formula_type, formula_params FROM maturity_overrides'
    ).all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;
    const moMap = new Map(moRows.map((r) => [(r.ac_code ?? '').trim(), r]));

    /** Resolve a maturity override formula to a concrete value given reportDate */
    function resolveMaturityOverride(
      formulaType: string,
      formulaParams: string | null,
      rd: string,
    ): string {
      switch (formulaType) {
        case 'tomorrow':
          return 'Tomorrow';
        case 'far_future':
          return '2999-12-31';
        case 'year_end': {
          // DATE(YEAR(N4), 12, 31)
          const year = rd.substring(0, 4);
          return year + '-12-31';
        }
        case 'eomonth_plus_N': {
          // EOMONTH(N4, 0) + days
          const params = formulaParams ? JSON.parse(formulaParams) as { days?: number } : {};
          const days = params.days ?? 0;
          const d = new Date(rd + 'T00:00:00');
          // End of month: go to next month day 0
          const eom = new Date(d.getFullYear(), d.getMonth() + 1, 0);
          eom.setDate(eom.getDate() + days);
          return eom.toISOString().substring(0, 10);
        }
        case 'edate_year_end_60M': {
          // DATE(YEAR(EDATE(N4, 60)), 12, 31) = Dec 31 of (reportYear + 5)
          const year = parseInt(rd.substring(0, 4)) + 5;
          return year + '-12-31';
        }
        default:
          return '';
      }
    }

    /** Compute S for a single row */
    function computeS(
      acCode: string,
      maturityDate: string | null,
      rd: string,
    ): { s: string; sSource: 'override' | 'fallback' } {
      const mo = moMap.get(acCode);
      if (mo) {
        return {
          s: resolveMaturityOverride(mo.formula_type, mo.formula_params, rd),
          sSource: 'override',
        };
      }
      // Fallback: IF(J < N4, "Tomorrow", J)
      // Empty J → "Tomorrow" (Excel: empty < date serial → true)
      if (!maturityDate) {
        return { s: 'Tomorrow', sSource: 'fallback' };
      }
      if (maturityDate < rd) {
        return { s: 'Tomorrow', sSource: 'fallback' };
      }
      return { s: maturityDate, sSource: 'fallback' };
    }

    /** Compute T from S and reportDate */
    function computeT(s: string, rd: string): number | null {
      if (s === 'Tomorrow') return 1;
      if (!s) return null;
      // T = S - N4 (days difference)
      const sDate = new Date(s + 'T00:00:00');
      const rdDate = new Date(rd + 'T00:00:00');
      if (isNaN(sDate.getTime()) || isNaN(rdDate.getTime())) return null;
      return Math.round((sDate.getTime() - rdDate.getTime()) / (24 * 60 * 60 * 1000));
    }

    // ---------------------------------------------------------------
    // X-AG bucket allocation
    // Each bucket has a date range [start, end]. V is compared against
    // these ranges. Q is placed into exactly one bucket.
    // X (O/N): special — "Tomorrow" always goes here.
    //   Range: [N4, N4+1]
    // Y-AG: IF(AND(V > start-1, V < end), Q, IF(V = end, Q, 0))
    //   which is equivalent to: V in [start, end] → Q
    // AH: check column = (Q == SUM(X:AG))
    // ---------------------------------------------------------------
    function edate(base: Date, months: number): Date {
      const d = new Date(base);
      d.setMonth(d.getMonth() + months);
      return d;
    }
    function dateStr(d: Date): string {
      return d.toISOString().substring(0, 10);
    }

    const rd0 = new Date(reportDate + 'T00:00:00');
    // Bucket boundaries: [start, end] as ISO date strings
    // X:  O/N            N4        .. N4+1
    // Y:  2-7D           N4+2      .. N4+7
    // Z:  8D-1M          N4+8      .. EDATE(N4,1)
    // AA: 1-3M           EDATE(N4,1)+1 .. EDATE(N4,3)
    // AB: 3-6M           EDATE(N4,3)+1 .. EDATE(N4,6)
    // AC: 6-12M          EDATE(N4,6)+1 .. EDATE(N4,12)
    // AD: 1-3Y           EDATE(N4,12)+1 .. EDATE(N4,36)
    // AE: 3-5Y           EDATE(N4,36)+1 .. EDATE(N4,60)
    // AF: 5-10Y          EDATE(N4,60)+1 .. EDATE(N4,120)
    // AG: 10Y+/NoMat     EDATE(N4,120)+1 .. 2999-12-31
    function addDays(d: Date, n: number): Date {
      const r = new Date(d);
      r.setDate(r.getDate() + n);
      return r;
    }

    const em1 = edate(rd0, 1);
    const em3 = edate(rd0, 3);
    const em6 = edate(rd0, 6);
    const em12 = edate(rd0, 12);
    const em36 = edate(rd0, 36);
    const em60 = edate(rd0, 60);
    const em120 = edate(rd0, 120);

    const BUCKET_NAMES = ['X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG'] as const;
    const BUCKET_LABELS = ['O/N', '2-7D', '8D-1M', '1-3M', '3-6M', '6-12M', '1-3Y', '3-5Y', '5-10Y', '10Y+'] as const;
    // Each bucket: [startDate, endDate] (inclusive on both sides)
    const bucketRanges: Array<[string, string]> = [
      [dateStr(rd0),              dateStr(addDays(rd0, 1))],     // X: O/N
      [dateStr(addDays(rd0, 2)),  dateStr(addDays(rd0, 7))],     // Y: 2-7D
      [dateStr(addDays(rd0, 8)),  dateStr(em1)],                 // Z: 8D-1M
      [dateStr(addDays(em1, 1)),  dateStr(em3)],                 // AA: 1-3M
      [dateStr(addDays(em3, 1)),  dateStr(em6)],                 // AB: 3-6M
      [dateStr(addDays(em6, 1)),  dateStr(em12)],                // AC: 6-12M
      [dateStr(addDays(em12, 1)), dateStr(em36)],                // AD: 1-3Y
      [dateStr(addDays(em36, 1)), dateStr(em60)],                // AE: 3-5Y
      [dateStr(addDays(em60, 1)), dateStr(em120)],               // AF: 5-10Y
      [dateStr(addDays(em120, 1)), '2999-12-31'],                // AG: 10Y+
    ];

    /** Allocate Q into buckets X-AG based on V date */
    function allocateBuckets(vVal: string, qVal: number): number[] {
      const result = new Array(10).fill(0);
      // "Tomorrow" always goes to X (O/N)
      if (vVal === 'Tomorrow') {
        result[0] = qVal;
        return result;
      }
      // Empty V → no allocation
      if (!vVal) return result;
      // Compare V against each bucket range
      for (let i = 0; i < bucketRanges.length; i++) {
        const [start, end] = bucketRanges[i];
        if (vVal >= start && vVal <= end) {
          result[i] = qVal;
          return result;
        }
      }
      // No bucket matched (shouldn't happen if ranges cover all dates)
      return result;
    }

    const rows = rawDbRows.map((r) => {
      const mapping  = lookupAccountMapping(r.ac_code);
      const refNo    = r.ref_no?.trim() ?? '';
      const isNOverride = N_OVERRIDE_REFNOS.has(refNo);

      const category       = mapping?.category       ?? '';
      const middleCategory = mapping?.middleCategory ?? '';
      const n = isNOverride ? N_OVERRIDE_VALUE : (mapping?.hqlaOrCashflowType ?? '');

      // O column: customer type, only for eligible L categories
      const cptyNo = r.counterparty_no?.trim() ?? '';
      let customerType = '';
      let oSource: 'lookup' | 'blank' = 'blank';
      if (O_ELIGIBLE_CATEGORIES.has(category)) {
        customerType = ctMap.get(cptyNo) ?? '';
        oSource = 'lookup';
      }

      // P column: M & "_" & O  (Excel: =M7&"_"&O7)
      const pKey = middleCategory + '_' + customerType;

      // Q column: sign-flipped base_ccy_amt
      const acCodeTrimmed = (r.ac_code ?? '').trim();
      const signFlip = Q_SIGN_FLIP_CODES.has(acCodeTrimmed);
      const baseCcyAmt = r.base_ccy_amt ?? 0;
      const q = signFlip ? -baseCcyAmt : baseCcyAmt;

      // R column: assumption rate from Assumptions sheet via P-key lookup
      const rRate = arMap.get(pKey) ?? null;
      const rSource = rRate !== null ? 'found' as const : 'not_found' as const;

      // U column: ROUND(Q × R, 1)
      // U = ROUND(Q × R, 0) — round to integer
      const u = rRate !== null ? Math.round(q * rRate) : 0;

      // S column: LCR Maturity
      const { s, sSource } = computeS(acCodeTrimmed, r.maturity_date, reportDate);

      // T column: days to maturity
      const t = computeT(s, reportDate);

      // V column: Liquidity Maturity
      const V_OVERRIDE: Record<string, string> = { '10255002': 'Tomorrow' };
      const vOverride = V_OVERRIDE[acCodeTrimmed];
      const v = vOverride ?? s;
      const vSource = vOverride !== undefined ? 'override' as const : 'fallback' as const;

      // W column: Liquidity Gap Asset/Liability
      const w = mapping?.assetLiabilityType ?? '';

      // X-AG bucket allocation + AH check
      const buckets = allocateBuckets(v, q);
      const bucketSum = buckets.reduce((a, b) => a + b, 0);
      const ah = q === bucketSum;
      const hitIdx = buckets.findIndex((b) => b !== 0);
      const hitBucket = hitIdx >= 0 ? BUCKET_LABELS[hitIdx] : '';
      const nonZeroCount = buckets.filter((b) => b !== 0).length;

      return {
        rowNumber:    r.row_number,
        acCode:       acCodeTrimmed,
        acName:       r.ac_name ?? '',
        refNo,
        mapped:       mapping !== null,
        category,
        middleCategory,
        n,
        nSource:      isNOverride ? 'override' as const : 'lookup' as const,
        customerType,
        oSource,
        pKey,
        baseCcyAmt,
        q,
        signFlip,
        rRate,
        rSource,
        u,
        s,
        sSource,
        t,
        v,
        vSource,
        w,
        buckets,
        ah,
        hitBucket,
        nonZeroCount,
      };
    });

    // Compute overall stats across ALL rows (not just this page)
    const allRows = db.prepare(
      'SELECT ac_code, ref_no, counterparty_no FROM raw_rows WHERE report_run_id = ?'
    ).all(runId) as Array<{ ac_code: string | null; ref_no: string | null; counterparty_no: string | null }>;

    let totalMapped = 0;
    let totalUnmapped = 0;
    let totalOverride = 0;
    let totalLookup = 0;
    let totalOPopulated = 0;
    let totalOBlank = 0;
    let totalSignFlip = 0;
    let totalNoFlip = 0;
    let totalRFound = 0;
    let totalRMissing = 0;
    for (const r of allRows) {
      const m = lookupAccountMapping(r.ac_code);
      if (m) totalMapped++; else totalUnmapped++;
      if (N_OVERRIDE_REFNOS.has(r.ref_no?.trim() ?? '')) totalOverride++; else totalLookup++;
      if (O_ELIGIBLE_CATEGORIES.has(m?.category ?? '')) totalOPopulated++; else totalOBlank++;
      if (Q_SIGN_FLIP_CODES.has((r.ac_code ?? '').trim())) totalSignFlip++; else totalNoFlip++;
      // R stat: build pKey and check assumptions
      const mid = m?.middleCategory ?? '';
      const cat = m?.category ?? '';
      const cpty = (r.counterparty_no ?? '').trim();
      const oVal = O_ELIGIBLE_CATEGORIES.has(cat) ? (ctMap.get(cpty) ?? '') : '';
      const pk = mid + '_' + oVal;
      if (arMap.has(pk)) totalRFound++; else totalRMissing++;
    }

    res.json({
      success:       true,
      runId,
      page:          p,
      pageSize:      ps,
      total,
      totalPages:    Math.ceil(total / ps),
      totalMapped,
      totalUnmapped,
      totalOverride,
      totalLookup,
      totalOPopulated,
      totalOBlank,
      totalSignFlip,
      totalNoFlip,
      totalRFound,
      totalRMissing,
      rows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// GET /api/verify/gap-forecast?runId=<id>&type=7day|1month|3month
// Computes the Liquidity Gap Ratio forecast (8 monthly windows).
//   type=7day:   rows 9-19,  to = from + 7,            trigger = 0%
//   type=1month: rows 21-31, to = EOMONTH(from, 1),    trigger = -15%
//   type=3month: rows 33-43, to = EOMONTH(from, 3),    trigger = -40%
// ---------------------------------------------------------------------------

export function handleVerify7DayForecast(req: Request, res: Response): void {
  const { runId, type } = req.query as { runId?: string; type?: string };
  const forecastType = type === '1month' ? '1month' : type === '3month' ? '3month' : '7day';
  if (!runId) {
    res.status(400).json({ success: false, error: 'Provide ?runId=<id>' });
    return;
  }
  if (!canAccessRun(runId, req)) {
    res.status(403).json({ success: false, error: 'Access denied.' });
    return;
  }

  try {
    loadReferenceDataFromDb();
    const db = getDb();

    const runMeta = db.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as
      { report_date: string } | undefined;
    if (!runMeta) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }
    const reportDate = runMeta.report_date;

    // Load reference data
    const amRows = db.prepare('SELECT ac_code, asset_liability_type FROM account_mappings')
      .all() as Array<{ ac_code: string; asset_liability_type: string }>;
    const amMap = new Map(amRows.map((r) => [r.ac_code, r.asset_liability_type]));

    const moRows = db.prepare('SELECT ac_code, formula_type, formula_params FROM maturity_overrides')
      .all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;
    const moMap = new Map(moRows.map((r) => [(r.ac_code ?? '').trim(), r]));

    const V_OVERRIDE: Record<string, string> = { '10255002': 'Tomorrow' };

    // UTC-safe date helpers
    function eomonth(dateStr: string, months: number): string {
      const d = new Date(dateStr + 'T12:00:00Z');
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0))
        .toISOString().substring(0, 10);
    }
    function addDaysStr(dateStr: string, n: number): string {
      const d = new Date(dateStr + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().substring(0, 10);
    }

    function resolveOverrideLocal(ft: string, fp: string | null): string {
      switch (ft) {
        case 'tomorrow': return 'Tomorrow';
        case 'far_future': return '2999-12-31';
        case 'year_end': return reportDate.substring(0, 4) + '-12-31';
        case 'eomonth_plus_N': {
          const days = fp ? (JSON.parse(fp) as { days?: number }).days ?? 0 : 0;
          const eom = eomonth(reportDate, 0);
          return addDaysStr(eom, days);
        }
        case 'edate_year_end_60M':
          return (parseInt(reportDate.substring(0, 4)) + 5) + '-12-31';
        default: return '';
      }
    }

    function computeV(ac: string, matDate: string | null): string {
      if (V_OVERRIDE[ac]) return V_OVERRIDE[ac];
      const mo = moMap.get(ac);
      if (mo) return resolveOverrideLocal(mo.formula_type, mo.formula_params);
      if (!matDate || matDate < reportDate) return 'Tomorrow';
      return matDate;
    }

    // Generate 8 monthly windows
    // 7day:   from = EOMONTH chain, to = from + 7
    // 1month: from = EOMONTH chain, to = EOMONTH(from, 1)
    // 3month: from = EOMONTH chain, to = EOMONTH(from, 3) (rolling 3M window)
    const windows: Array<{ from: string; to: string; label: string }> = [];
    let prevStart = eomonth(reportDate, 0); // EOMONTH(N4, 0)
    for (let i = 0; i < 8; i++) {
      const from = prevStart;
      const to = forecastType === '3month' ? eomonth(from, 3)
               : forecastType === '1month' ? eomonth(from, 1)
               : addDaysStr(from, 7);
      const d = new Date(from + 'T12:00:00Z');
      const label = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }) +
        '-' + String(d.getUTCFullYear()).slice(2);
      windows.push({ from, to, label });
      prevStart = eomonth(from, 1); // all types: next start = EOMONTH(prev, 1)
    }

    // Fetch all raw rows
    const rawRows = db.prepare(
      'SELECT ac_code, base_ccy_amt, maturity_date FROM raw_rows WHERE report_run_id = ?'
    ).all(runId) as Array<{
      ac_code: string | null; base_ccy_amt: number | null; maturity_date: string | null;
    }>;

    // Pre-compute V and W for each row once
    const enriched = rawRows.map((r) => {
      const ac = (r.ac_code ?? '').trim();
      const w = amMap.get(ac) ?? '';
      const v = computeV(ac, r.maturity_date);
      const h = r.base_ccy_amt ?? 0;
      return { ac, w, v, h };
    });

    // Total Asset = SUMIF(W, "Asset", H)
    let totalAsset = 0;
    for (const r of enriched) {
      if (r.w === 'Asset') totalAsset += r.h;
    }
    totalAsset = Math.round(totalAsset);

    // Compute per-window values
    // 7day trigger = 0%, 1month trigger = -15%, 3month trigger = -40%
    const TRIGGER = forecastType === '3month' ? -0.40
                  : forecastType === '1month' ? -0.15
                  : 0;

    const months = windows.map(({ from, to, label }) => {
      let asset = 0;
      let liab = 0;
      for (const r of enriched) {
        // SUMIFS condition: (V > from AND V <= to) OR V = "Tomorrow"
        const inWindow = r.v === 'Tomorrow' || (r.v > from && r.v <= to);
        if (!inWindow) continue;
        if (r.w === 'Asset') asset += r.h;
        else if (r.w === 'Liability') liab += r.h;
      }
      asset = Math.round(asset);
      liab = Math.round(liab);
      const gap = asset - liab;
      const gapRatio = totalAsset !== 0 ? gap / totalAsset : null;
      // Shortfall = -TotalAsset * (Trigger - GapRatio) = -TotalAsset * Trigger + TotalAsset * GapRatio
      // When Trigger=0: shortfall = TotalAsset * GapRatio = gap (since gap = gapRatio * totalAsset)
      // Excel: = -AL16 * (AL18 - AL17) = -totalAsset * (trigger - gapRatio)
      const shortfall = gapRatio !== null ? Math.round(-totalAsset * (TRIGGER - gapRatio)) : 0;

      return {
        label,
        from,
        to,
        asset,
        liab,
        gap,
        totalAsset,
        gapRatio,
        trigger: TRIGGER,
        shortfall,
      };
    });

    res.json({
      success: true,
      runId,
      reportDate,
      forecastType,
      totalAsset,
      trigger: TRIGGER,
      months,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// GET /api/verify/lmg-summary?runId=<id>
// Computes the Liquidity Maturity Gap summary from row-level bucket data.
// Reproduces the exact Excel LMG sheet aggregation.
// ---------------------------------------------------------------------------

export function handleVerifyLmgSummary(req: Request, res: Response): void {
  const { runId } = req.query as { runId?: string };

  if (!runId) {
    res.status(400).json({ success: false, error: 'Provide ?runId=<id>' });
    return;
  }
  if (!canAccessRun(runId, req)) {
    res.status(403).json({ success: false, error: 'Access denied.' });
    return;
  }

  try {
    loadReferenceDataFromDb();
    const db = getDb();

    // Fetch run metadata
    const runMeta = db.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as
      { report_date: string } | undefined;
    if (!runMeta) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }
    const reportDate = runMeta.report_date;

    // Fetch ALL raw rows for this run
    const rawDbRows = db.prepare(`
      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date
      FROM raw_rows
      WHERE report_run_id = ?
    `).all(runId) as Array<{
      ac_code: string | null; ref_no: string | null;
      counterparty_no: string | null; base_ccy_amt: number | null;
      maturity_date: string | null;
    }>;

    // --- Reuse the same reference data as column-l endpoint ---
    const O_ELIGIBLE_CATEGORIES = new Set([
      'Loan', 'Deposit_Liability', 'OFF_Unused Loan Commitment', 'HQLA',
    ]);
    const Q_SIGN_FLIP_CODES = new Set([
      '10690001','10690002','10690003','10690004','10690005','10690006','10690007','10690008',
      '16100001','16100002','18800002',
      '20920001','20920002','20920003','20920004','20920005','20920006','20920007','20920008',
      '20920009','20920011','20920012','20920013','20920014','20920015','20920016','20920017',
      '20920018','20920019','20920021','20920022','20920023','20920024','20920025',
    ]);
    const V_OVERRIDE: Record<string, string> = { '10255002': 'Tomorrow' };

    // Customer type map
    const ctRows2 = db.prepare('SELECT counterparty_no, customer_type FROM customer_types')
      .all() as Array<{ counterparty_no: string; customer_type: string }>;
    const ctMap2 = new Map(ctRows2.map((r) => [r.counterparty_no.trim(), r.customer_type]));

    // Maturity overrides
    const moRows2 = db.prepare('SELECT ac_code, formula_type, formula_params FROM maturity_overrides')
      .all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;
    const moMap2 = new Map(moRows2.map((r) => [(r.ac_code ?? '').trim(), r]));

    // Bucket boundaries (same as column-l endpoint)
    function edate2(base: Date, months: number): Date {
      const d = new Date(base); d.setMonth(d.getMonth() + months); return d;
    }
    function addDays2(d: Date, n: number): Date {
      const r = new Date(d); r.setDate(r.getDate() + n); return r;
    }
    function ds2(d: Date): string { return d.toISOString().substring(0, 10); }

    const rd0 = new Date(reportDate + 'T00:00:00');
    const em1 = edate2(rd0,1), em3 = edate2(rd0,3), em6 = edate2(rd0,6), em12 = edate2(rd0,12);
    const em36 = edate2(rd0,36), em60 = edate2(rd0,60), em120 = edate2(rd0,120);
    const bucketRanges2: Array<[string, string]> = [
      [ds2(rd0), ds2(addDays2(rd0,1))],
      [ds2(addDays2(rd0,2)), ds2(addDays2(rd0,7))],
      [ds2(addDays2(rd0,8)), ds2(em1)],
      [ds2(addDays2(em1,1)), ds2(em3)],
      [ds2(addDays2(em3,1)), ds2(em6)],
      [ds2(addDays2(em6,1)), ds2(em12)],
      [ds2(addDays2(em12,1)), ds2(em36)],
      [ds2(addDays2(em36,1)), ds2(em60)],
      [ds2(addDays2(em60,1)), ds2(em120)],
      [ds2(addDays2(em120,1)), '2999-12-31'],
    ];

    function resolveOverride2(ft: string, fp: string | null): string {
      switch (ft) {
        case 'tomorrow': return 'Tomorrow';
        case 'far_future': return '2999-12-31';
        case 'year_end': return reportDate.substring(0,4) + '-12-31';
        case 'eomonth_plus_N': {
          const days = fp ? (JSON.parse(fp) as {days?:number}).days ?? 0 : 0;
          const d = new Date(reportDate + 'T00:00:00');
          const eom = new Date(d.getFullYear(), d.getMonth() + 1, 0);
          eom.setDate(eom.getDate() + days);
          return eom.toISOString().substring(0,10);
        }
        case 'edate_year_end_60M': return (parseInt(reportDate.substring(0,4)) + 5) + '-12-31';
        default: return '';
      }
    }

    function computeV2(ac: string, matDate: string | null): string {
      if (V_OVERRIDE[ac]) return V_OVERRIDE[ac];
      const mo = moMap2.get(ac);
      if (mo) return resolveOverride2(mo.formula_type, mo.formula_params);
      if (!matDate || matDate < reportDate) return 'Tomorrow';
      return matDate;
    }

    function allocateBuckets2(vVal: string, qVal: number): number[] {
      const result = new Array(10).fill(0);
      if (vVal === 'Tomorrow') { result[0] = qVal; return result; }
      if (!vVal) return result;
      for (let i = 0; i < bucketRanges2.length; i++) {
        const [start, end] = bucketRanges2[i];
        if (vVal >= start && vVal <= end) { result[i] = qVal; return result; }
      }
      return result;
    }

    // --- Aggregate ---
    // Bucket labels for output
    const BUCKET_LABELS = ['O/N', '2-7D', '8D-1M', '1-3M', '3-6M', '6-12M', '1-3Y', '3-5Y', '5-10Y', '10Y+'];

    // Accumulators: 10 buckets each
    const assetBuckets = new Array(10).fill(0);
    const liabBuckets = new Array(10).fill(0);
    const acceptanceBuckets = new Array(10).fill(0);

    for (const r of rawDbRows) {
      const ac = (r.ac_code ?? '').trim();
      const mapping = lookupAccountMapping(ac);
      if (!mapping) continue;

      const cat = mapping.category;
      const mid = mapping.middleCategory;
      const cptyNo = r.counterparty_no?.trim() ?? '';
      const o = O_ELIGIBLE_CATEGORIES.has(cat) ? (ctMap2.get(cptyNo) ?? '') : '';
      const pKey = mid + '_' + o;

      // Q
      const signFlip = Q_SIGN_FLIP_CODES.has(ac);
      const baseCcyAmt = r.base_ccy_amt ?? 0;
      const q = signFlip ? -baseCcyAmt : baseCcyAmt;

      // V
      const v = computeV2(ac, r.maturity_date);

      // Bucket allocation
      const bk = allocateBuckets2(v, q);

      // W
      const w = mapping.assetLiabilityType ?? '';

      // Accumulate by W classification
      if (w === 'Asset') {
        for (let i = 0; i < 10; i++) assetBuckets[i] += bk[i];
      } else if (w === 'Liability') {
        for (let i = 0; i < 10; i++) liabBuckets[i] += bk[i];
      }
      // Equity and OFF Bal. are NOT included in asset/liability totals.

      // Acceptance deduction: pKey = 'OFF_Acceptance, etc_'
      if (pKey === 'OFF_Acceptance, etc_') {
        for (let i = 0; i < 10; i++) acceptanceBuckets[i] += bk[i];
      }
    }

    // Total Asset (F24) = sum of all asset bucket columns
    const totalAssetF24 = assetBuckets.reduce((a, b) => a + b, 0);

    // Total acceptance = sum of all acceptance buckets (row 58)
    const totalAcceptance = acceptanceBuckets.reduce((a, b) => a + b, 0);
    const acceptanceDeduction = totalAcceptance * 0.20;

    // Cumulative sums for gap ratios
    // 7D = buckets 0+1 (O/N + 2-7D)
    const cumAsset7D = assetBuckets[0] + assetBuckets[1];
    const cumLiab7D  = liabBuckets[0]  + liabBuckets[1];
    // 1M = 7D + bucket 2 (8D-1M)
    const cumAsset1M = cumAsset7D + assetBuckets[2];
    const cumLiab1M  = cumLiab7D  + liabBuckets[2];
    // 3M = 1M + bucket 3 (1-3M)
    const cumAsset3M = cumAsset1M + assetBuckets[3];
    const cumLiab3M  = cumLiab1M  + liabBuckets[3];

    // Gap ratios (Excel formulas from rows 73-75)
    const gap7D  = cumAsset7D - cumLiab7D - acceptanceDeduction;
    const gap1M  = cumAsset1M - cumLiab1M - acceptanceDeduction;
    const gap3M  = cumAsset3M - cumLiab3M - acceptanceDeduction;

    const ratio7D = totalAssetF24 !== 0 ? gap7D / totalAssetF24 : null;
    const ratio1M = totalAssetF24 !== 0 ? gap1M / totalAssetF24 : null;
    const ratio3M = totalAssetF24 !== 0 ? gap3M / totalAssetF24 : null;

    // 3M Liquidity Ratio (Q73) = cumAsset3M / cumLiab3M
    const ratio3MLR = cumLiab3M !== 0 ? cumAsset3M / cumLiab3M : null;

    // Triggers and limits
    const triggers = {
      '7D':  { trigger: 0.0,    limit: -0.05 },
      '1M':  { trigger: -0.15,  limit: -0.20 },
      '3M':  { trigger: -0.40,  limit: -0.45 },
    };

    res.json({
      success: true,
      runId,
      reportDate,
      bucketLabels: BUCKET_LABELS,
      assetBuckets:  assetBuckets.map(Math.round),
      liabBuckets:   liabBuckets.map(Math.round),
      totalAssetF24: Math.round(totalAssetF24),
      acceptanceBuckets: acceptanceBuckets.map(Math.round),
      totalAcceptance:   Math.round(totalAcceptance),
      acceptanceDeduction: Math.round(acceptanceDeduction),
      summary: {
        '7D': {
          cumAsset:   Math.round(cumAsset7D),
          cumLiab:    Math.round(cumLiab7D),
          gap:        Math.round(gap7D),
          totalAsset: Math.round(totalAssetF24),
          ratio:      ratio7D,
          trigger:    triggers['7D'].trigger,
          limit:      triggers['7D'].limit,
          triggerReached: ratio7D !== null ? ratio7D < triggers['7D'].trigger : null,
          limitBreached:  ratio7D !== null ? ratio7D < triggers['7D'].limit : null,
          shortfall:  ratio7D !== null && ratio7D < triggers['7D'].trigger
            ? Math.round(gap7D - triggers['7D'].trigger * totalAssetF24) : 0,
        },
        '1M': {
          cumAsset:   Math.round(cumAsset1M),
          cumLiab:    Math.round(cumLiab1M),
          gap:        Math.round(gap1M),
          totalAsset: Math.round(totalAssetF24),
          ratio:      ratio1M,
          trigger:    triggers['1M'].trigger,
          limit:      triggers['1M'].limit,
          triggerReached: ratio1M !== null ? ratio1M < triggers['1M'].trigger : null,
          limitBreached:  ratio1M !== null ? ratio1M < triggers['1M'].limit : null,
          shortfall:  ratio1M !== null && ratio1M < triggers['1M'].trigger
            ? Math.round(gap1M - triggers['1M'].trigger * totalAssetF24) : 0,
        },
        '3M': {
          cumAsset:   Math.round(cumAsset3M),
          cumLiab:    Math.round(cumLiab3M),
          gap:        Math.round(gap3M),
          totalAsset: Math.round(totalAssetF24),
          ratio:      ratio3M,
          trigger:    triggers['3M'].trigger,
          limit:      triggers['3M'].limit,
          triggerReached: ratio3M !== null ? ratio3M < triggers['3M'].trigger : null,
          limitBreached:  ratio3M !== null ? ratio3M < triggers['3M'].limit : null,
          shortfall:  ratio3M !== null && ratio3M < triggers['3M'].trigger
            ? Math.round(gap3M - triggers['3M'].trigger * totalAssetF24) : 0,
        },
      },
      ratio3MLR,
      // -----------------------------------------------------------------
      // KRI Table (H72:N76) — exact Excel formulas
      // -----------------------------------------------------------------
      kri: {
        '7D': {
          ratio:     ratio7D,                                          // J73
          trigger:   0.0,                                              // K73
          reached:   ratio7D !== null && ratio7D < 0.0 ? 'Y' : 'N',   // L73 = IF(J73<K73,"Y","N")
          limit:     -0.05,                                            // M73
          breached:  ratio7D !== null && ratio7D < -0.05 ? 'Y' : 'N', // N73 = IF(J73<M73,"Y","N")
        },
        '1M': {
          ratio:     ratio1M,                                          // J74
          trigger:   -0.15,                                            // K74
          reached:   ratio1M !== null && ratio1M < -0.15 ? 'Y' : 'N', // L74
          limit:     -0.20,                                            // M74
          breached:  ratio1M !== null && ratio1M < -0.20 ? 'Y' : 'N', // N74
        },
        '3M': {
          ratio:     ratio3M,                                          // J75
          trigger:   -0.40,                                            // K75
          reached:   ratio3M !== null && ratio3M < -0.40 ? 'Y' : 'N', // L75
          limit:     -0.45,                                            // M75
          breached:  ratio3M !== null && ratio3M < -0.45 ? 'Y' : 'N', // N75
        },
      },
      // -----------------------------------------------------------------
      // Secondary Table (P72:Q73)
      // P73 = LCR from '30 days CF Table(ALL)'!D119
      // Q73 = SUM(H24:K24)/SUM(H51:K51) = ratio3MLR (already computed)
      // -----------------------------------------------------------------
      lcrPercent: (() => {
        // Inline D119 computation — same logic as CF Table endpoint
        const arRows3 = db.prepare('SELECT p_key, assumption_rate FROM assumption_rules')
          .all() as Array<{ p_key: string; assumption_rate: number }>;
        const arMap3 = new Map(arRows3.map((r) => [r.p_key.trim(), r.assumption_rate]));

        const day30Str3 = (() => {
          const d = new Date(reportDate + 'T12:00:00Z');
          d.setUTCDate(d.getUTCDate() + 30);
          return d.toISOString().substring(0, 10);
        })();
        function isIn30D(s: string): boolean {
          return s === 'Tomorrow' || (s >= reportDate && s <= day30Str3);
        }
        function computeS3(ac: string, matDate: string | null): string {
          const mo = moMap2.get(ac);
          if (mo) return resolveOverride2(mo.formula_type, mo.formula_params);
          if (!matDate || matDate < reportDate) return 'Tomorrow';
          return matDate;
        }

        const NOR3 = new Set(['RCH3001AUD', 'RCH3002AUD', 'RCH4001USD']);
        const BUYBACK3: Record<string, number> = {
          'Deposit (Certificate of Deposit)': 0.10,
          'Deposit (Term Certificate of Deposit)': 0.05,
          'Bond issued': 0.05,
        };

        let hqlaTotal3 = 0;
        let buyback3 = 0;
        const pKeyData3 = new Map<string, { inOut: string; rawQSum: number; rate: number }>();

        for (const r of rawDbRows) {
          const ac = r.ac_code?.trim() ?? '';
          const mapping = lookupAccountMapping(ac);
          if (!mapping) continue;
          const refNo = r.ref_no?.trim() ?? '';
          const cat = mapping.category;
          const mid = mapping.middleCategory;
          const cpty = r.counterparty_no?.trim() ?? '';
          const o = O_ELIGIBLE_CATEGORIES.has(cat) ? (ctMap2.get(cpty) ?? '') : '';
          const pKey = mid + '_' + o;
          const n = NOR3.has(refNo) ? 'Non Cash Flow' : (mapping.hqlaOrCashflowType ?? '');
          const q = Q_SIGN_FLIP_CODES.has(ac) ? -(r.base_ccy_amt ?? 0) : (r.base_ccy_amt ?? 0);
          const rRate = arMap3.get(pKey) ?? 0;
          const s = computeS3(ac, r.maturity_date);

          if (n === 'HQLA') { hqlaTotal3 += q; }
          if ((n === 'Inflow' || n === 'Outflow') && isIn30D(s)) {
            const ex = pKeyData3.get(pKey);
            if (ex) ex.rawQSum += q;
            else pKeyData3.set(pKey, { inOut: n, rawQSum: q, rate: rRate });
          }
          if (n === 'Outflow' && !isIn30D(s)) {
            const br = BUYBACK3[mid];
            if (br) buyback3 += Math.abs(q) * br;
          }
        }

        let outflow3 = 0, inflow3 = 0;
        for (const [, d] of pKeyData3) {
          const k = d.rawQSum * d.rate;
          if (d.inOut === 'Outflow') outflow3 += k;
          else if (d.inOut === 'Inflow') inflow3 += k;
        }
        const gross3 = outflow3 + buyback3;
        const ho3 = gross3 * 0.20;
        const sumIn3 = inflow3 + ho3;
        const capped3 = Math.min(sumIn3, gross3 * 0.75);
        const net3 = gross3 - capped3;
        return net3 > 0 ? Math.round(hqlaTotal3) / net3 : null;
      })(),
      // ratio3MLR already included above as Q73 equivalent
      totalRows: rawDbRows.length,
    });

    // Persist summary values so the History list can display them.
    try {
      // lcrPercent was computed inline in the response IIFE — recompute as percentage for DB
      // The IIFE returned raw ratio (e.g. 0.7734). DB stores as percentage (77.34).
      const lcrPercentForDb = (() => {
        const arRows3 = db.prepare('SELECT p_key, assumption_rate FROM assumption_rules')
          .all() as Array<{ p_key: string; assumption_rate: number }>;
        const arMap3 = new Map(arRows3.map((r) => [r.p_key.trim(), r.assumption_rate]));
        const day30End = (() => { const d = new Date(reportDate + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().substring(0, 10); })();
        const is30 = (s: string) => s === 'Tomorrow' || (s >= reportDate && s <= day30End);
        const cS = (ac: string, md: string | null) => { const mo = moMap2.get(ac); if (mo) return resolveOverride2(mo.formula_type, mo.formula_params); if (!md || md < reportDate) return 'Tomorrow'; return md; };
        const NR = new Set(['RCH3001AUD', 'RCH3002AUD', 'RCH4001USD']);
        const BR: Record<string, number> = { 'Deposit (Certificate of Deposit)': 0.10, 'Deposit (Term Certificate of Deposit)': 0.05, 'Bond issued': 0.05 };
        let hq = 0, bb = 0;
        const pd = new Map<string, { io: string; qs: number; r: number }>();
        for (const r of rawDbRows) {
          const ac = r.ac_code?.trim() ?? '', m = lookupAccountMapping(ac); if (!m) continue;
          const ref = r.ref_no?.trim() ?? '', mid = m.middleCategory, cp = r.counterparty_no?.trim() ?? '';
          const o = O_ELIGIBLE_CATEGORIES.has(m.category) ? (ctMap2.get(cp) ?? '') : '', pk = mid + '_' + o;
          const n = NR.has(ref) ? 'Non Cash Flow' : (m.hqlaOrCashflowType ?? '');
          const q = Q_SIGN_FLIP_CODES.has(ac) ? -(r.base_ccy_amt ?? 0) : (r.base_ccy_amt ?? 0);
          const rt = arMap3.get(pk) ?? 0, s = cS(ac, r.maturity_date);
          if (n === 'HQLA') hq += q;
          if ((n === 'Inflow' || n === 'Outflow') && is30(s)) { const e = pd.get(pk); if (e) e.qs += q; else pd.set(pk, { io: n, qs: q, r: rt }); }
          if (n === 'Outflow' && !is30(s)) { const br = BR[mid]; if (br) bb += Math.abs(q) * br; }
        }
        let of3 = 0, if3 = 0;
        for (const [, d] of pd) { const k = d.qs * d.r; if (d.io === 'Outflow') of3 += k; else if (d.io === 'Inflow') if3 += k; }
        const g = of3 + bb, net = g - Math.min(if3 + g * 0.20, g * 0.75);
        return net > 0 ? (Math.round(hq) / net) * 100 : null;
      })();

      const { v4: uuidv4 } = require('uuid') as { v4: () => string };
      const existing = db.prepare('SELECT id FROM report_summaries WHERE report_run_id = ?').get(runId) as { id: string } | undefined;
      if (existing) {
        db.prepare('UPDATE report_summaries SET lcr_ratio = ?, ratio_7d = ?, ratio_1m = ?, ratio_3m = ?, ratio_3m_lr = ? WHERE report_run_id = ?')
          .run(lcrPercentForDb, ratio7D, ratio1M, ratio3M, ratio3MLR, runId);
      } else {
        db.prepare(`INSERT INTO report_summaries (id, report_run_id, report_date, eligible_hqla, gross_outflows, gross_inflows, capped_inflows, net_cash_outflows, lcr_ratio, ratio_7d, ratio_1m, ratio_3m, ratio_3m_lr, created_at) VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, datetime('now'))`)
          .run(uuidv4(), runId, reportDate, lcrPercentForDb, ratio7D, ratio1M, ratio3M, ratio3MLR);
      }
    } catch (e) {
      console.warn('[LMG] Failed to persist summary:', e);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// GET /api/debug/bs-re33?runId=<id>&page=1&pageSize=100
// Returns the full BS_RE33-equivalent dataset for debug inspection.
// All rows, columns L through AH. Read-only, no aggregation.
// ---------------------------------------------------------------------------

export function handleDebugBsRe33(req: Request, res: Response): void {
  const { runId, page, pageSize } = req.query as {
    runId?: string; page?: string; pageSize?: string;
  };
  if (!runId) {
    res.status(400).json({ success: false, error: 'Provide ?runId=<id>' });
    return;
  }

  try {
    loadReferenceDataFromDb();
    const db = getDb();

    const runMeta = db.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as
      { report_date: string } | undefined;
    if (!runMeta) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }
    const reportDate = runMeta.report_date;
    const p  = parseInt(page     ?? '1',   10);
    const ps = parseInt(pageSize ?? '100', 10);

    const total = (db.prepare(
      'SELECT COUNT(*) AS cnt FROM raw_rows WHERE report_run_id = ?'
    ).get(runId) as { cnt: number }).cnt;
    const offset = (p - 1) * ps;

    const rawDbRows = db.prepare(`
      SELECT row_number, ac_code, ac_name, ref_no, counterparty_no,
             base_ccy_amt, maturity_date
      FROM raw_rows
      WHERE report_run_id = ?
      ORDER BY row_number
      LIMIT ? OFFSET ?
    `).all(runId, ps, offset) as Array<{
      row_number: number; ac_code: string | null; ac_name: string | null;
      ref_no: string | null; counterparty_no: string | null;
      base_ccy_amt: number | null; maturity_date: string | null;
    }>;

    // --- Reference data (same as column-l/gap-forecast) ---
    const N_OVERRIDE_REFNOS = new Set(['RCH3001AUD', 'RCH3002AUD', 'RCH4001USD']);
    const O_ELIGIBLE_CATEGORIES = new Set([
      'Loan', 'Deposit_Liability', 'OFF_Unused Loan Commitment', 'HQLA',
    ]);
    const Q_SIGN_FLIP_CODES = new Set([
      '10690001','10690002','10690003','10690004','10690005','10690006','10690007','10690008',
      '16100001','16100002','18800002',
      '20920001','20920002','20920003','20920004','20920005','20920006','20920007','20920008',
      '20920009','20920011','20920012','20920013','20920014','20920015','20920016','20920017',
      '20920018','20920019','20920021','20920022','20920023','20920024','20920025',
    ]);
    const V_OVERRIDE: Record<string, string> = { '10255002': 'Tomorrow' };

    const ctRows2 = db.prepare('SELECT counterparty_no, customer_type FROM customer_types')
      .all() as Array<{ counterparty_no: string; customer_type: string }>;
    const ctMap = new Map(ctRows2.map((r) => [r.counterparty_no.trim(), r.customer_type]));

    const arRows2 = db.prepare('SELECT p_key, assumption_rate FROM assumption_rules')
      .all() as Array<{ p_key: string; assumption_rate: number }>;
    const arMap = new Map(arRows2.map((r) => [r.p_key.trim(), r.assumption_rate]));

    const moRows2 = db.prepare('SELECT ac_code, formula_type, formula_params FROM maturity_overrides')
      .all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;
    const moMap = new Map(moRows2.map((r) => [(r.ac_code ?? '').trim(), r]));

    // --- S-column helpers ---
    function eomonthL(dateStr: string, months: number): string {
      const d = new Date(dateStr + 'T12:00:00Z');
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0))
        .toISOString().substring(0, 10);
    }
    function addDaysL(dateStr: string, n: number): string {
      const d = new Date(dateStr + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().substring(0, 10);
    }
    function resolveOvr(ft: string, fp: string | null): string {
      switch (ft) {
        case 'tomorrow': return 'Tomorrow';
        case 'far_future': return '2999-12-31';
        case 'year_end': return reportDate.substring(0, 4) + '-12-31';
        case 'eomonth_plus_N': {
          const days = fp ? (JSON.parse(fp) as { days?: number }).days ?? 0 : 0;
          return addDaysL(eomonthL(reportDate, 0), days);
        }
        case 'edate_year_end_60M':
          return (parseInt(reportDate.substring(0, 4)) + 5) + '-12-31';
        default: return '';
      }
    }
    function computeS(ac: string, matDate: string | null): { s: string; sSource: string } {
      const mo = moMap.get(ac);
      if (mo) return { s: resolveOvr(mo.formula_type, mo.formula_params), sSource: 'override' };
      if (!matDate || matDate < reportDate) return { s: 'Tomorrow', sSource: 'fallback' };
      return { s: matDate, sSource: 'fallback' };
    }
    function computeT(s: string): number | null {
      if (s === 'Tomorrow') return 1;
      if (!s) return null;
      const sd = new Date(s + 'T00:00:00');
      const rd = new Date(reportDate + 'T00:00:00');
      if (isNaN(sd.getTime())) return null;
      return Math.round((sd.getTime() - rd.getTime()) / 86400000);
    }

    // --- Bucket boundaries ---
    const rd0 = new Date(reportDate + 'T00:00:00');
    function edateL(base: Date, months: number): Date {
      const d = new Date(base); d.setMonth(d.getMonth() + months); return d;
    }
    function addDaysD(d: Date, n: number): Date {
      const r2 = new Date(d); r2.setDate(r2.getDate() + n); return r2;
    }
    function dsL(d: Date): string { return d.toISOString().substring(0, 10); }
    const em1 = edateL(rd0,1), em3 = edateL(rd0,3), em6 = edateL(rd0,6), em12 = edateL(rd0,12);
    const em36 = edateL(rd0,36), em60 = edateL(rd0,60), em120 = edateL(rd0,120);
    const bucketRanges: Array<[string, string]> = [
      [dsL(rd0), dsL(addDaysD(rd0,1))],
      [dsL(addDaysD(rd0,2)), dsL(addDaysD(rd0,7))],
      [dsL(addDaysD(rd0,8)), dsL(em1)],
      [dsL(addDaysD(em1,1)), dsL(em3)],
      [dsL(addDaysD(em3,1)), dsL(em6)],
      [dsL(addDaysD(em6,1)), dsL(em12)],
      [dsL(addDaysD(em12,1)), dsL(em36)],
      [dsL(addDaysD(em36,1)), dsL(em60)],
      [dsL(addDaysD(em60,1)), dsL(em120)],
      [dsL(addDaysD(em120,1)), '2999-12-31'],
    ];
    const BUCKET_NAMES = ['X','Y','Z','AA','AB','AC','AD','AE','AF','AG'];

    function allocateBucketsL(vVal: string, qVal: number): number[] {
      const result = new Array(10).fill(0);
      if (vVal === 'Tomorrow') { result[0] = qVal; return result; }
      if (!vVal) return result;
      for (let i = 0; i < bucketRanges.length; i++) {
        if (vVal >= bucketRanges[i][0] && vVal <= bucketRanges[i][1]) {
          result[i] = qVal; return result;
        }
      }
      return result;
    }

    // --- Compute each row ---
    const rows = rawDbRows.map((r) => {
      const ac = (r.ac_code ?? '').trim();
      const mapping = lookupAccountMapping(ac);
      const refNo = r.ref_no?.trim() ?? '';
      const isNOvr = N_OVERRIDE_REFNOS.has(refNo);
      const cat = mapping?.category ?? '';
      const mid = mapping?.middleCategory ?? '';
      const n = isNOvr ? 'Non Cash Flow' : (mapping?.hqlaOrCashflowType ?? '');
      const cptyNo = r.counterparty_no?.trim() ?? '';
      const o = O_ELIGIBLE_CATEGORIES.has(cat) ? (ctMap.get(cptyNo) ?? '') : '';
      const pKey = mid + '_' + o;
      const signFlip = Q_SIGN_FLIP_CODES.has(ac);
      const h = r.base_ccy_amt ?? 0;
      const q = signFlip ? -h : h;
      const rRate = arMap.get(pKey) ?? null;
      const u = rRate !== null ? Math.round(q * rRate) : 0;
      const { s, sSource } = computeS(ac, r.maturity_date);
      const t = computeT(s);
      const vOvr = V_OVERRIDE[ac];
      const v = vOvr ?? s;
      const w = mapping?.assetLiabilityType ?? '';
      const buckets = allocateBucketsL(v, q);
      const ah = q === buckets.reduce((a2, b) => a2 + b, 0);

      return {
        row: r.row_number,
        acCode: ac,
        acName: r.ac_name ?? '',
        refNo,
        cptyNo,
        L: cat,
        M: mid,
        N: n,
        O: o,
        P: pKey,
        H: h,
        Q: q,
        R: rRate,
        S: s,
        sSource,
        T: t,
        U: u,
        V: v,
        W: w,
        buckets,
        AH: ah,
      };
    });

    res.json({
      success: true,
      runId,
      reportDate,
      page: p,
      pageSize: ps,
      total,
      totalPages: Math.ceil(total / ps),
      bucketNames: BUCKET_NAMES,
      bucketRanges: bucketRanges.map(([s, e], i) => ({
        name: BUCKET_NAMES[i], start: s, end: e,
      })),
      rows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// GET /api/account-mappings?page=1&pageSize=50
// Returns the Account Mapping reference table from DB for inspection.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /api/verify/cf-table?runId=<id>
// Computes the 30-day CF Table(ALL) equivalent.
// Replicates Excel rows 97-119: Outflow, Buyback, Inflow, LCR.
// ---------------------------------------------------------------------------

export function handleVerifyCfTable(req: Request, res: Response): void {
  const { runId } = req.query as { runId?: string };
  if (!runId) {
    res.status(400).json({ success: false, error: 'Provide ?runId=<id>' });
    return;
  }
  if (!canAccessRun(runId, req)) {
    res.status(403).json({ success: false, error: 'Access denied.' });
    return;
  }

  try {
    loadReferenceDataFromDb();
    const db = getDb();

    const runMeta = db.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as
      { report_date: string } | undefined;
    if (!runMeta) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }
    const reportDate = runMeta.report_date;

    // 30-day window end date
    const rd0 = new Date(reportDate + 'T12:00:00Z');
    const day30 = new Date(rd0);
    day30.setUTCDate(day30.getUTCDate() + 30);
    const day30Str = day30.toISOString().substring(0, 10);

    // Reference data
    const N_OVERRIDE_REFNOS = new Set(['RCH3001AUD', 'RCH3002AUD', 'RCH4001USD']);
    const O_ELIGIBLE_CATEGORIES = new Set([
      'Loan', 'Deposit_Liability', 'OFF_Unused Loan Commitment', 'HQLA',
    ]);
    const Q_SIGN_FLIP_CODES = new Set([
      '10690001','10690002','10690003','10690004','10690005','10690006','10690007','10690008',
      '16100001','16100002','18800002',
      '20920001','20920002','20920003','20920004','20920005','20920006','20920007','20920008',
      '20920009','20920011','20920012','20920013','20920014','20920015','20920016','20920017',
      '20920018','20920019','20920021','20920022','20920023','20920024','20920025',
    ]);

    const ctRows = db.prepare('SELECT counterparty_no, customer_type FROM customer_types')
      .all() as Array<{ counterparty_no: string; customer_type: string }>;
    const ctMap = new Map(ctRows.map((r) => [r.counterparty_no.trim(), r.customer_type]));

    const arRows = db.prepare('SELECT p_key, assumption_rate FROM assumption_rules')
      .all() as Array<{ p_key: string; assumption_rate: number }>;
    const arMap = new Map(arRows.map((r) => [r.p_key.trim(), r.assumption_rate]));

    const moRows = db.prepare('SELECT ac_code, formula_type, formula_params FROM maturity_overrides')
      .all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;
    const moMap = new Map(moRows.map((r) => [(r.ac_code ?? '').trim(), r]));

    // S-column helpers (LCR maturity — same as column-l endpoint)
    function eomonthLocal(dateStr: string, months: number): string {
      const d = new Date(dateStr + 'T12:00:00Z');
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0))
        .toISOString().substring(0, 10);
    }
    function addDaysLocal(dateStr: string, n: number): string {
      const d = new Date(dateStr + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().substring(0, 10);
    }
    function resolveMatAdj(ft: string, fp: string | null): string {
      switch (ft) {
        case 'tomorrow': return 'Tomorrow';
        case 'far_future': return '2999-12-31';
        case 'year_end': return reportDate.substring(0, 4) + '-12-31';
        case 'eomonth_plus_N': {
          const days = fp ? (JSON.parse(fp) as { days?: number }).days ?? 0 : 0;
          return addDaysLocal(eomonthLocal(reportDate, 0), days);
        }
        case 'edate_year_end_60M':
          return (parseInt(reportDate.substring(0, 4)) + 5) + '-12-31';
        default: return '';
      }
    }
    function computeS(ac: string, matDate: string | null): string {
      const mo = moMap.get(ac);
      if (mo) return resolveMatAdj(mo.formula_type, mo.formula_params);
      if (!matDate || matDate < reportDate) return 'Tomorrow';
      return matDate;
    }

    /** Is S within the 30-day LCR window? */
    function isIn30DayWindow(s: string): boolean {
      if (s === 'Tomorrow') return true;
      return s >= reportDate && s <= day30Str;
    }

    // Fetch all raw rows
    const rawDbRows = db.prepare(`
      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date
      FROM raw_rows WHERE report_run_id = ?
    `).all(runId) as Array<{
      ac_code: string | null; ref_no: string | null;
      counterparty_no: string | null; base_ccy_amt: number | null;
      maturity_date: string | null;
    }>;

    // Per-pKey accumulation for the CF table rows.
    // K = SUM(daily_Q) * rate — sum raw Q first, then multiply by rate, then round.
    // NOT Math.round(q*rate) per row then sum (which causes rounding drift).
    const pKeyData = new Map<string, {
      pKey: string; inOut: string; assumptionRate: number;
      rawQSum: number;
      middleCategory: string;
    }>();

    // HQLA accumulation (by P-key, all rows regardless of maturity)
    let hqlaTotal = 0;

    // Buyback: beyond-30-day amounts for specific middleCategories
    const BUYBACK_RATES: Record<string, number> = {
      'Deposit (Certificate of Deposit)': 0.10,
      'Deposit (Term Certificate of Deposit)': 0.05,
      'Bond issued': 0.05,
    };
    let buybackOutflow = 0;

    for (const r of rawDbRows) {
      const ac = (r.ac_code ?? '').trim();
      const mapping = lookupAccountMapping(ac);
      if (!mapping) continue;

      const refNo = r.ref_no?.trim() ?? '';
      const cat = mapping.category;
      const mid = mapping.middleCategory;
      const cptyNo = r.counterparty_no?.trim() ?? '';
      const o = O_ELIGIBLE_CATEGORIES.has(cat) ? (ctMap.get(cptyNo) ?? '') : '';
      const pKey = mid + '_' + o;

      // N (LCR Classification with override)
      const isNOverride = N_OVERRIDE_REFNOS.has(refNo);
      const n = isNOverride ? 'Non Cash Flow' : (mapping.hqlaOrCashflowType ?? '');

      // Q (sign-adjusted)
      const signFlip = Q_SIGN_FLIP_CODES.has(ac);
      const baseCcyAmt = r.base_ccy_amt ?? 0;
      const q = signFlip ? -baseCcyAmt : baseCcyAmt;

      // R (assumption rate)
      const rRate = arMap.get(pKey) ?? 0;

      // S (LCR maturity)
      const s = computeS(ac, r.maturity_date);

      // Determine In/Out classification from N
      let inOut = '';
      if (n === 'Inflow') inOut = 'Inflow';
      else if (n === 'Outflow') inOut = 'Outflow';
      else if (n === 'HQLA') inOut = 'HQLA';
      // "Non Cash Flow" → excluded from CF table flow

      // HQLA: all rows count (no maturity filter)
      if (n === 'HQLA') {
        hqlaTotal += q;  // raw amount, not weighted — HQLA uses rate=1
      }

      // For Inflow/Outflow: only 30-day window rows contribute to K
      // Accumulate raw Q — K = ROUND(SUM(Q) * rate) at the pKey level, not per row
      if ((inOut === 'Inflow' || inOut === 'Outflow') && isIn30DayWindow(s)) {
        const existing = pKeyData.get(pKey);
        if (existing) {
          existing.rawQSum += q;
        } else {
          pKeyData.set(pKey, {
            pKey, inOut, assumptionRate: rRate,
            rawQSum: q,
            middleCategory: mid,
          });
        }
      }

      // Buyback: beyond-30-day outflow rows for specific middleCategories
      if (inOut === 'Outflow' && !isIn30DayWindow(s)) {
        const buybackRate = BUYBACK_RATES[mid];
        if (buybackRate) {
          buybackOutflow += Math.abs(q) * buybackRate;
        }
      }
    }

    // D97: base outflow = sum of weighted K for I="Outflow"
    let baseOutflow = 0;
    let baseInflow = 0;
    const outflowRows: Array<{ pKey: string; amount: number; rate: number }> = [];
    const inflowRows: Array<{ pKey: string; amount: number; rate: number }> = [];

    for (const [, d] of pKeyData) {
      // K = SUM(Q) * rate — keep fractional, same as Excel K cells.
      // D97/D106 = SUMIF over fractional K values. Round only at the final sum level.
      const k = d.rawQSum * d.assumptionRate;
      if (d.inOut === 'Outflow') {
        baseOutflow += k;
        outflowRows.push({ pKey: d.pKey, amount: Math.round(k), rate: d.assumptionRate });
      } else if (d.inOut === 'Inflow') {
        baseInflow += k;
        inflowRows.push({ pKey: d.pKey, amount: Math.round(k), rate: d.assumptionRate });
      }
    }

    // All intermediate values kept fractional — matches Excel cell behavior.
    // Round only for display (in the JSON response).

    // D103: total gross outflow = D97 + D99 + D101
    const grossOutflow = baseOutflow + buybackOutflow; // fractional

    // D108: HO facility = D103 * 20%
    const hoFacility = grossOutflow * 0.20; // fractional

    // D110: sum of inflow = D106 + D108
    const sumInflow = baseInflow + hoFacility; // fractional

    // D112: capped inflow = MIN(D110, D103 * 75%)
    const cappedInflow = Math.min(sumInflow, grossOutflow * 0.75); // fractional

    // D115: net cash outflow = D103 - D112
    const netCashOutflow = grossOutflow - cappedInflow; // fractional

    // D117: HQLA total
    const hqlaRounded = Math.round(hqlaTotal);

    // D119: LCR = D117 / D115
    const lcr = netCashOutflow > 0 ? hqlaRounded / netCashOutflow : null;

    res.json({
      success: true,
      runId,
      reportDate,
      day30End: day30Str,
      // Display values: round for display, same as Excel cell rendering
      baseOutflow: Math.round(baseOutflow),          // D97
      buybackOutflow: Math.round(buybackOutflow),    // D99
      otherOutflow: 0,                               // D101
      grossOutflow: Math.round(grossOutflow),         // D103
      baseInflow: Math.round(baseInflow),             // D106
      hoFacility: Math.round(hoFacility),             // D108
      sumInflow: Math.round(sumInflow),               // D110
      cappedInflow: Math.round(cappedInflow),         // D112
      netCashOutflow: Math.round(netCashOutflow),     // D115
      hqla: hqlaRounded,                              // D117
      lcr,                                            // D119
      // Detail rows
      outflowRows: outflowRows.sort((a, b) => b.amount - a.amount),
      inflowRows: inflowRows.sort((a, b) => b.amount - a.amount),
      totalRows: rawDbRows.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// POST /api/debug/raw-cells
// Re-reads the uploaded Excel file and returns raw cell values for columns
// A-K WITHOUT any date parsing or transformation. Shows cell type, raw value,
// and Excel-formatted string for every cell.
// ---------------------------------------------------------------------------

export function handleDebugRawCells(req: Request, res: Response): void {
  const file = req.file;
  if (!file) {
    res.status(400).json({ success: false, error: 'No file uploaded.' });
    return;
  }

  try {
    const XLSX = require('xlsx') as typeof import('xlsx');

    // Read WITHOUT cellDates — keeps date serials as numbers
    const wb = XLSX.read(file.buffer, { type: 'buffer', cellNF: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws || !ws['!ref']) {
      res.json({ success: true, rows: [], total: 0 });
      return;
    }

    const range = XLSX.utils.decode_range(ws['!ref']);
    const COL_NAMES = ['A_acCode', 'B_acName', 'C_refNo', 'D_cptyNo', 'E_cptyName',
                       'F_ccy', 'G_balanceAmt', 'H_baseCcyAmt',
                       'I_contractDate', 'J_maturityDate', 'K_resetDate'];

    const rows: Array<Record<string, unknown>> = [];

    for (let r = 1; r <= range.e.r; r++) {
      // Skip empty rows
      let hasData = false;
      for (let c = 0; c <= 10; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v != null) { hasData = true; break; }
      }
      if (!hasData) continue;

      const row: Record<string, unknown> = { rowNumber: r + 1 };

      for (let c = 0; c <= 10; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const colName = COL_NAMES[c];

        if (!cell || cell.v == null) {
          row[colName] = null;
          row[colName + '_type'] = null;
          row[colName + '_raw'] = null;
          row[colName + '_fmt'] = null;
        } else {
          // For date columns (I, J, K = indices 8, 9, 10), show extra detail
          row[colName] = cell.w || String(cell.v);     // Excel-formatted display string
          row[colName + '_type'] = cell.t;              // cell type: s=string, n=number, d=date, b=boolean
          row[colName + '_raw'] = cell.v;               // raw value (serial number for dates)
          row[colName + '_fmt'] = cell.z || null;       // number format code
        }
      }

      rows.push(row);
    }

    res.json({
      success: true,
      filename: file.originalname,
      sheetName: wb.SheetNames[0],
      total: rows.length,
      rows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

export function handleGetAccountMappings(req: Request, res: Response): void {
  const { page, pageSize, search } = req.query as { page?: string; pageSize?: string; search?: string };

  try {
    const db = getDb();
    const p  = parseInt(page     ?? '1',  10);
    const ps = parseInt(pageSize ?? '50', 10);

    const hasSearch = search && search.trim().length > 0;
    const searchPattern = hasSearch ? `%${search.trim()}%` : null;

    const whereClause = hasSearch
      ? 'WHERE ac_code LIKE ? OR ac_name LIKE ?'
      : '';
    const whereParams = hasSearch ? [searchPattern, searchPattern] : [];

    const total = (db.prepare(
      `SELECT COUNT(*) AS cnt FROM account_mappings ${whereClause}`
    ).get(...whereParams) as { cnt: number }).cnt;

    const offset = (p - 1) * ps;

    const rows = db.prepare(`
      SELECT id, ac_code, ac_name, category, middle_category,
             hqla_or_cashflow_type, asset_liability_type
      FROM account_mappings
      ${whereClause}
      ORDER BY ac_code
      LIMIT ? OFFSET ?
    `).all(...whereParams, ps, offset) as Array<{
      id: number; ac_code: string; ac_name: string | null; category: string | null;
      middle_category: string | null; hqla_or_cashflow_type: string | null;
      asset_liability_type: string | null;
    }>;

    res.json({
      success:    true,
      page:       p,
      pageSize:   ps,
      total,
      totalPages: Math.ceil(total / ps),
      rows: rows.map((r) => ({
        id:                 r.id,
        acCode:             r.ac_code,
        acName:             r.ac_name             ?? '',
        category:           r.category            ?? '',
        middleCategory:     r.middle_category     ?? '',
        hqlaOrCashflowType: r.hqla_or_cashflow_type ?? '',
        assetLiabilityType: r.asset_liability_type ?? '',
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// Account Mapping — DISTINCT values for dropdown options
// ---------------------------------------------------------------------------

export function handleGetAccountMappingDistinct(_req: Request, res: Response): void {
  try {
    const db = getDb();

    const queryDistinct = (col: string): string[] =>
      (db.prepare(`SELECT DISTINCT ${col} AS v FROM account_mappings WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col}`).all() as Array<{ v: string }>).map((r) => r.v);

    res.json({
      success: true,
      category:           queryDistinct('category'),
      middleCategory:     queryDistinct('middle_category'),
      hqlaOrCashflowType: queryDistinct('hqla_or_cashflow_type'),
      assetLiabilityType: queryDistinct('asset_liability_type'),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// Account Mapping — CREATE
// ---------------------------------------------------------------------------

export function handleCreateAccountMapping(req: Request, res: Response): void {
  try {
    const { acCode, acName, category, middleCategory, hqlaOrCashflowType, assetLiabilityType } = req.body as {
      acCode: string; acName?: string; category?: string;
      middleCategory?: string; hqlaOrCashflowType?: string; assetLiabilityType?: string;
    };

    if (!acCode || !acCode.trim()) {
      res.status(400).json({ success: false, error: 'acCode is required' });
      return;
    }

    const db = getDb();

    const result = db.prepare(`
      INSERT INTO account_mappings (ac_code, ac_name, category, middle_category, hqla_or_cashflow_type, asset_liability_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      acCode.trim(),
      acName ?? null,
      category ?? null,
      middleCategory ?? null,
      hqlaOrCashflowType ?? null,
      assetLiabilityType ?? null,
    );

    res.json({
      success: true,
      id: result.lastInsertRowid,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes('UNIQUE constraint') ? 409 : 500;
    res.status(status).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// Account Mapping — UPDATE
// ---------------------------------------------------------------------------

export function handleUpdateAccountMapping(req: Request, res: Response): void {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid id' });
      return;
    }

    const { acCode, acName, category, middleCategory, hqlaOrCashflowType, assetLiabilityType } = req.body as {
      acCode: string; acName?: string; category?: string;
      middleCategory?: string; hqlaOrCashflowType?: string; assetLiabilityType?: string;
    };

    if (!acCode || !acCode.trim()) {
      res.status(400).json({ success: false, error: 'acCode is required' });
      return;
    }

    const db = getDb();

    const result = db.prepare(`
      UPDATE account_mappings
      SET ac_code = ?, ac_name = ?, category = ?, middle_category = ?,
          hqla_or_cashflow_type = ?, asset_liability_type = ?
      WHERE id = ?
    `).run(
      acCode.trim(),
      acName ?? null,
      category ?? null,
      middleCategory ?? null,
      hqlaOrCashflowType ?? null,
      assetLiabilityType ?? null,
      id,
    );

    if (result.changes === 0) {
      res.status(404).json({ success: false, error: 'Mapping not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes('UNIQUE constraint') ? 409 : 500;
    res.status(status).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// Account Mapping — DELETE
// ---------------------------------------------------------------------------

export function handleDeleteAccountMapping(req: Request, res: Response): void {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid id' });
      return;
    }

    const db = getDb();
    const result = db.prepare('DELETE FROM account_mappings WHERE id = ?').run(id);

    if (result.changes === 0) {
      res.status(404).json({ success: false, error: 'Mapping not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// GET /api/verify/lcr-forecast?runId=<id>
// Computes monthly LCR projections for 8 months from report date.
// Replicates the CF Table D119 logic but shifts the 30-day window forward
// each month: for month M, window = [M_start, M_start + 30 days].
// ---------------------------------------------------------------------------

export function handleLcrForecast(req: Request, res: Response): void {
  const { runId } = req.query as { runId?: string };
  if (!runId) {
    res.status(400).json({ success: false, error: 'Provide ?runId=<id>' });
    return;
  }
  if (!canAccessRun(runId, req)) {
    res.status(403).json({ success: false, error: 'Access denied.' });
    return;
  }

  try {
    loadReferenceDataFromDb();
    const db = getDb();

    const runMeta = db.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as
      { report_date: string } | undefined;
    if (!runMeta) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }
    const reportDate = runMeta.report_date;

    // Reference data (same as CF Table)
    const N_OVERRIDE_REFNOS = new Set(['RCH3001AUD', 'RCH3002AUD', 'RCH4001USD']);
    const O_ELIGIBLE_CATEGORIES = new Set([
      'Loan', 'Deposit_Liability', 'OFF_Unused Loan Commitment', 'HQLA',
    ]);
    const Q_SIGN_FLIP_CODES = new Set([
      '10690001','10690002','10690003','10690004','10690005','10690006','10690007','10690008',
      '16100001','16100002','18800002',
      '20920001','20920002','20920003','20920004','20920005','20920006','20920007','20920008',
      '20920009','20920011','20920012','20920013','20920014','20920015','20920016','20920017',
      '20920018','20920019','20920021','20920022','20920023','20920024','20920025',
    ]);
    const BUYBACK_RATES_LC: Record<string, number> = {
      'Deposit (Certificate of Deposit)': 0.10,
      'Deposit (Term Certificate of Deposit)': 0.05,
      'Bond issued': 0.05,
    };

    const ctRows = db.prepare('SELECT counterparty_no, customer_type FROM customer_types')
      .all() as Array<{ counterparty_no: string; customer_type: string }>;
    const ctMap = new Map(ctRows.map((r) => [r.counterparty_no.trim(), r.customer_type]));

    const arRows = db.prepare('SELECT p_key, assumption_rate FROM assumption_rules')
      .all() as Array<{ p_key: string; assumption_rate: number }>;
    const arMap = new Map(arRows.map((r) => [r.p_key.trim(), r.assumption_rate]));

    const moRows = db.prepare('SELECT ac_code, formula_type, formula_params FROM maturity_overrides')
      .all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;
    const moMap = new Map(moRows.map((r) => [(r.ac_code ?? '').trim(), r]));

    // Date helpers
    function eomonthLC(dateStr: string, months: number): string {
      const d = new Date(dateStr + 'T12:00:00Z');
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0))
        .toISOString().substring(0, 10);
    }
    function addDaysLC(dateStr: string, n: number): string {
      const d = new Date(dateStr + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().substring(0, 10);
    }
    function resolveMatAdjLC(ft: string, fp: string | null): string {
      switch (ft) {
        case 'tomorrow': return 'Tomorrow';
        case 'far_future': return '2999-12-31';
        case 'year_end': return reportDate.substring(0, 4) + '-12-31';
        case 'eomonth_plus_N': {
          const days = fp ? (JSON.parse(fp) as { days?: number }).days ?? 0 : 0;
          return addDaysLC(eomonthLC(reportDate, 0), days);
        }
        case 'edate_year_end_60M':
          return (parseInt(reportDate.substring(0, 4)) + 5) + '-12-31';
        default: return '';
      }
    }
    function computeSLC(ac: string, matDate: string | null): string {
      const mo = moMap.get(ac);
      if (mo) return resolveMatAdjLC(mo.formula_type, mo.formula_params);
      if (!matDate || matDate < reportDate) return 'Tomorrow';
      return matDate;
    }

    // Fetch all raw rows and pre-compute per-row classification
    const rawDbRows = db.prepare(`
      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date
      FROM raw_rows WHERE report_run_id = ?
    `).all(runId) as Array<{
      ac_code: string | null; ref_no: string | null;
      counterparty_no: string | null; base_ccy_amt: number | null;
      maturity_date: string | null;
    }>;

    const enriched = rawDbRows.map((r) => {
      const ac = (r.ac_code ?? '').trim();
      const mapping = lookupAccountMapping(ac);
      if (!mapping) return null;

      const refNo = r.ref_no?.trim() ?? '';
      const cat = mapping.category;
      const mid = mapping.middleCategory;
      const cptyNo = r.counterparty_no?.trim() ?? '';
      const o = O_ELIGIBLE_CATEGORIES.has(cat) ? (ctMap.get(cptyNo) ?? '') : '';
      const pKey = mid + '_' + o;

      const isNOverride = N_OVERRIDE_REFNOS.has(refNo);
      const n = isNOverride ? 'Non Cash Flow' : (mapping.hqlaOrCashflowType ?? '');

      const signFlip = Q_SIGN_FLIP_CODES.has(ac);
      const baseCcyAmt = r.base_ccy_amt ?? 0;
      const q = signFlip ? -baseCcyAmt : baseCcyAmt;

      const rRate = arMap.get(pKey) ?? 0;
      const s = computeSLC(ac, r.maturity_date);

      let inOut = '';
      if (n === 'Inflow') inOut = 'Inflow';
      else if (n === 'Outflow') inOut = 'Outflow';
      else if (n === 'HQLA') inOut = 'HQLA';

      return { q, rRate, s, inOut, mid, pKey };
    }).filter(Boolean) as Array<{
      q: number; rRate: number; s: string;
      inOut: string; mid: string; pKey: string;
    }>;

    // ---------------------------------------------------------------------------
    // NEW APPROACH: daily-row rolling-window (matches Excel Summary & Working File)
    //
    // Excel logic (rows 21-264):
    //   For each day D:
    //     E[D] (Base Outflow) = Q11 (Tomorrow items) + SUM(Q[D+1 .. D+30])
    //     I[D] (Base Inflow)  = R11 (Tomorrow items) + SUM(R[D+1 .. D+30])
    //   where Q[date] / R[date] = SUMIFS(U, S=date, N="Outflow/Inflow")
    //   i.e., the daily cash flow = sum of (q × rRate) for items maturing on that exact date.
    //
    // Key fix vs. old approach: "Tomorrow" items (S='Tomorrow') are ALWAYS included
    // in every day's window, not just Month 0.
    // ---------------------------------------------------------------------------

    // Step 1: Pre-compute per-date daily cash flows (U = q × rRate)
    let hqlaTotal = 0;
    let tomorrowOut = 0;
    let tomorrowInf = 0;
    const dailyCFOut = new Map<string, number>(); // maturity date → outflow U-sum
    const dailyCFInf = new Map<string, number>(); // maturity date → inflow U-sum

    // Collect buyback-eligible items by maturity date for per-day buyback calc
    interface BuybackItem { matDate: string; rate: number; amount: number }
    const buybackItems: BuybackItem[] = [];

    for (const r of enriched) {
      if (r.inOut === 'HQLA') {
        hqlaTotal += r.q; // Keep using raw q for HQLA (100% eligible)
        continue;
      }
      const uVal = r.q * r.rRate; // Excel column U = Q × R
      if (r.s === 'Tomorrow') {
        if (r.inOut === 'Outflow') tomorrowOut += uVal;
        else if (r.inOut === 'Inflow') tomorrowInf += uVal;
      } else if (r.inOut === 'Outflow') {
        dailyCFOut.set(r.s, (dailyCFOut.get(r.s) ?? 0) + uVal);
      } else if (r.inOut === 'Inflow') {
        dailyCFInf.set(r.s, (dailyCFInf.get(r.s) ?? 0) + uVal);
      }
      // Buyback applies to outflow items whose maturity is beyond the 30-day window
      if (r.inOut === 'Outflow' && r.s !== 'Tomorrow') {
        const buybackRate = BUYBACK_RATES_LC[r.mid];
        if (buybackRate) {
          buybackItems.push({ matDate: r.s, rate: buybackRate, amount: Math.abs(r.q) });
        }
      }
    }

    // Sort CF maps into arrays for efficient rolling-window sums
    const outDates = Array.from(dailyCFOut.keys()).sort();
    const infDates = Array.from(dailyCFInf.keys()).sort();
    const buybackSorted = buybackItems.slice().sort((a, b) => a.matDate.localeCompare(b.matDate));

    // Helper: sum CFs for dates strictly after fromExcl up to and including toIncl
    function sumCFRange(
      sortedDates: string[],
      cfMap: Map<string, number>,
      fromExcl: string,
      toIncl: string,
    ): number {
      let sum = 0;
      for (const d of sortedDates) {
        if (d <= fromExcl) continue;
        if (d > toIncl) break;
        sum += cfMap.get(d) ?? 0;
      }
      return sum;
    }

    // Helper: total buyback for items maturing AFTER the 30-day window end
    function buybackForDay(day30End: string): number {
      let total = 0;
      for (const bi of buybackSorted) {
        if (bi.matDate > day30End) total += bi.amount * bi.rate;
      }
      return total;
    }

    // Step 2: Generate daily dates for 8 months
    // End date = same day of month, 8 months after reportDate
    function addMonthsLC(dateStr: string, months: number): string {
      const y = parseInt(dateStr.substring(0, 4));
      const m = parseInt(dateStr.substring(5, 7)) - 1;
      const day = parseInt(dateStr.substring(8, 10));
      const totalM = y * 12 + m + months;
      const ny = Math.floor(totalM / 12);
      const nm = totalM % 12;
      const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
      const nd = Math.min(day, lastDay);
      return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
    }

    const endDateStr = addMonthsLC(reportDate, 8);
    const dailyDates: string[] = [];
    let curDate = reportDate;
    while (curDate <= endDateStr) {
      dailyDates.push(curDate);
      curDate = addDaysLC(curDate, 1);
    }

    const hqla = Math.round(hqlaTotal);

    // Step 3: Compute daily forecast rows
    const forecast = dailyDates.map((dayDate) => {
      const day30End = addDaysLC(dayDate, 30);

      // Base outflow = Tomorrow items (always) + next 30 days of daily outflows
      const baseOutflow = tomorrowOut + sumCFRange(outDates, dailyCFOut, dayDate, day30End);
      // Base inflow  = Tomorrow items (always) + next 30 days of daily inflows
      const baseInflow  = tomorrowInf + sumCFRange(infDates, dailyCFInf, dayDate, day30End);

      const buybackOutflow = buybackForDay(day30End);
      const grossOutflow   = baseOutflow + buybackOutflow;
      const hoFacility     = grossOutflow * 0.20;
      const sumInflow      = baseInflow + hoFacility;
      const cappedInflow   = Math.min(sumInflow, grossOutflow * 0.75);
      const netCashOutflow = grossOutflow - cappedInflow;
      const lcr = netCashOutflow > 0 ? (hqla / netCashOutflow) * 100 : null;

      const d = new Date(dayDate + 'T12:00:00Z');
      const label = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) +
        ' ' + d.getUTCFullYear();

      return {
        date: dayDate,
        label,
        hqla,
        totalOutflow: Math.round(grossOutflow),
        totalInflow:  Math.round(sumInflow),
        netCashOutflow: Math.round(netCashOutflow),
        lcr,
      };
    });

    res.json({
      success: true,
      runId,
      reportDate,
      forecast,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// GET /api/verify/irrbb?runId=<id>
// Returns IRRBB data stored at upload time from the Summary_IRRBB sheet.
// ---------------------------------------------------------------------------

export function handleIrrbb(req: Request, res: Response): void {
  const { runId } = req.query as { runId?: string };
  if (!runId) {
    res.status(400).json({ success: false, error: 'Provide ?runId=<id>' });
    return;
  }
  if (!canAccessRun(runId, req)) {
    res.status(403).json({ success: false, error: 'Access denied.' });
    return;
  }
  try {
    const db = getDb();
    const row = db.prepare('SELECT irrbb_data FROM report_runs WHERE id = ?').get(runId) as
      { irrbb_data: string | null } | undefined;
    if (!row) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }
    const irrbb = row.irrbb_data ? JSON.parse(row.irrbb_data) : null;
    res.json({ success: true, runId, irrbb });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
}
