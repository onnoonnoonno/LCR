/**
 * Summary Aggregator – aligned to LCR_Backdata_Template.xlsx logic
 *
 * The Excel workbook produces LCR via the following chain:
 *
 *   Summary!B4
 *     → '30 days CF Table(ALL)'!D119  = D117 / D115
 *
 *   D117 = SUM(J83:J90) × 1,000,000
 *        = sum of HQLA weighted amounts (all HQLA rows, no maturity filter)
 *
 *   D115 = D103 − D112                      [Net Cash Outflows]
 *   D103 = D97 + D99 + D101                 [Gross Outflows]
 *     D97 = SUMIF(CF rows,"Outflow",K col)  [30-day weighted outflows]
 *   D112 = MIN(D110, D103×75%)              [Capped Inflows]
 *   D110 = D106 + D108                       [Total Inflows incl. HO facility]
 *     D106 = SUMIF(CF rows,"Inflow",K col)  [30-day weighted inflows]
 *     D108 = D103 × 20%                      [HO committed liquidity facility]
 *
 * Key workbook rules reproduced here:
 *   1. HQLA is a stock — all HQLA rows counted, no maturity filter.
 *   2. Cash flows: ONLY items whose LCR maturity falls within the 30-day stress
 *      window are counted. Demand / open-maturity items (no date) are treated as
 *      maturing "Tomorrow" and are always included.
 *   3. HO committed facility = grossOutflows × 20% (parent company liquidity line).
 *   4. No Level2A/2B HQLA caps — the workbook does not apply these.
 *      (eligibleTotal = adjustedTotal = simple sum of weighted HQLA amounts.)
 *
 * TODO Phase 3: add per-currency breakdown (ARF210 style).
 * TODO Phase 3: make the HO facility rate configurable (currently 20%).
 */

import { BS_RE33Row, LcrSummary, HqlaSummary, CashflowBucketSummary, LcrBuckets } from '../types/bs-re33';
import { addBuckets, emptyBuckets } from './buckets';

// ---------------------------------------------------------------------------
// 30-day maturity window filter
// ---------------------------------------------------------------------------

/**
 * Returns true if a row's maturity falls within the 30-day LCR stress window.
 *
 * Matches the Excel CF Table logic:
 *   - open_maturity (no date): treated as "Tomorrow" in the Excel → included
 *   - overdue (past maturity): treated as "Tomorrow" in the Excel → included
 *   - 1D, 2_7D, 8_30D: within 30 days → included
 *   - 31_90D, 91_180D, 181_365D, over365D: beyond 30 days → excluded
 *
 * HQLA rows are NOT filtered through this function (they are a stock, not a flow).
 */
const THIRTY_DAY_BUCKETS = new Set<string | null>([
  'overdue',
  '1D',
  '2_7D',
  '8_30D',
  'open_maturity',
]);

function is30DayWindow(row: BS_RE33Row): boolean {
  return THIRTY_DAY_BUCKETS.has(row.maturityBucket);
}

// ---------------------------------------------------------------------------
// HQLA aggregation (no Level2 caps — workbook does not apply them)
// ---------------------------------------------------------------------------

function aggregateHqla(rows: BS_RE33Row[]): HqlaSummary {
  let level1Raw = 0, level2aRaw = 0, level2bRaw = 0;
  let level1W   = 0, level2aW   = 0, level2bW   = 0;

  for (const row of rows) {
    if (!row.isHqla) continue;

    const raw      = row.adjustedBaseCcyAmt;
    const weighted = row.weightedAmount; // = adjustedBaseCcyAmt × assumptionRate (haircut already applied)

    switch (row.hqlaLevel) {
      case 'Level1':  level1Raw  += raw; level1W  += weighted; break;
      case 'Level2A': level2aRaw += raw; level2aW += weighted; break;
      case 'Level2B': level2bRaw += raw; level2bW += weighted; break;
    }
  }

  // Workbook: no Level2 cap logic — eligible total = simple sum of weighted amounts.
  const adjustedTotal = level1W + level2aW + level2bW;
  const eligibleTotal = adjustedTotal;

  return {
    level1Raw,
    level2aRaw,
    level2bRaw,
    level1Weighted:  level1W,
    level2aWeighted: level2aW,
    level2bWeighted: level2bW,
    adjustedTotal,
    eligibleTotal,
  };
}

