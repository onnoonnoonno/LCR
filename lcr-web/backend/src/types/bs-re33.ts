/**
 * Phase 2 – BS_RE33 Calculation Engine Types
 *
 * All types introduced in Phase 2 live here to keep a clear phase boundary.
 * lcr.ts retains the raw-row and upload-API types from Phase 1.
 */

import { LcrRawRow } from './lcr';

// ============================================================
// REFERENCE DATA TYPES
// ============================================================

export type AssetLiabilityType = 'asset' | 'liability' | 'off-balance-sheet'
  | 'Asset' | 'Liability' | 'Equity' | 'OFF Bal.';

/**
 * Maps an account code (acCode) to its LCR classification.
 * Loaded from reference/data/accountMapping.json.
 */
export interface AccountMapping {
  acCode: string;

  /** Human-readable account name from the chart of accounts (optional). */
  acName?: string;

  /**
   * Top-level LCR category.
   * Expected values: "HQLA" | "CashOutflow" | "CashInflow" | "NonCashFlow"
   */
  category: string;

  /** Sub-category label for reporting (e.g. "RetailDeposit", "TermLoan") */
  middleCategory: string;

  /**
   * Fine-grained type key used to look up the assumption rate.
   * Should match AssumptionEntry.hqlaOrCashflowType.
   */
  hqlaOrCashflowType: string;

  assetLiabilityType: AssetLiabilityType;

  /**
   * Multiplier applied to baseCcyAmt to produce adjustedBaseCcyAmt.
   *  +1 → asset (balance is already positive)
   *  -1 → liability (positive balance represents an outflow; negate for convention)
   */
  signMultiplier: 1 | -1;

  /** Is this account eligible for the HQLA stock? */
  isHqla: boolean;

  /** HQLA classification level. Null if not HQLA. */
  hqlaLevel: 'Level1' | 'Level2A' | 'Level2B' | null;
}

/** Standardised customer-type codes (based on Basel III counterparty classification) */
export type CustomerType =
  | 'Retail'
  | 'SME'
  | 'NonFinancialCorporate'
  | 'FinancialInstitution'
  | 'CentralBank'
  | 'Sovereign'
  | 'PublicSectorEntity'
  | 'Interbank'
  | 'Unknown';

/**
 * Maps a counterparty identifier to a customer type.
 * Loaded from reference/data/customerTypes.json.
 */
export interface CustomerTypeEntry {
  counterpartyNo: string;
  customerType: CustomerType;
}

/**
 * Defines the assumption rate (run-off, inflow, or haircut) for a given P-key.
 *
 * Loaded from reference/data/assumptions.json.
 *
 * P-key format (mirrors Excel BS_RE33!P column):
 *   pKey = middleCategory + "_" + customerType
 * For accounts where customer type is not applicable, customerType = "" (blank),
 * so pKey ends with a trailing underscore: "Deposit_Asset(Our)_".
 */
export interface AssumptionEntry {
  /**
   * P-key = middleCategory + "_" + customerType.
   * Matches the key used in the Excel Assumptions sheet column C.
   */
  pKey: string;

  /**
   * Rate in [0, 1].
   * - HQLA haircut factor:  eligible amount = adjustedBaseCcyAmt × assumptionRate
   * - Outflow run-off rate: weightedOutflow = adjustedBaseCcyAmt × assumptionRate
   * - Inflow rate:          weightedInflow  = adjustedBaseCcyAmt × assumptionRate
   */
  assumptionRate: number;

  description: string;
}

/**
 * Overrides the maturity date used for bucket allocation.
 * Applied before falling back to the raw maturityDate column.
 *
 * Loaded from reference/data/maturityAdjustments.json.
 *
 * Supports two modes:
 *   1. Static: adjustedMaturityDate is a literal YYYY-MM-DD date.
 *   2. Formula: formulaType is set; date is computed from reportDate at lookup time.
 *      formulaType values (matching Excel Maturity Adjustment sheet formulas):
 *        "tomorrow"          → reportDate + 1 day
 *        "far_future"        → "2999-12-31" (non-maturing / excluded)
 *        "year_end"          → DATE(YEAR(N4),12,31) = Dec 31 of report year
 *        "eomonth_plus_N"    → EOMONTH(N4,0) + days  (formulaParams.days required)
 *        "edate_year_end_60M"→ DATE(YEAR(EDATE(N4,60)),12,31) = Dec 31 of (reportYear+5)
 */
export interface MaturityAdjustmentEntry {
  /**
   * Match key. Behaviour:
   *   acCode only (refNo = null) → applies to all contracts under that account
   *   both acCode + refNo → exact contract override
   */
  acCode: string | null;
  refNo: string | null;

  /**
   * Static YYYY-MM-DD date (used when formulaType is absent or "static").
   * Optional when formulaType is set.
   */
  adjustedMaturityDate?: string;

