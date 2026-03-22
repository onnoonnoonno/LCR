/**
 * IRRBB Service — 12M Interest Rate Sensitive Gap Ratio
 *
 * Reproduces the RE33(IRRBB) and Summary_IRRBB Excel calculation
 * from raw A:K data only (no dependency on Summary_IRRBB sheet).
 *
 * Pipeline:
 *   1. Build composite key (A + F + D + E) per row, stripping leading zeros from D
 *   2. Compute Adjusted Amount (M): sign-flip for 7 special A/C codes
 *   3. Determine Repricing Date (N): SOFR exception → mapping table → K fallback
 *   4. Classify row (P): Asset / Liability / Equity
 *   5. Assign amount to the matching repricing bucket
 *   6. SUMIF per bucket for Asset rows and Liability rows
 *   7. Compute P26–P30
 */

import dayjs from 'dayjs';
import { IrrbbData, IrrbbTableRow } from '../services/excelParser';

// ============================================================
// Types
// ============================================================

export interface LcrRawRowForIrrbb {
  acCode:           string | null;
  counterpartyNo:   string | null;
  counterpartyName: string | null;
  ccy:              string | null;
  baseCcyAmt:       number | null;
  nextInterestResetDate: string | null; // YYYY-MM-DD
}

interface BucketBoundary {
  name:    string;
  from:    string; // YYYY-MM-DD (exclusive lower bound: from < date)
  to:      string; // YYYY-MM-DD (inclusive upper bound: date <= to)
}

// ============================================================
// Constants
// ============================================================

/** A/C codes whose sign is flipped on Column H before any further processing */
const SIGN_FLIP_CODES = new Set([
  10690001, 10690003, 10690004, 10690006, 10690007, 20920006,
]);

/** A/C codes that are always classified as Liability (overrides numeric range) */
const LIABILITY_OVERRIDE_CODES = new Set([
  10690001, 10690003, 10690004, 10690006, 10690007,
]);

/** A/C codes that are always classified as Asset (overrides numeric range) */
const ASSET_OVERRIDE_CODES = new Set([20920006]);

/**
 * SOFR-linked row-level exceptions that reprice Overnight (reportDate + 1).
 * Keys are built with leading zeros stripped from counterpartyNo, matching
 * the Excel formula: A & "_" & F & "_" & D & "_" & E where D is stored
 * numerically (no leading zero) in the completed workbook.
 */
const SOFR_EXCEPTION_KEYS = new Set([
  '10630001_USD_100000014_PERDAMAN CHEMICALS & FERTILISERS (FINANCE)PTY LTD',
  '10620001_USD_100000033_MACQUARIE GROUP LIMITED',
]);

/**
 * Repricing Maturity Adjustment mapping (Repricing Maturity Adj. sheet).
 *
 * Value semantics:
 *   null              → "Non_sensitive": excluded from all rate-sensitive buckets
 *   number (offsetDays) → add this many days to reportDate for repricing date
 *
 * Sources: APS117_APRA Repricing analysis_05022026.xlsx, sheet "Repricing Maturity Adj."
 * 149 Non_sensitive + 18 date-offset entries = 167 total
 */