// ---------------------------------------------------------------------------
// Cash flow aggregation (30-day window only)
// ---------------------------------------------------------------------------

function aggregateCashflow(rows: BS_RE33Row[], flag: 'outflow' | 'inflow'): CashflowBucketSummary {
  let buckets: LcrBuckets = emptyBuckets();
  // Accumulate signed weighted amounts to allow netting of contra positions.
  // The Excel CF Table SUMIFS sums raw balance amounts per (maturity, flow type,
  // P-key) group — a negative balance on a liability account (contra-liability)
  // offsets positive balances in the same group.  Math.abs() per row would
  // prevent this netting, so we sum with sign and negate at the end.
  //
  // Outflow accounts: signMultiplier = -1 → weightedAmount is negative for
  //   normal liability balances.  Summing these negatives and then negating
  //   gives the correct positive gross outflow.
  // Inflow accounts: signMultiplier = +1 → weightedAmount is positive.
  let signedTotal = 0;

  for (const row of rows) {
    const isTarget = flag === 'outflow' ? row.isCashOutflow : row.isCashInflow;
    if (!isTarget) continue;

    // -----------------------------------------------------------------------
    // 30-day maturity filter — mirrors the Excel CF Table column logic:
    // Only rows whose LCR maturity falls within the stress window (or whose
    // maturity is open/demand/overdue → treated as Tomorrow) are counted.
    // Items maturing beyond 30 days are excluded (they carry no stressed
    // cash-flow risk within the LCR horizon).
    // -----------------------------------------------------------------------
    if (!is30DayWindow(row)) continue;

    // Sum signed weighted amount (no per-row abs).
    signedTotal += row.weightedAmount;

    // Bucket display amounts: use signed bucket values so contra-positions
    // also offset within each bucket.
    buckets = addBuckets(buckets, {
      overdue:       row.buckets.overdue,
      b1D:           row.buckets.b1D,
      b2_7D:         row.buckets.b2_7D,
      b8_30D:        row.buckets.b8_30D,
      b31_90D:       row.buckets.b31_90D,
      b91_180D:      row.buckets.b91_180D,
      b181_365D:     row.buckets.b181_365D,
      bOver365D:     row.buckets.bOver365D,
      bOpenMaturity: row.buckets.bOpenMaturity,
    });
  }

  // For outflows: signedTotal is negative (liabilities) → negate for display.
  // For inflows:  signedTotal is positive (assets)    → use directly.
  // If the net position reverses sign (e.g., more contra-outflows than outflows),
  // clamp to 0 so the total never contributes negatively to the LCR formula.
  const total = flag === 'outflow'
    ? Math.max(0, -signedTotal)
    : Math.max(0,  signedTotal);

  // Normalise bucket display values to the same sign convention.
  const normalisedBuckets: LcrBuckets = {
    overdue:       flag === 'outflow' ? Math.max(0, -buckets.overdue)       : Math.max(0, buckets.overdue),
    b1D:           flag === 'outflow' ? Math.max(0, -buckets.b1D)           : Math.max(0, buckets.b1D),
    b2_7D:         flag === 'outflow' ? Math.max(0, -buckets.b2_7D)         : Math.max(0, buckets.b2_7D),
    b8_30D:        flag === 'outflow' ? Math.max(0, -buckets.b8_30D)        : Math.max(0, buckets.b8_30D),
    b31_90D:       flag === 'outflow' ? Math.max(0, -buckets.b31_90D)       : Math.max(0, buckets.b31_90D),
    b91_180D:      flag === 'outflow' ? Math.max(0, -buckets.b91_180D)      : Math.max(0, buckets.b91_180D),
    b181_365D:     flag === 'outflow' ? Math.max(0, -buckets.b181_365D)     : Math.max(0, buckets.b181_365D),
    bOver365D:     flag === 'outflow' ? Math.max(0, -buckets.bOver365D)     : Math.max(0, buckets.bOver365D),
    bOpenMaturity: flag === 'outflow' ? Math.max(0, -buckets.bOpenMaturity) : Math.max(0, buckets.bOpenMaturity),
  };

  return { total, byBucket: normalisedBuckets };
}

// ---------------------------------------------------------------------------
// Buyback stress outflow (CF Table D99)
// ---------------------------------------------------------------------------