  /**
   * Formula type for runtime date computation from reportDate.
   * When set, takes precedence over adjustedMaturityDate.
   */
  formulaType?: 'tomorrow' | 'far_future' | 'year_end' | 'eomonth_plus_N' | 'edate_year_end_60M';

  /** Parameters for formulaType (e.g. days for eomonth_plus_N) */
  formulaParams?: { days?: number };

  /** Explains why the override exists (audit trail) */
  reason: string;
}

/** All four reference tables bundled as one record for easy passing */
export interface ReferenceData {
  accountMappings: AccountMapping[];
  customerTypes: CustomerTypeEntry[];
  assumptions: AssumptionEntry[];
  maturityAdjustments: MaturityAdjustmentEntry[];
}

// ============================================================
// MATURITY BUCKETS
// ============================================================

/**
 * Standard Basel III / internal LCR maturity buckets.
 * Each bucket represents a calendar-day range from the reportDate.
 */
export type MaturityBucket =
  | 'overdue'        // maturity date < reportDate (already past due – treated as overnight for LCR)
  | '1D'             // 0–1 calendar days (overnight)
  | '2_7D'           // 2–7 calendar days
  | '8_30D'          // 8–30 calendar days (the 30-day LCR stress window)
  | '31_90D'         // 31–90 calendar days
  | '91_180D'        // 91–180 calendar days
  | '181_365D'       // 181–365 calendar days
  | 'over365D'       // > 365 calendar days
  | 'open_maturity'; // no maturity date (demand / current / revolving)

/** Weighted amounts allocated per maturity bucket */
export interface LcrBuckets {
  overdue: number;
  b1D: number;
  b2_7D: number;
  b8_30D: number;
  b31_90D: number;
  b91_180D: number;
  b181_365D: number;
  bOver365D: number;
  bOpenMaturity: number;
}

// ============================================================
// CALCULATED BS_RE33 ROW
// ============================================================

export type MaturitySource =
  | 'maturityAdjustment'   // overridden by MaturityAdjustmentEntry
  | 'maturityDate'         // column J used as-is
  | 'nextInterestResetDate' // column K used as fallback (floating rate)
  | 'none';                // no date; → open_maturity bucket

/**
 * A fully calculated BS_RE33 row.
 * Produced by rowCalculator.calculateRow() for each valid raw row.
 */
export interface BS_RE33Row {
  // ---- Source tracking ------------------------------------------------
  rowNumber: number;

  // ---- Raw input (echoed for traceability) ----------------------------
  acCode: string | null;
  acName: string | null;
  refNo: string | null;
  counterpartyNo: string | null;
  counterpartyName: string | null;
  ccy: string | null;
  balanceAmt: number | null;
  baseCcyAmt: number | null;
  approvalContractDate: string | null;
  maturityDate: string | null;
  nextInterestResetDate: string | null;

  // ---- Account mapping resolution -------------------------------------
  category: string | null;
  middleCategory: string | null;
  hqlaOrCashflowType: string | null;
  assetLiabilityType: AssetLiabilityType | null;
  signMultiplier: number;
  isHqla: boolean;
  hqlaLevel: string | null;

  // ---- Counterparty classification ------------------------------------
  customerType: CustomerType | null;

  // ---- Core calculations ----------------------------------------------
  /** baseCcyAmt × signMultiplier  (or 0 when baseCcyAmt is null) */
  adjustedBaseCcyAmt: number;

  /** Rate from assumptions table (run-off / inflow / haircut) */
  assumptionRate: number;

  /** adjustedBaseCcyAmt × assumptionRate */
  weightedAmount: number;

  // ---- Maturity resolution --------------------------------------------
  lcrMaturityDate: string | null;
  maturitySource: MaturitySource;
  daysToMaturity: number | null;
  maturityBucket: MaturityBucket | null;

  // ---- Bucket allocation (weightedAmount split into the bucket) -------
  buckets: LcrBuckets;

  // ---- LCR flags -------------------------------------------------------
  isCashInflow: boolean;
  isCashOutflow: boolean;

  // ---- Audit trail -----------------------------------------------------
  /** Key decisions made during calculation (for debugging / compliance) */
  notes: string[];
  /** Non-fatal issues (unmapped account, missing assumption, etc.) */
  warnings: string[];
}

// ============================================================
// SUMMARY / AGGREGATION
// ============================================================

export interface HqlaSummary {
  level1Raw: number;         // sum of adjustedBaseCcyAmt for Level1 HQLA
  level2aRaw: number;
  level2bRaw: number;
  level1Weighted: number;    // level1Raw × haircut factor
  level2aWeighted: number;   // level2aRaw × haircut factor
  level2bWeighted: number;   // level2bRaw × haircut factor
  adjustedTotal: number;     // sum of weighted amounts before Level2 cap
  /** After 40% Level2 cap: max(Level2, 2/3 × Level1) */
  eligibleTotal: number;
}