const REPRICING_MATURITY_ADJ: Record<number, null | number> = {
  // ── Non-sensitive codes (149) ──────────────────────────────────────────────
  10101001: null, 10103001: null,
  10680001: null, 10680002: null,
  10690001: null, 10690002: null, 10690003: null, 10690004: null,
  10690005: null, 10690006: null, 10690007: null, 10690008: null,
  10910001: null, 10910002: null, 10910003: null, 10910004: null,
  10910005: null, 10910006: null, 10910007: null, 10910008: null,
  10910009: null, 10910010: null, 10910011: null, 10910012: null,
  10910013: null, 10910014: null, 10910015: null, 10910016: null,
  10910017: null, 10910018: null, 10910020: null, 10910021: null,
  10910022: null, 10910023: null, 10910024: null, 10910025: null,
  10910026: null, 10910027: null, 10910091: null,
  10920001: null, 10920002: null, 10920003: null, 10920004: null,
  10920005: null, 10920006: null, 10920007: null, 10920008: null,
  10920009: null, 10920010: null, 10920011: null, 10920012: null,
  10920013: null, 10920014: null,
  10930001: null, 10930006: null, 10930009: null,
  10991001: null, 10991002: null,
  10999001: null, 10999002: null,
  12110001: null, 12110002: null, 12110003: null, 12110004: null, 12110005: null,
  12120001: null, 12120002: null, 12120003: null, 12120004: null,
  12130001: null,
  12210001: null, 12210002: null, 12210003: null, 12210004: null, 12210005: null,
  12310001: null, 12310002: null, 12310003: null, 12310004: null, 12310005: null,
  12320001: null, 12320002: null, 12320003: null,
  12330001: null,
  13101001: null,
  14103001: null,
  20610001: null, 20610002: null, 20610009: null,
  20910002: null, 20910003: null, 20910004: null, 20910006: null,
  20910007: null, 20910008: null, 20910009: null, 20910010: null,
  20910011: null, 20910012: null, 20910013: null,
  20920001: null, 20920002: null, 20920003: null, 20920004: null,
  20920005: null, 20920006: null, 20920007: null, 20920008: null,
  20920009: null, 20920011: null, 20920012: null, 20920013: null,
  20920014: null, 20920015: null, 20920016: null, 20920017: null,
  20920018: null, 20920019: null, 20920021: null, 20920022: null,
  20920023: null, 20920024: null, 20920025: null, 20920026: null,
  20920027: null,
  20930001: null, 20930006: null, 20930009: null,
  20970001: null, 20970002: null, 20970003: null, 20970004: null, 20970005: null,
  20980001: null, 20980002: null,
  20990013: null, 20990014: null, 20990015: null, 20990016: null,
  20990017: null, 20990018: null,
  23100101: null,
  23200001: null,
  24103001: null,
  25100001: null,
  28810002: null, 28810019: null,
  28900001: null,
  30000001: null,
  // ── Date-offset entries (18) ───────────────────────────────────────────────
  // +1 day from reportDate → Overnight bucket (Q)
  10211001: 1,
  10212001: 1,
  10212002: 1,
  // +15 days from reportDate → 0-to-<1-month bucket (R)
  15100002: 15,
  20110101: 15,
  20110102: 15,
  20110201: 15,
  20110202: 15,
  20111001: 15,
  20112001: 15,
  20112002: 15,
  20121001: 15,
  20121002: 15,
  20121003: 15,
  20121004: 15,
  20121005: 15,
  20121006: 15,
  25100002: 15,
};

// ============================================================
// Date helpers
// ============================================================

function addDays(dateStr: string, days: number): string {
  return dayjs(dateStr).add(days, 'day').format('YYYY-MM-DD');
}

/**
 * Equivalent of Excel EOMONTH(start, months):
 * Returns the last day of the month that is `months` months after start.
 */
function eoMonth(dateStr: string, months: number): string {
  const d = dayjs(dateStr);
  // Move to 1st of (month + months + 1), then subtract 1 day → last of target month
  return d.add(months + 1, 'month').startOf('month').subtract(1, 'day').format('YYYY-MM-DD');
}

/**
 * Build the 16 rate-sensitive repricing buckets + 1 non-sensitive slot
 * from the report date, using the same Excel boundary formulas.
 *
 * Boundary formula (row 9 / row 10 in RE33):
 *   Q:  from = reportDate,        to = reportDate + 1
 *   R:  from = Q_to,              to = EOMONTH(reportDate, 1)
 *   S:  from = R_to,              to = EOMONTH(R_to, 1)
 *   T:  from = S_to,              to = EOMONTH(S_to, 1)
 *   U:  from = T_to,              to = EOMONTH(T_to, 3)
 *   V:  from = U_to,              to = EOMONTH(U_to, 3)
 *   W:  from = V_to,              to = EOMONTH(V_to, 3)
 *   X:  from = W_to,              to = EOMONTH(W_to, 12)
 *   Y–AA: chained +12M each
 *   AB: from = AA_to,             to = EOMONTH(AA_to, 24)
 *   AC: from = AB_to,             to = EOMONTH(AB_to, 36)
 *   AD: from = AC_to,             to = EOMONTH(AC_to, 60)
 *   AE: from = AD_to,             to = EOMONTH(AD_to, 60)
 *   AF: from = AE_to,             to = EOMONTH(AE_to, 120)
 *
 * Assignment rule: amount goes in bucket if bucketFrom < repricingDate <= bucketTo
 */
