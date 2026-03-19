/**
 * Row Calculator – Pure BS_RE33 Row Calculation Pipeline
 *
 * Takes one raw LcrRawRow + reportDate + pre-built service indexes
 * and produces one fully-populated BS_RE33Row.
 *
 * This module is intentionally pure (no I/O, no global state mutated).
 * It can be unit-tested by passing mock service responses.
 *
 * Pipeline steps:
 *   1.  Account mapping lookup (category, middleCategory, flowType, sign, HQLA level)
 *   2.  Customer type lookup
 *   3.  adjustedBaseCcyAmt  = baseCcyAmt × signMultiplier
 *   4.  Assumption lookup   → assumptionRate
 *   5.  weightedAmount      = adjustedBaseCcyAmt × assumptionRate
 *   6.  Maturity resolution (adjustment override → maturityDate → nextInterestResetDate)
 *   7.  daysToMaturity calculation
 *   8.  Bucket classification
 *   9.  Bucket allocation
 *  10.  Flag computation (isCashInflow, isCashOutflow, isHqla)
 *  11.  Build notes + warnings (audit trail)
 */

import { LcrRawRow } from '../types/lcr';
import { BS_RE33Row, CustomerType, MaturitySource } from '../types/bs-re33';
import { lookupAccountMapping } from '../reference/accountMappingService';
import { lookupCustomerType } from '../reference/customerTypeService';
import { lookupAssumptionByPKey } from '../reference/assumptionService';
import { lookupMaturityAdjustment } from '../reference/maturityAdjustmentService';
import {
  calcDaysToMaturity,
  classifyBucket,
  allocateToBucket,
  emptyBuckets,
} from './buckets';

// ---------------------------------------------------------------------------
// P-key helpers (mirrors Excel BS_RE33!P = M&"_"&O)
// ---------------------------------------------------------------------------

/**
 * Middle-categories where the Assumptions sheet has customer-type-specific rates.
 * Excel: O column is populated only when L (category) ∈ {Loan, Deposit_Liability,
 *   OFF_Unused Loan Commitment, HQLA}. We identify these by middleCategory.
 *
 * HQLA is intentionally EXCLUDED here: all HQLA entries in the Assumptions sheet
 * have rate=1.0 regardless of customer type, so we use the generic "HQLA_" P-key
 * (blank CT suffix) which always resolves to rate=1.0. This avoids failures when
 * the HQLA counterparty is not in the Customer Type table (would → rate=0).
 */
const CT_SENSITIVE_MIDDLE_CATEGORIES = new Set([
  'Loan',
  'On-demand Deposit',
  'Other deposit (Time deposit)',
  'OFF_Unused Loan Commitment',
]);

/**
 * Maps our internal CustomerType enum to the exact customer-type strings used
 * as the second part of the P-key in the Excel Assumptions sheet column C.
 *
 * Excel CT table values: "Household", "SME", "Non-financialcorporations",
 *   "Financialinstitutions", "Other Institution", "EUBB", etc.
 */
function customerTypeToPKeyString(ct: string): string {
  switch (ct) {
    case 'Retail':               return 'Household';
    case 'SME':                  return 'SME';
    case 'NonFinancialCorporate': return 'Non-financialcorporations';
    case 'FinancialInstitution': return 'Financialinstitutions';
    case 'Interbank':            return 'Financialinstitutions';
    case 'CentralBank':          return 'Financialinstitutions';
    case 'Sovereign':            return 'Other Institution';
    case 'PublicSectorEntity':   return 'Other Institution';
    case 'Unknown':              return 'Unknown'; // no match in Assumptions → rate=0
    default:                     return ct;         // pass through for future CT values
  }
}

// ---------------------------------------------------------------------------
// Row-level debug throttle
// ---------------------------------------------------------------------------

const ROW_DEBUG_LIMIT = 20;
let _rowDebugCount = 0;

/** Reset per-run row debug counter. Called by calculationEngine at the start of each run. */
export function resetRowDebugLog(): void {
  _rowDebugCount = 0;
}

// ---------------------------------------------------------------------------
// Main calculation function
// ---------------------------------------------------------------------------

