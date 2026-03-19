/**
 * Pipeline Service
 *
 * Orchestrates the full processing pipeline for a given report run:
 *
 *   raw_rows (DB)
 *     → load reference data from DB
 *     → classify + enrich each row
 *     → calculate row-level derived fields
 *     → store processed_rows (DB)
 *     → aggregate summary
 *     → store report_summaries (DB)
 *     → update report_runs.status
 *
 * The actual calculation math is unchanged — it reuses rowCalculator.ts and
 * summaryAggregator.ts. This service wraps them with DB persistence.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/client';
import { LcrRawRow } from '../types/lcr';
import { BS_RE33Row } from '../types/bs-re33';
import { calculateRow, resetRowDebugLog } from '../services/rowCalculator';
import { aggregateSummary } from '../services/summaryAggregator';

// ---------------------------------------------------------------------------
// Reference data – load from DB into in-memory indexes (same pattern as before
// but sourced from SQLite instead of JSON files)
// ---------------------------------------------------------------------------

import { buildAccountMappingIndex }       from '../reference/accountMappingService';
import { buildCustomerTypeIndex }          from '../reference/customerTypeService';
import { buildAssumptionIndex }            from '../reference/assumptionService';
import { buildMaturityAdjustmentIndex }    from '../reference/maturityAdjustmentService';
import {
  AccountMapping,
  CustomerTypeEntry,
  AssumptionEntry,
  MaturityAdjustmentEntry,
} from '../types/bs-re33';

export function loadReferenceDataFromDb(): void {
  const db = getDb();

  // Account mappings
  const amRows = db.prepare('SELECT * FROM account_mappings').all() as Array<{
    ac_code: string; category: string | null; middle_category: string | null;
    hqla_or_cashflow_type: string | null; asset_liability_type: string | null;
    sign_multiplier: number; is_hqla: number; hqla_level: string | null;
    description: string | null;
  }>;
  const amEntries: AccountMapping[] = amRows.map((r) => ({
    acCode:               r.ac_code,
    category:             r.category ?? '',
    middleCategory:       r.middle_category ?? '',
    hqlaOrCashflowType:   r.hqla_or_cashflow_type ?? '',
    assetLiabilityType:   (r.asset_liability_type ?? 'Asset') as AccountMapping['assetLiabilityType'],
    signMultiplier:       (r.sign_multiplier as 1 | -1),
    isHqla:               r.is_hqla === 1,
    hqlaLevel:            (r.hqla_level as 'Level1' | 'Level2A' | 'Level2B' | null) ?? null,
  }));
  buildAccountMappingIndex(amEntries);

  // Customer types
  const ctRows = db.prepare('SELECT * FROM customer_types').all() as Array<{
    counterparty_no: string; customer_type: string;
  }>;
  const ctEntries: CustomerTypeEntry[] = ctRows.map((r) => ({
    counterpartyNo: r.counterparty_no,
    customerType:   r.customer_type as CustomerTypeEntry['customerType'],
  }));
  buildCustomerTypeIndex(ctEntries);

  // Assumption rules
  const arRows = db.prepare('SELECT * FROM assumption_rules').all() as Array<{
    p_key: string; assumption_rate: number; description: string | null;
  }>;
  const arEntries: AssumptionEntry[] = arRows.map((r) => ({
    pKey:           r.p_key,
    assumptionRate: r.assumption_rate,
    description:    r.description ?? '',
  }));
  buildAssumptionIndex(arEntries);

  // Maturity overrides
  const moRows = db.prepare('SELECT * FROM maturity_overrides').all() as Array<{
    ac_code: string | null; ref_no: string | null;
    formula_type: string; formula_params: string | null; reason: string | null;
  }>;
  const moEntries: MaturityAdjustmentEntry[] = moRows.map((r) => {
    const params = r.formula_params ? JSON.parse(r.formula_params) as Record<string, unknown> : undefined;
    return {
      acCode:      r.ac_code,
      refNo:       r.ref_no,
      formulaType: r.formula_type as MaturityAdjustmentEntry['formulaType'],
      formulaParams: params && 'days' in params
        ? { days: params.days as number }
        : params && 'date' in params
          ? undefined   // static entries use adjustedMaturityDate
          : undefined,
      adjustedMaturityDate: (r.formula_type === 'static' && params?.date)
        ? String(params.date)
        : undefined,
      reason: r.reason ?? '',
    };
  });
  buildMaturityAdjustmentIndex(moEntries);

  console.log(
    `[pipeline] Reference data loaded from DB: ` +
    `${amEntries.length} accounts, ${ctEntries.length} customer types, ` +
    `${arEntries.length} assumption rules, ${moEntries.length} maturity overrides`
  );
}

// ---------------------------------------------------------------------------
// Process a single report run end-to-end
// ---------------------------------------------------------------------------

export interface PipelineResult {
  runId: string;
  reportDate: string;
  summary: ReturnType<typeof aggregateSummary>;
}

export function processReportRun(runId: string): PipelineResult {
  const db = getDb();

  // Mark as processing
  db.prepare(`UPDATE report_runs SET status = 'processing' WHERE id = ?`).run(runId);

  try {
    // Fetch run metadata
    const run = db.prepare('SELECT * FROM report_runs WHERE id = ?').get(runId) as {
      id: string; report_date: string;
    };
    if (!run) throw new Error(`Report run ${runId} not found`);

    const reportDate = run.report_date;

    // Load reference data from DB into in-memory indexes
    loadReferenceDataFromDb();

    // Fetch raw rows from DB
    const rawDbRows = db.prepare(
      'SELECT * FROM raw_rows WHERE report_run_id = ? ORDER BY row_number'
    ).all(runId) as Array<{
      id: number; row_number: number; ac_code: string | null; ac_name: string | null;
      ref_no: string | null; counterparty_no: string | null; counterparty_name: string | null;
      ccy: string | null; balance_amt: number | null; base_ccy_amt: number | null;
      approval_contract_date: string | null; maturity_date: string | null;
      next_interest_reset_date: string | null;
    }>;

    // Map DB rows to LcrRawRow shape
    const rawRows: Array<LcrRawRow & { dbId: number }> = rawDbRows.map((r) => ({
      dbId:                    r.id,
      rowNumber:               r.row_number,
      acCode:                  r.ac_code,
      acName:                  r.ac_name,
      refNo:                   r.ref_no,
      counterpartyNo:          r.counterparty_no,
      counterpartyName:        r.counterparty_name,
      ccy:                     r.ccy,
      balanceAmt:              r.balance_amt,
      baseCcyAmt:              r.base_ccy_amt,
      approvalContractDate:    r.approval_contract_date,
      maturityDate:            r.maturity_date,
      nextInterestResetDate:   r.next_interest_reset_date,
    }));

    // Run row calculator (unchanged logic)
    resetRowDebugLog();
    const calculatedRows: BS_RE33Row[] = [];
    for (const raw of rawRows) {
      calculatedRows.push(calculateRow(raw, reportDate));
    }

    // Determine 30-day window set (same buckets as summaryAggregator)
    const THIRTY_DAY_BUCKETS = new Set(['overdue', '1D', '2_7D', '8_30D', 'open_maturity']);

    // Persist processed rows to DB
    const insertProcessed = db.prepare(`
      INSERT INTO processed_rows (
        report_run_id, raw_row_id,
        category, middle_category, hqla_or_cashflow_type, asset_liability_type,
        customer_type, p_key, assumption_rate,
        sign_multiplier, adjusted_amount, weighted_amount,
        is_hqla, hqla_level,
        effective_maturity, days_to_maturity, maturity_bucket, maturity_source,
        in_30d_window, is_cash_inflow, is_cash_outflow,
        warning_flag, warning_reason, detail_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const persistAll = db.transaction(() => {
      // Delete any previous processed rows for this run (idempotent re-run)
      db.prepare('DELETE FROM processed_rows WHERE report_run_id = ?').run(runId);

      for (let i = 0; i < calculatedRows.length; i++) {
        const row     = calculatedRows[i];
        const rawDbId = rawRows[i].dbId;

        const inWindow = THIRTY_DAY_BUCKETS.has(row.maturityBucket ?? '');
        const hasWarning = row.warnings.length > 0;

        insertProcessed.run(
          runId,
          rawDbId,
          row.category,
          row.middleCategory,
          row.hqlaOrCashflowType,
          row.assetLiabilityType,
          row.customerType,
          // Reconstruct pKey from the row for storage
          `${row.middleCategory ?? ''}_${row.customerType ?? ''}`,
          row.assumptionRate,
          row.signMultiplier,
          row.adjustedBaseCcyAmt,
          row.weightedAmount,
          row.isHqla ? 1 : 0,
          row.hqlaLevel,
          row.lcrMaturityDate,
          row.daysToMaturity,
          row.maturityBucket,
          row.maturitySource,
          inWindow ? 1 : 0,
          row.isCashInflow ? 1 : 0,
          row.isCashOutflow ? 1 : 0,
          hasWarning ? 1 : 0,
          hasWarning ? row.warnings.join('; ') : null,
          JSON.stringify({ notes: row.notes, warnings: row.warnings }),
        );
      }
    });
    persistAll();

    // Run aggregation (unchanged logic)
    const summary = aggregateSummary(calculatedRows, reportDate);

    // Persist summary to DB
    const summaryId = uuidv4();
    const createdAt = new Date().toISOString();

    db.prepare('DELETE FROM report_summaries WHERE report_run_id = ?').run(runId);
    db.prepare(`
      INSERT INTO report_summaries (
        id, report_run_id, report_date,
        eligible_hqla, gross_outflows, gross_inflows,
        capped_inflows, net_cash_outflows, lcr_ratio,
        ratio_7d, ratio_1m, ratio_3m, ratio_3m_lr, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      summaryId, runId, reportDate,
      summary.hqla.eligibleTotal,
      summary.grossOutflows,
      summary.cashInflows.total,
      summary.cappedInflowsTotal,
      summary.netCashOutflows,
      summary.lcrRatio,
      summary.lmgRatio7d,
      summary.lmgRatio1m,
      summary.lmgRatio3m,
      summary.lmgRatio3mLr,
      createdAt,
    );

    // Mark run complete
    db.prepare(`UPDATE report_runs SET status = 'complete' WHERE id = ?`).run(runId);

    console.log(
      `[pipeline] runId=${runId} complete — ` +
      `HQLA=${summary.hqla.eligibleTotal.toFixed(0)} ` +
      `grossOut=${summary.grossOutflows.toFixed(0)} ` +
      `LCR=${summary.lcrRatio?.toFixed(2) ?? 'N/A'}%`
    );

    return { runId, reportDate, summary };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(`UPDATE report_runs SET status = 'error', error_message = ? WHERE id = ?`).run(msg, runId);
    throw err;
  }
}