export function computeBuckets(reportDate: string): BucketBoundary[] {
  const to: string[] = [];

  to[0]  = addDays(reportDate, 1);                  // Q: O/N
  to[1]  = eoMonth(reportDate, 1);                   // R: 0-<1M
  to[2]  = eoMonth(to[1], 1);                        // S: 1-<2M
  to[3]  = eoMonth(to[2], 1);                        // T: 2-<3M
  to[4]  = eoMonth(to[3], 3);                        // U: 3-<6M
  to[5]  = eoMonth(to[4], 3);                        // V: 6-<9M
  to[6]  = eoMonth(to[5], 3);                        // W: 9-<12M
  to[7]  = eoMonth(to[6], 12);                       // X: 1-<2Y
  to[8]  = eoMonth(to[7], 12);                       // Y: 2-<3Y
  to[9]  = eoMonth(to[8], 12);                       // Z: 3-<4Y
  to[10] = eoMonth(to[9], 12);                       // AA: 4-<5Y
  to[11] = eoMonth(to[10], 24);                      // AB: 5-<7Y
  to[12] = eoMonth(to[11], 36);                      // AC: 7-<10Y
  to[13] = eoMonth(to[12], 60);                      // AD: 10-<15Y
  to[14] = eoMonth(to[13], 60);                      // AE: 15-<20Y
  to[15] = eoMonth(to[14], 120);                     // AF: 20+Y

  const names = [
    'Overnight (O/N)',
    '0 to <1 month (excl. O/N)',
    '1 to <2 months',
    '2 to <3 months',
    '3 to <6 months',
    '6 to <9 months',
    '9 to <12 months',
    '1 to <2 years',
    '2 to <3 years',
    '3 to <4 years',
    '4 to <5 years',
    '5 to <7 years',
    '7 to <10 years',
    '10 to <15 years',
    '15 to <20 years',
    '20+ years',
  ];

  const buckets: BucketBoundary[] = [];
  for (let i = 0; i < 16; i++) {
    const from = i === 0 ? reportDate : to[i - 1];
    buckets.push({ name: names[i], from, to: to[i] });
  }
  return buckets;
}

// ============================================================
// Row-level helpers
// ============================================================

function buildCompositeKey(
  acCode: string,
  ccy:    string,
  cptyNo: string,
  cptyName: string,
): string {
  // Strip leading zeros from counterpartyNo to match how Excel stores the
  // numeric cell value (Excel drops leading zeros when treating as number)
  const normalizedNo = String(cptyNo).replace(/^0+/, '');
  return `${acCode}_${ccy}_${normalizedNo}_${cptyName}`;
}

type Classification = 'Asset' | 'Liability' | 'Equity';

function classify(acCode: number): Classification {
  if (LIABILITY_OVERRIDE_CODES.has(acCode)) return 'Liability';
  if (ASSET_OVERRIDE_CODES.has(acCode))     return 'Asset';
  if (acCode < 20_000_000)                  return 'Asset';
  if (acCode < 28_800_000)                  return 'Liability';
  return 'Equity';
}