/**
 * Calculate a single BS_RE33 row from a raw input row.
 *
 * All service lookups are called inline; the indexes are assumed to be
 * pre-populated (call buildXxxIndex() before invoking this function).
 *
 * @param raw         Parsed raw row from the Excel upload
 * @param reportDate  YYYY-MM-DD report date (= BS_RE33!N4 conceptually)
 * @returns           Fully calculated BS_RE33Row
 */
export function calculateRow(raw: LcrRawRow, reportDate: string): BS_RE33Row {
  const notes: string[] = [];
  const warnings: string[] = [];

  // -----------------------------------------------------------------------
  // Step 1: Account mapping
  // -----------------------------------------------------------------------
  const mapping = lookupAccountMapping(raw.acCode);

  const category            = mapping?.category            ?? null;
  const middleCategory      = mapping?.middleCategory      ?? null;
  const hqlaOrCashflowType  = mapping?.hqlaOrCashflowType  ?? null;
  const assetLiabilityType  = mapping?.assetLiabilityType  ?? null;
  const signMultiplier      = mapping?.signMultiplier       ?? 1;
  const isHqla              = mapping?.isHqla               ?? false;
  const hqlaLevel           = mapping?.hqlaLevel            ?? null;

  if (!mapping) {
    warnings.push(`Account code "${raw.acCode}" not found in account mapping table. Row excluded from LCR aggregation.`);
    notes.push('Account mapping: NOT FOUND → category set to null, weighted amount = 0');
  } else {
    notes.push(
      `Account mapping: acCode=${raw.acCode} → category=${category}, ` +
      `type=${hqlaOrCashflowType}, sign=${signMultiplier > 0 ? '+1' : '-1'}`
    );
  }

  // -----------------------------------------------------------------------
  // Step 1b: RefNo override — Excel BS_RE33!N column formula
  //   IF(refNo ∈ {RCH3001AUD, RCH3002AUD, RCH4001USD}, "Non Cash Flow", ...)
  //   These specific reference numbers represent non-cash-flow items
  //   regardless of their account code mapping.
  // -----------------------------------------------------------------------
  const NON_CASHFLOW_REFNOS = new Set(['RCH3001AUD', 'RCH3002AUD', 'RCH4001USD']);
  let effectiveCategory = category;
  let effectiveHqlaOrCashflowType = hqlaOrCashflowType;
  if (raw.refNo && NON_CASHFLOW_REFNOS.has(raw.refNo.trim())) {
    effectiveCategory = 'NonCashFlow';
    effectiveHqlaOrCashflowType = 'NonCashFlow';
    notes.push(`RefNo override: refNo=${raw.refNo} → category forced to "NonCashFlow" (Excel BS_RE33!N override)`);
  }

  // -----------------------------------------------------------------------
  // Step 2: Customer type
  //
  // Excel BS_RE33!O column formula:
  //   =IF(OR(L="Loan", L="Deposit_Liability", L="OFF_Unused Loan Commitment", L="HQLA"),
  //        IFERROR(VLOOKUP(counterpartyNo, CT!$A:$C, 3, 0), "Unknown"), "")
  //
  // Customer type is only relevant (O ≠ "") for specific middle-categories where the
  // Assumptions sheet has customer-type-specific rates. For all other categories, O="" and
  // the P-key ends with a trailing underscore.
  // -----------------------------------------------------------------------
  const customerType: CustomerType = lookupCustomerType(raw.counterpartyNo);

  if (customerType === 'Unknown') {
    // Only warn for CT-sensitive accounts (where an Unknown CT leads to rate=0)
    const isCTSensitiveForWarn = CT_SENSITIVE_MIDDLE_CATEGORIES.has(middleCategory ?? '');
    if (isCTSensitiveForWarn) {
      warnings.push(`Counterparty "${raw.counterpartyNo}" not found in customer type table → defaulted to "Unknown".`);
    }
  }
  notes.push(`Customer type: counterpartyNo=${raw.counterpartyNo ?? 'null'} → ${customerType}`);

  // -----------------------------------------------------------------------
  // Step 3: Adjusted base CCY amount
  //         adjustedBaseCcyAmt = baseCcyAmt × signMultiplier
  //         Sign ensures: assets are positive, liabilities are negative
  //         (so outflows become negative weighted amounts before abs)
  // -----------------------------------------------------------------------
  const baseCcyAmtSafe  = raw.baseCcyAmt ?? 0;
  const adjustedBaseCcyAmt = baseCcyAmtSafe * signMultiplier;

  if (raw.baseCcyAmt === null) {
    warnings.push('baseCcyAmt is null → treated as 0.');
  }
  notes.push(`adjustedBaseCcyAmt = ${baseCcyAmtSafe} × ${signMultiplier} = ${adjustedBaseCcyAmt}`);

  // -----------------------------------------------------------------------
  // Step 4: Assumption lookup via P-key
  //
  // Excel BS_RE33!P column = M&"_"&O  (middleCategory + "_" + customerType)
  // For non-CT-sensitive accounts, O="" → P-key = middleCategory + "_"
  // For CT-sensitive accounts, O = customer type from CT table (or "Unknown")
  //
  // Excel Assumptions table is keyed on this P-key (column C).
  // -----------------------------------------------------------------------
  const isCTSensitive = CT_SENSITIVE_MIDDLE_CATEGORIES.has(middleCategory ?? '');
  const pKeyCustomerType = isCTSensitive ? customerTypeToPKeyString(customerType) : '';
  const pKey = `${middleCategory ?? ''}_${pKeyCustomerType}`;

  const assumptionResult = lookupAssumptionByPKey(pKey);
  const { assumptionRate } = assumptionResult;

  if (assumptionResult.source === 'not_found') {
    warnings.push(`No assumption rate found for pKey="${pKey}" → rate = 0.`);
  } else {
    notes.push(`Assumption: pKey="${pKey}" → rate=${assumptionRate}. [${assumptionResult.description}]`);
  }

  // -----------------------------------------------------------------------
  // Step 5: Weighted amount
  //         For HQLA: weightedAmount = eligible HQLA (after haircut)
  //         For outflows: weightedAmount = stressed outflow
  //         For inflows: weightedAmount = expected inflow
  // -----------------------------------------------------------------------
  const weightedAmount = mapping ? adjustedBaseCcyAmt * assumptionRate : 0;
  notes.push(`weightedAmount = ${adjustedBaseCcyAmt} × ${assumptionRate} = ${weightedAmount}`);

  // -----------------------------------------------------------------------
  // Step 6: Maturity resolution
  //
  //   Priority:
  //     a) maturityAdjustment table (regulatory/behavioural override)
  //     b) raw maturityDate (column J)
  //     c) nextInterestResetDate (column K) — for floating-rate instruments
  //        where the interest reset is the next contractual cashflow date
  //     d) null → open_maturity
  //
  // TODO Phase 3: add product-type specific maturity rules (e.g. revolving
  //   credit always uses behavioural maturity from a separate policy table)
  // -----------------------------------------------------------------------
  let lcrMaturityDate: string | null = null;
  let maturitySource: MaturitySource = 'none';

  const adjResult = lookupMaturityAdjustment(raw.acCode, raw.refNo, reportDate);
  if (adjResult) {
    lcrMaturityDate = adjResult.adjustedMaturityDate;
    maturitySource  = 'maturityAdjustment';
    notes.push(
      `Maturity: override applied [${adjResult.matchLevel}] → ${lcrMaturityDate}. Reason: ${adjResult.reason}`
    );
  } else if (raw.maturityDate) {
    lcrMaturityDate = raw.maturityDate;
    maturitySource  = 'maturityDate';
    notes.push(`Maturity: raw maturityDate used → ${lcrMaturityDate}`);
  } else if (raw.nextInterestResetDate) {
    lcrMaturityDate = raw.nextInterestResetDate;
    maturitySource  = 'nextInterestResetDate';
    notes.push(`Maturity: nextInterestResetDate used as fallback → ${lcrMaturityDate}`);
    warnings.push('maturityDate absent; using nextInterestResetDate as proxy maturity.');
  } else {
    maturitySource = 'none';
    notes.push('Maturity: no date available → open_maturity bucket');
  }

  // Special case: open_maturity sentinel date (far future) → treat as open_maturity
  if (lcrMaturityDate === '2999-12-31' || lcrMaturityDate === '2099-12-31') {
    lcrMaturityDate = '2999-12-31'; // Excel serial 401768 = 2999-12-31
    notes.push('Maturity: sentinel date 2999-12-31 → will classify as over365D (effectively open_maturity)');
  }

  // -----------------------------------------------------------------------
  // Step 7: Days to maturity
  // -----------------------------------------------------------------------
  const daysToMaturity = calcDaysToMaturity(reportDate, lcrMaturityDate);

  // -----------------------------------------------------------------------
  // Step 8: Bucket classification
  // -----------------------------------------------------------------------
  const maturityBucket = classifyBucket(daysToMaturity);
  notes.push(`daysToMaturity = ${daysToMaturity ?? 'null'} → bucket = ${maturityBucket}`);

  // -----------------------------------------------------------------------
  // Step 9: Bucket allocation
  // -----------------------------------------------------------------------
  const buckets = maturityBucket
    ? allocateToBucket(maturityBucket, weightedAmount)
    : emptyBuckets();

  // -----------------------------------------------------------------------
  // Step 10: Flags
  // -----------------------------------------------------------------------
  const isCashInflow  = effectiveCategory === 'CashInflow';
  const isCashOutflow = effectiveCategory === 'CashOutflow';

  // -----------------------------------------------------------------------
  // Row-level debug log (first 20 rows per run)
  // -----------------------------------------------------------------------
  if (_rowDebugCount < ROW_DEBUG_LIMIT) {
    _rowDebugCount++;
    const summaryClass = isHqla ? `HQLA(${hqlaLevel})`
                       : isCashOutflow ? 'CashOutflow'
                       : isCashInflow  ? 'CashInflow'
                       : effectiveCategory ?? 'unmapped';
    console.log(
      `[rowCalc] [${_rowDebugCount}/${ROW_DEBUG_LIMIT}] ` +
      `row=${raw.rowNumber} acCode=${raw.acCode} ` +
      `category=${effectiveCategory ?? 'null'} ` +
      `assetLiabilityType=${assetLiabilityType ?? 'null'} ` +
      `assumptionRate=${assumptionRate} ` +
      `adjAmt=${adjustedBaseCcyAmt.toFixed(2)} ` +
      `weightedAmt=${weightedAmount.toFixed(2)} ` +
      `summaryClass=${summaryClass}`
    );
  }

  // -----------------------------------------------------------------------
  // Assemble result
  // -----------------------------------------------------------------------
  return {
    rowNumber: raw.rowNumber,

    // Raw input echoed
    acCode:                  raw.acCode,
    acName:                  raw.acName,
    refNo:                   raw.refNo,
    counterpartyNo:          raw.counterpartyNo,
    counterpartyName:        raw.counterpartyName,
    ccy:                     raw.ccy,
    balanceAmt:              raw.balanceAmt,
    baseCcyAmt:              raw.baseCcyAmt,
    approvalContractDate:    raw.approvalContractDate,
    maturityDate:            raw.maturityDate,
    nextInterestResetDate:   raw.nextInterestResetDate,

    // Account mapping (effectiveCategory/effectiveHqlaOrCashflowType reflect RefNo override)
    category: effectiveCategory,
    middleCategory,
    hqlaOrCashflowType: effectiveHqlaOrCashflowType,
    assetLiabilityType,
    signMultiplier,
    isHqla,
    hqlaLevel,

    // Counterparty
    customerType,

    // Calculations
    adjustedBaseCcyAmt,
    assumptionRate,
    weightedAmount,

    // Maturity
    lcrMaturityDate,
    maturitySource,
    daysToMaturity,
    maturityBucket,

    // Buckets
    buckets,

    // Flags
    isCashInflow,
    isCashOutflow,

    // Audit trail
    notes,
    warnings,
  };
}