export interface CashflowBucketSummary {
  total: number;
  byBucket: LcrBuckets;
}

export interface LcrSummary {
  reportDate: string;
  hqla: HqlaSummary;

  /** Gross weighted outflows: items maturing within 30 days (or demand/open) only */
  cashOutflows: CashflowBucketSummary;
  /** Gross weighted inflows: items maturing within 30 days (or demand/open) only */
  cashInflows: CashflowBucketSummary;

  /**
   * Buyback stress outflow for debt securities maturing beyond 30 days.
   * Workbook: CF Table D99 (from Summary & Working File F21).
   *   - Deposit (Term Certificate of Deposit) beyond 30 days → 5% of balance
   *   - Deposit (Certificate of Deposit) beyond 30 days → 10% of balance
   *   - Bond issued beyond 30 days → 5% of balance
   * Represents market buyback risk under stress (investors redeeming before maturity).
   */
  buybackOutflow: number;

  /**
   * Total gross outflows = cashOutflows.total + buybackOutflow.
   * Workbook: CF Table D103 = D97 + D99 + D101.
   */
  grossOutflows: number;

  /**
   * HO committed liquidity facility = grossOutflows × 20%.
   * Represents the parent company's committed funding line (workbook: CF Table D108).
   */
  hoFacilityInflow: number;

  /** Total inflows including HO facility = cashInflows.total + hoFacilityInflow */
  totalInflowsInclHO: number;

  /**
   * Capped inflows: min(totalInflowsInclHO, grossOutflows × 75%).
   * Workbook: CF Table D112.
   */
  cappedInflowsTotal: number;

  /** Net cash outflows = grossOutflows − cappedInflows. Workbook: CF Table D115. */
  netCashOutflows: number;

  /**
   * LCR ratio = eligibleHQLA / netCashOutflows × 100 (%).
   * Workbook: CF Table D119 = D117 / D115.
   * Null when netCashOutflows = 0.
   */
  lcrRatio: number | null;

  /** True when lcrRatio ≥ 100%, null when ratio cannot be calculated. */
  meetsMinimum: boolean | null;

  // ---------------------------------------------------------------------------
  // Liquidity Maturity Gap (LMG) metrics — Workbook: Liquidity Maturity Gap sheet
  // ---------------------------------------------------------------------------

  /**
   * 7-Day Gap Ratio (%).
   * = (cumAssets_7D - cumLiab_7D - 20%×offAcceptance) / totalAssets × 100
   * Workbook: 'Liquidity Maturity Gap'!J73
   */
  lmgRatio7d: number | null;

  /**
   * 1-Month Gap Ratio (%).
   * = (cumAssets_1M - cumLiab_1M - 20%×offAcceptance) / totalAssets × 100
   * Workbook: 'Liquidity Maturity Gap'!J74
   */
  lmgRatio1m: number | null;

  /**
   * 3-Month Gap Ratio (%).
   * = (cumAssets_3M - cumLiab_3M - 20%×offAcceptance) / totalAssets × 100
   * Workbook: 'Liquidity Maturity Gap'!J75
   */
  lmgRatio3m: number | null;

  /**
   * 3-Month Liquidity Ratio (%).
   * = SUM(assets O/N to 1-3M) / SUM(liabilities O/N to 1-3M) × 100
   * Workbook: 'Liquidity Maturity Gap'!Q73 → Summary!C4
   */
  lmgRatio3mLr: number | null;

  // Row statistics
  rowCount: number;
  mappedRows: number;
  unmappedRows: number;
  rowsWithWarnings: number;
}

// ============================================================
// ENGINE INPUT / OUTPUT
// ============================================================

export interface BS_RE33Input {
  reportDate: string;
  rows: LcrRawRow[];
}

export interface CalculationError {
  rowNumber: number;
  error: string;
}

export interface BS_RE33Output {
  calculationId: string;
  reportDate: string;
  calculatedAt: string;
  rowCount: number;
  rows: BS_RE33Row[];
  summary: LcrSummary;
  calculationErrors: CalculationError[];
}

// ============================================================
// API RESPONSE TYPES
// ============================================================

export interface CalculateSuccessResponse {
  success: true;
  calculationId: string;
  reportDate: string;
  rowCount: number;
  calculatedRows: number;
  summary: LcrSummary;
  warnings: number;
  errors: number;
}

export interface CalculateErrorResponse {
  success: false;
  error: string;
}

export type CalculateResponse = CalculateSuccessResponse | CalculateErrorResponse;

export interface BS_RE33PageResponse {
  calculationId: string;
  reportDate: string;
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  rows: BS_RE33Row[];
}

export interface SummaryResponse {
  calculationId: string;
  summary: LcrSummary;
}