/** Returns the repricing date string or 'Non_sensitive' or 'Check' */
function getRepricingDate(
  compositeKey: string,
  acCode:       number,
  kDate:        string | null,
  reportDate:   string,
): string {
  // Priority 1: SOFR exception → Overnight
  if (SOFR_EXCEPTION_KEYS.has(compositeKey)) {
    return addDays(reportDate, 1);
  }

  // Priority 2: Mapping table lookup
  if (acCode in REPRICING_MATURITY_ADJ) {
    const adj = REPRICING_MATURITY_ADJ[acCode];
    if (adj === null) return 'Non_sensitive';
    return addDays(reportDate, adj);
  }

  // Priority 3: Fallback to K (Next Interest Reset Date)
  if (kDate && kDate >= reportDate) return kDate;

  // K is missing, blank, or in the past → exclude from aggregation
  return 'Check';
}

/** Returns the bucket index (0-15) or -1 (non-sensitive / check) */
function assignBucket(repricingDate: string, buckets: BucketBoundary[]): number {
  if (repricingDate === 'Non_sensitive' || repricingDate === 'Check') return -1;
  for (let i = 0; i < buckets.length; i++) {
    if (repricingDate > buckets[i].from && repricingDate <= buckets[i].to) {
      return i;
    }
  }
  // Beyond the last bucket's end — should not happen in practice
  return -1;
}

// ============================================================
// Main calculation function
// ============================================================

/**
 * Calculate IRRBB from raw row data.
 *
 * @param rows       Parsed raw rows (from parseExcelBuffer)
 * @param reportDate Report date in YYYY-MM-DD
 * @returns          IrrbbData containing P26–P30 and the summary table
 */
export function calculateIrrbb(
  rows:       LcrRawRowForIrrbb[],
  reportDate: string,
): IrrbbData {
  const buckets = computeBuckets(reportDate);

  // 16 rate-sensitive buckets for Asset and Liability, plus non-sensitive
  const assetBuckets    = new Array<number>(16).fill(0);
  const liabBuckets     = new Array<number>(16).fill(0);
  let   assetNonSens    = 0;
  let   liabNonSens     = 0;

  for (const row of rows) {
    if (!row.acCode) continue;
    const acCode = Number(row.acCode);
    if (isNaN(acCode)) continue;

    const baseCcyAmt = row.baseCcyAmt ?? 0;

    // Step 1: Adjusted amount (sign flip)
    const adjustedAmt = SIGN_FLIP_CODES.has(acCode) ? -baseCcyAmt : baseCcyAmt;

    // Step 2: Classification
    const classification = classify(acCode);
    if (classification === 'Equity') continue; // Equity excluded from P26-P30

    // Step 3: Composite key for SOFR exceptions
    const compositeKey = buildCompositeKey(
      row.acCode ?? '',
      row.ccy    ?? '',
      row.counterpartyNo   ?? '',
      row.counterpartyName ?? '',
    );

    // Step 4: Repricing date
    const repricingDate = getRepricingDate(compositeKey, acCode, row.nextInterestResetDate, reportDate);

    if (repricingDate === 'Check') continue; // Excluded

    // Step 5: Bucket assignment
    if (repricingDate === 'Non_sensitive') {
      if (classification === 'Asset')     assetNonSens += adjustedAmt;
      else                                liabNonSens  += adjustedAmt;
      continue;
    }

    const bucketIdx = assignBucket(repricingDate, buckets);
    if (bucketIdx === -1) continue; // Outside all buckets — skip

    if (classification === 'Asset')     assetBuckets[bucketIdx] += adjustedAmt;
    else                                liabBuckets[bucketIdx]  += adjustedAmt;
  }

  // ── Summary_IRRBB P26–P30 ──────────────────────────────────────────────────
  // Buckets 0–6  = Q through W = Overnight through 9-to-<12 months (within 1 year)
  // Buckets 0–15 = Q through AF = all 16 rate-sensitive buckets
  const P26 = assetBuckets.slice(0, 7).reduce((a, b) => a + b, 0);
  const P27 = liabBuckets.slice(0, 7).reduce((a, b) => a + b, 0);
  const P28 = Math.abs(P26 - P27);
  const P29 = assetBuckets.reduce((a, b) => a + b, 0); // all 16 rate-sensitive
  const P30 = P29 !== 0 ? P28 / P29 : null;

  const table: IrrbbTableRow[] = [
    {
      label:     'Interest rate-sensitive Assets repricing within one year',
      value:     P26,
      isPercent: false,
    },
    {
      label:     'Interest rate-sensitive Liabilities repricing within one year',
      value:     P27,
      isPercent: false,
    },
    {
      label:     'Net position/gap within one year',
      value:     P28,
      isPercent: false,
    },
    {
      label:     'Total Interest rate-sensitive Assets',
      value:     P29,
      isPercent: false,
    },
    {
      label:     'Interest rate-sensitive Gap Ratio(12M)',
      value:     P30,
      isPercent: true,
    },
  ];

  return { ratio: P30, table };
}