/**
 * Stress rates for debt securities maturing beyond the 30-day window.
 * Mirrors Excel CF Table rows 65-67 (Buyback-Cash Outflows section).
 *
 * Short-term securities (NCDs / Certificates of Deposit) → 10%
 * Long-term securities (TCDs / Bond issued) → 5%
 */
const BUYBACK_RATES: Partial<Record<string, number>> = {
  'Deposit (Certificate of Deposit)':      0.10,  // Short Term Security (10%)
  'Deposit (Term Certificate of Deposit)': 0.05,  // Long Term Security (5%)
  'Bond issued':                           0.05,  // Long Term Security (5%)
};

const BEYOND_30D_BUCKETS = new Set<string>([
  '31_90D', '91_180D', '181_365D', 'over365D',
]);

/**
 * Compute the buyback stress outflow for debt securities maturing beyond 30 days.
 *
 * Formula (Summary & Working File F21):
 *   For each security with maturity > reportDate + 30:
 *     IF long-term (TCD/Bond) → 5% × balance
 *     IF short-term (NCD/CD)  → 10% × balance
 *
 * This is added to D97 (base BS_RE33 outflows) to get D103 (total gross outflows).
 */
function computeBuybackOutflow(rows: BS_RE33Row[]): number {
  let total = 0;
  for (const row of rows) {
    if (!row.isCashOutflow) continue;
    if (!row.maturityBucket || !BEYOND_30D_BUCKETS.has(row.maturityBucket)) continue;
    const rate = BUYBACK_RATES[row.middleCategory ?? ''];
    if (!rate) continue;
    // adjustedBaseCcyAmt is negative for liabilities; use abs() to get the notional
    total += Math.abs(row.adjustedBaseCcyAmt) * rate;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Liquidity Maturity Gap (LMG) aggregation
// ---------------------------------------------------------------------------

/**
 * Liquidity Maturity Gap (LMG) aggregation.
 *
 * Maturity used: column V in Excel = IFERROR(VLOOKUP(acCode, LMG-override-table), S)
 * In practice, column V = column S (LCR-adjusted maturity) for all rows unless
 * a specific LMG override exists. The existing maturityBucket (from LCR) is used.
 *
 * Open-maturity exception: rows where maturityDate is null receive S = "Tomorrow"
 * in the Excel via the fallback formula IF(empty < reportDate, "Tomorrow", empty).
 * This places them in the O/N bucket for LMG.
 *
 * Bucket mapping from LCR maturityBucket:
 *   overdue / 1D / open_maturity → O/N
 *   2_7D                         → 2-7D
 *   8_30D                        → 8D-1M
 *   31_90D                       → 1-3M
 *   91_180D and beyond           → beyond 3M (not used in headline ratios)
 *
 * Row filter: only CashInflow + HQLA asset rows and CashOutflow liability rows are
 * used — matching the Excel LMG sheet's row selection (NonCashFlow rows such as
 * Lease and Provision are excluded).
 *
 * Total assets (F24 denominator) uses only rows with adjustedBaseCcyAmt > 0,
 * consistent with how the Excel LMG sums the balance sheet asset side (contra-asset
 * accounts with credit balances appear in the bucket as negative and net out, but
 * the Excel denominator includes only the positive/gross amounts in practice).
 */

interface LmgBuckets {
  on:    number;  // O/N (overdue + 1D + open_maturity)
  b2_7D: number;
  b8_30D: number;
  b31_90D: number;
  beyond: number;
}

function emptyLmgBuckets(): LmgBuckets {
  return { on: 0, b2_7D: 0, b8_30D: 0, b31_90D: 0, beyond: 0 };
}

function addToLmgBucket(buckets: LmgBuckets, maturityBucket: string | null, amount: number): void {
  switch (maturityBucket) {
    case 'overdue':
    case '1D':
    case 'open_maturity': buckets.on      += amount; break;
    case '2_7D':          buckets.b2_7D   += amount; break;
    case '8_30D':         buckets.b8_30D  += amount; break;
    case '31_90D':        buckets.b31_90D += amount; break;
    default:              buckets.beyond  += amount; break;
  }
}

interface LmgResult {
  ratio7d:   number | null;
  ratio1m:   number | null;
  ratio3m:   number | null;
  ratio3mLr: number | null;
}

function aggregateLmg(rows: BS_RE33Row[], _reportDate: string): LmgResult {
  const assetBuckets = emptyLmgBuckets();
  const liabBuckets  = emptyLmgBuckets();
  let totalAssets    = 0;
  let offAcceptance  = 0;

  for (const row of rows) {
    // Off-balance-sheet rows: excluded from LMG totals, except OFF_Acceptance deduction.
    if (row.assetLiabilityType === 'off-balance-sheet') {
      if ((row.middleCategory ?? '').startsWith('OFF_Acceptance')) {
        offAcceptance += Math.abs(row.adjustedBaseCcyAmt);
      }
      continue;
    }

    if (row.assetLiabilityType === 'asset' && (row.category === 'CashInflow' || row.isHqla)) {
      // Only CashInflow + HQLA rows contribute to LMG — matches Excel LMG row filter.
      // Contra-asset accounts (credit-balance, adjustedBaseCcyAmt < 0) are excluded
      // from totalAssets but included in bucket cumulation (they net out within the bucket).
      if (row.adjustedBaseCcyAmt > 0) {
        totalAssets += row.adjustedBaseCcyAmt;
      }
      addToLmgBucket(assetBuckets, row.maturityBucket, row.adjustedBaseCcyAmt);
    } else if (row.assetLiabilityType === 'liability' && row.category === 'CashOutflow') {
      // Only CashOutflow liabilities contribute to LMG — excludes NonCashFlow rows
      // (Lease, Provision) which the Excel LMG sheet does not include.
      const rawAmt = Math.abs(row.adjustedBaseCcyAmt);
      addToLmgBucket(liabBuckets, row.maturityBucket, rawAmt);
    }
  }

  if (totalAssets === 0) {
    return { ratio7d: null, ratio1m: null, ratio3m: null, ratio3mLr: null };
  }

  const deduction = 0.20 * offAcceptance;

  // Cumulative totals at each horizon (assets with sign, liabs positive)
  const cumAsset7D = assetBuckets.on + assetBuckets.b2_7D;
  const cumLiab7D  = liabBuckets.on  + liabBuckets.b2_7D;
  const cumAsset1M = cumAsset7D + assetBuckets.b8_30D;
  const cumLiab1M  = cumLiab7D  + liabBuckets.b8_30D;
  const cumAsset3M = cumAsset1M + assetBuckets.b31_90D;
  const cumLiab3M  = cumLiab1M  + liabBuckets.b31_90D;

  const ratio7d   = ((cumAsset7D - cumLiab7D - deduction) / totalAssets) * 100;
  const ratio1m   = ((cumAsset1M - cumLiab1M - deduction) / totalAssets) * 100;
  const ratio3m   = ((cumAsset3M - cumLiab3M - deduction) / totalAssets) * 100;
  const ratio3mLr = cumLiab3M > 0 ? (cumAsset3M / cumLiab3M) * 100 : null;

  console.log(
    `[lmg] totalAssets=${totalAssets.toFixed(0)} ` +
    `cumAsset3M=${cumAsset3M.toFixed(0)} cumLiab3M=${cumLiab3M.toFixed(0)} ` +
    `7D=${ratio7d.toFixed(2)}% 1M=${ratio1m.toFixed(2)}% ` +
    `3M=${ratio3m.toFixed(2)}% 3M_LR=${ratio3mLr !== null ? ratio3mLr.toFixed(2) + '%' : 'N/A'}`
  );

  return {
    ratio7d:   Math.round(ratio7d   * 10000) / 10000,
    ratio1m:   Math.round(ratio1m   * 10000) / 10000,
    ratio3m:   Math.round(ratio3m   * 10000) / 10000,
    ratio3mLr: ratio3mLr !== null ? Math.round(ratio3mLr * 10000) / 10000 : null,
  };
}

// ---------------------------------------------------------------------------
// Main aggregation function
// ---------------------------------------------------------------------------

/** Rate of the HO committed liquidity facility as a fraction of gross outflows. */
const HO_FACILITY_RATE = 0.20;

/**
 * Aggregate all BS_RE33Row calculations into an LcrSummary.
 *
 * Reproduces the workbook formula chain:
 *   CF Table D119 = D117 / D115
 *   → Summary!B4
 *
 * @param rows        Calculated rows from the engine
 * @param reportDate  Report date (YYYY-MM-DD)
 */
export function aggregateSummary(rows: BS_RE33Row[], reportDate: string): LcrSummary {
  // Row statistics
  const rowCount         = rows.length;
  const mappedRows       = rows.filter((r) => r.category !== null).length;
  const unmappedRows     = rows.filter((r) => r.category === null).length;
  const rowsWithWarnings = rows.filter((r) => r.warnings.length > 0).length;

  // HQLA stock (no maturity filter — HQLA is a buffer, not a flow)
  const hqla = aggregateHqla(rows);

  // Gross 30-day cash flows
  const cashOutflows = aggregateCashflow(rows, 'outflow');
  const cashInflows  = aggregateCashflow(rows, 'inflow');

  // Buyback stress outflow for debt securities maturing beyond 30 days (CF Table D99)
  const buybackOutflow = computeBuybackOutflow(rows);

  // Total gross outflows = base outflows (D97) + buyback (D99) (CF Table D103)
  const grossOutflows = cashOutflows.total + buybackOutflow;

  // HO committed liquidity facility (workbook CF Table D108 = D103 × 20%)
  const hoFacilityInflow   = grossOutflows * HO_FACILITY_RATE;
  const totalInflowsInclHO = cashInflows.total + hoFacilityInflow;

  // Inflow cap: max 75% of gross outflows (workbook CF Table D112)
  const cappedInflowsTotal = Math.min(totalInflowsInclHO, grossOutflows * 0.75);

  // Net cash outflows (workbook CF Table D115 = D103 − D112)
  const netCashOutflows = Math.max(0, grossOutflows - cappedInflowsTotal);

  // LCR ratio (workbook CF Table D119 = D117 / D115)
  const lcrRatio = netCashOutflows > 0
    ? (hqla.eligibleTotal / netCashOutflows) * 100
    : null;

  const meetsMinimum = lcrRatio !== null ? lcrRatio >= 100 : null;

  // LMG metrics (Liquidity Maturity Gap)
  const lmg = aggregateLmg(rows, reportDate);

  // Per-type outflow breakdown for debugging
  const outflowByType: Record<string, number> = {};
  for (const row of rows) {
    if (!row.isCashOutflow || !is30DayWindow(row)) continue;
    const key = row.hqlaOrCashflowType ?? 'unmapped';
    outflowByType[key] = (outflowByType[key] ?? 0) + row.weightedAmount;
  }
  const outflowBreakdown = Object.entries(outflowByType)
    .sort((a, b) => a[1] - b[1])
    .map(([k, v]) => `${k}:${(-v).toFixed(0)}`)
    .join(', ');

  console.log(
    `[summaryAggregator] HQLA=${hqla.eligibleTotal.toFixed(0)} ` +
    `baseOut=${cashOutflows.total.toFixed(0)} ` +
    `buyback=${buybackOutflow.toFixed(0)} ` +
    `grossOut=${grossOutflows.toFixed(0)} ` +
    `grossIn=${cashInflows.total.toFixed(0)} ` +
    `hoFacility=${hoFacilityInflow.toFixed(0)} ` +
    `cappedIn=${cappedInflowsTotal.toFixed(0)} ` +
    `netOut=${netCashOutflows.toFixed(0)} ` +
    `LCR=${lcrRatio !== null ? lcrRatio.toFixed(2) + '%' : 'N/A'}`
  );
  console.log(`[summaryAggregator] OutflowBreakdown: ${outflowBreakdown}`);

  return {
    reportDate,
    hqla,
    cashOutflows,
    cashInflows,
    buybackOutflow,
    grossOutflows,
    hoFacilityInflow,
    totalInflowsInclHO,
    cappedInflowsTotal,
    netCashOutflows,
    lcrRatio: lcrRatio !== null ? Math.round(lcrRatio * 100) / 100 : null,
    meetsMinimum,
    lmgRatio7d:   lmg.ratio7d,
    lmgRatio1m:   lmg.ratio1m,
    lmgRatio3m:   lmg.ratio3m,
    lmgRatio3mLr: lmg.ratio3mLr,
    rowCount,
    mappedRows,
    unmappedRows,
    rowsWithWarnings,
  };
}
