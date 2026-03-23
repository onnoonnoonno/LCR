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
 */

import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../db/client';
import { LcrRawRow } from '../types/lcr';
import { BS_RE33Row } from '../types/bs-re33';
import { calculateRow, resetRowDebugLog } from '../services/rowCalculator';
import { aggregateSummary } from '../services/summaryAggregator';

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

// ---------------------------------------------------------------------------
// Reference data – load from DB into in-memory indexes
// ---------------------------------------------------------------------------

export async function loadReferenceDataFromDb(): Promise<void> {
  const pool = getPool();

  // Account mappings
  const { rows: amRows } = await pool.query('SELECT * FROM account_mappings');
  const amEntries: AccountMapping[] = (amRows as Array<{
    ac_code: string; category: string | null; middle_category: string | null;
    hqla_or_cashflow_type: string | null; asset_liability_type: string | null;
    sign_multiplier: number; is_hqla: number; hqla_level: string | null;
    description: string | null;
  }>).map((r) => ({
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
  const { rows: ctRows } = await pool.query('SELECT * FROM customer_types');
  const ctEntries: CustomerTypeEntry[] = (ctRows as Array<{
    counterparty_no: string; customer_type: string;
  }>).map((r) => ({
    counterpartyNo: r.counterparty_no,
    customerType:   r.customer_type as CustomerTypeEntry['customerType'],
  }));
  buildCustomerTypeIndex(ctEntries);

  // Assumption rules
  const { rows: arRows } = await pool.query('SELECT * FROM assumption_rules');
  const arEntries: AssumptionEntry[] = (arRows as Array<{
    p_key: string; assumption_rate: number; description: string | null;
  }>).map((r) => ({
    pKey:           r.p_key,
    assumptionRate: r.assumption_rate,
    description:    r.description ?? '',
  }));
  buildAssumptionIndex(arEntries);

  // Maturity overrides
  const { rows: moRows } = await pool.query('SELECT * FROM maturity_overrides');
  const moEntries: MaturityAdjustmentEntry[] = (moRows as Array<{
    ac_code: string | null; ref_no: string | null;
    formula_type: string; formula_params: string | null; reason: string | null;
  }>).map((r) => {
    const params = r.formula_params ? JSON.parse(r.formula_params) as Record<string, unknown> : undefined;
    return {
      acCode:      r.ac_code,
      refNo:       r.ref_no,
      formulaType: r.formula_type as MaturityAdjustmentEntry['formulaType'],
      formulaParams: params && 'days' in params
        ? { days: params.days as number }
        : params && 'date' in params
          ? undefined
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

export async function processReportRun(runId: string): Promise<PipelineResult> {
  const pool = getPool();

  // Mark as processing
  await pool.query("UPDATE report_runs SET status = 'processing' WHERE id = $1", [runId]);

  try {
    // Fetch run metadata
    const { rows: runRows } = await pool.query(
      'SELECT id, report_date FROM report_runs WHERE id = $1',
      [runId]
    );
    const run = runRows[0] as { id: string; report_date: string } | undefined;
    if (!run) throw new Error(`Report run ${runId} not found`);

    const reportDate = run.report_date;

    // Load reference data from DB into in-memory indexes
    await loadReferenceDataFromDb();

    // Fetch raw rows from DB
    const { rows: rawDbRows } = await pool.query(
      'SELECT * FROM raw_rows WHERE report_run_id = $1 ORDER BY row_number',
      [runId]
    );

    // Map DB rows to LcrRawRow shape
    const rawRows: Array<LcrRawRow & { dbId: number }> = (rawDbRows as Array<{
      id: number; row_number: number; ac_code: string | null; ac_name: string | null;
      ref_no: string | null; counterparty_no: string | null; counterparty_name: string | null;
      ccy: string | null; balance_amt: number | null; base_ccy_amt: number | null;
      approval_contract_date: string | null; maturity_date: string | null;
      next_interest_reset_date: string | null;
    }>).map((r) => ({
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

    const THIRTY_DAY_BUCKETS = new Set(['overdue', '1D', '2_7D', '8_30D', 'open_maturity']);

    // Persist processed rows in a transaction (delete old + insert new)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM processed_rows WHERE report_run_id = $1', [runId]);

      for (let i = 0; i < calculatedRows.length; i++) {
        const row     = calculatedRows[i];
        const rawDbId = rawRows[i].dbId;

        const inWindow   = THIRTY_DAY_BUCKETS.has(row.maturityBucket ?? '');
        const hasWarning = row.warnings.length > 0;

        await client.query(
          `INSERT INTO processed_rows (
             report_run_id, raw_row_id,
             category, middle_category, hqla_or_cashflow_type, asset_liability_type,
             customer_type, p_key, assumption_rate,
             sign_multiplier, adjusted_amount, weighted_amount,
             is_hqla, hqla_level,
             effective_maturity, days_to_maturity, maturity_bucket, maturity_source,
             in_30d_window, is_cash_inflow, is_cash_outflow,
             warning_flag, warning_reason, detail_json
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
           )`,
          [
            runId,
            rawDbId,
            row.category,
            row.middleCategory,
            row.hqlaOrCashflowType,
            row.assetLiabilityType,
            row.customerType,
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

    // Run aggregation (unchanged logic)
    const summary = aggregateSummary(calculatedRows, reportDate);

    // Persist summary to DB
    const summaryId = uuidv4();
    const createdAt = new Date().toISOString();

    await pool.query('DELETE FROM report_summaries WHERE report_run_id = $1', [runId]);
    await pool.query(
      `INSERT INTO report_summaries (
         id, report_run_id, report_date,
         eligible_hqla, gross_outflows, gross_inflows,
         capped_inflows, net_cash_outflows, lcr_ratio,
         ratio_7d, ratio_1m, ratio_3m, ratio_3m_lr, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
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
      ]
    );

    // Mark run complete
    await pool.query("UPDATE report_runs SET status = 'complete' WHERE id = $1", [runId]);

    console.log(
      `[pipeline] runId=${runId} complete — ` +
      `HQLA=${summary.hqla.eligibleTotal.toFixed(0)} ` +
      `grossOut=${summary.grossOutflows.toFixed(0)} ` +
      `LCR=${summary.lcrRatio?.toFixed(2) ?? 'N/A'}%`
    );

    return { runId, reportDate, summary };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      "UPDATE report_runs SET status = 'error', error_message = $1 WHERE id = $2",
      [msg, runId]
    );
    throw err;
  }
}