// ============================================================
// Validation helper (used during development / verification)
// ============================================================

export interface IrrbbBucketDetail {
  bucketName:     string;
  assetAmount:    number;
  liabAmount:     number;
}

export interface IrrbbFullResult {
  irrbbData:      IrrbbData;
  assetBuckets:   number[];
  liabBuckets:    number[];
  assetNonSens:   number;
  liabNonSens:    number;
  buckets:        BucketBoundary[];
  P26: number; P27: number; P28: number; P29: number; P30: number | null;
}

export function calculateIrrbbFull(
  rows:       LcrRawRowForIrrbb[],
  reportDate: string,
): IrrbbFullResult {
  const buckets = computeBuckets(reportDate);

  const assetBuckets = new Array<number>(16).fill(0);
  const liabBuckets  = new Array<number>(16).fill(0);
  let   assetNonSens = 0;
  let   liabNonSens  = 0;

  for (const row of rows) {
    if (!row.acCode) continue;
    const acCode = Number(row.acCode);
    if (isNaN(acCode)) continue;

    const adjustedAmt = SIGN_FLIP_CODES.has(acCode)
      ? -(row.baseCcyAmt ?? 0)
      :  (row.baseCcyAmt ?? 0);

    const classification = classify(acCode);
    if (classification === 'Equity') continue;

    const compositeKey = buildCompositeKey(
      row.acCode ?? '', row.ccy ?? '',
      row.counterpartyNo ?? '', row.counterpartyName ?? '',
    );
    const repricingDate = getRepricingDate(compositeKey, acCode, row.nextInterestResetDate, reportDate);

    if (repricingDate === 'Check') continue;

    if (repricingDate === 'Non_sensitive') {
      if (classification === 'Asset') assetNonSens += adjustedAmt;
      else                            liabNonSens  += adjustedAmt;
      continue;
    }

    const bucketIdx = assignBucket(repricingDate, buckets);
    if (bucketIdx === -1) continue;

    if (classification === 'Asset') assetBuckets[bucketIdx] += adjustedAmt;
    else                            liabBuckets[bucketIdx]  += adjustedAmt;
  }

  const P26 = assetBuckets.slice(0, 7).reduce((a, b) => a + b, 0);
  const P27 = liabBuckets.slice(0, 7).reduce((a, b) => a + b, 0);
  const P28 = Math.abs(P26 - P27);
  const P29 = assetBuckets.reduce((a, b) => a + b, 0);
  const P30 = P29 !== 0 ? P28 / P29 : null;

  const table: IrrbbTableRow[] = [
    { label: 'Interest rate-sensitive Assets repricing within one year',       value: P26, isPercent: false },
    { label: 'Interest rate-sensitive Liabilities repricing within one year',  value: P27, isPercent: false },
    { label: 'Net position/gap within one year',                               value: P28, isPercent: false },
    { label: 'Total Interest rate-sensitive Assets',                           value: P29, isPercent: false },
    { label: 'Interest rate-sensitive Gap Ratio(12M)',                         value: P30, isPercent: true  },
  ];

  return { irrbbData: { ratio: P30, table }, assetBuckets, liabBuckets, assetNonSens, liabNonSens, buckets, P26, P27, P28, P29, P30 };
}
