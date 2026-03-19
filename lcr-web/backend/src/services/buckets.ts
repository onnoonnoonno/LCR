/**
 * Bucket Allocation Service
 *
 * Determines the maturity bucket for a given days-to-maturity value
 * and allocates a weighted amount into a LcrBuckets record.
 *
 * Bucket definitions (calendar days from reportDate):
 *   overdue       → maturity date has already passed (days < 0)
 *   1D            → 0–1 days   (overnight / today)
 *   2_7D          → 2–7 days
 *   8_30D         → 8–30 days  ← the critical Basel III 30-day stress window
 *   31_90D        → 31–90 days
 *   91_180D       → 91–180 days
 *   181_365D      → 181–365 days
 *   over365D      → > 365 days
 *   open_maturity → no maturity date (demand / current / revolving)
 *
 * This module is pure – no side effects, fully testable in isolation.
 */

import dayjs from 'dayjs';
import { LcrBuckets, MaturityBucket } from '../types/bs-re33';

// ---------------------------------------------------------------------------
// Zero-initialised buckets
// ---------------------------------------------------------------------------

export function emptyBuckets(): LcrBuckets {
  return {
    overdue: 0,
    b1D: 0,
    b2_7D: 0,
    b8_30D: 0,
    b31_90D: 0,
    b91_180D: 0,
    b181_365D: 0,
    bOver365D: 0,
    bOpenMaturity: 0,
  };
}

// ---------------------------------------------------------------------------
// Days-to-maturity → bucket name
// ---------------------------------------------------------------------------

/**
 * Classify a days-to-maturity value into a MaturityBucket.
 *
 * @param daysToMaturity  Signed integer: negative means already past due.
 *                        Pass null for instruments with no maturity date.
 */
export function classifyBucket(daysToMaturity: number | null): MaturityBucket {
  if (daysToMaturity === null) return 'open_maturity';
  if (daysToMaturity < 0) return 'overdue';
  if (daysToMaturity <= 1) return '1D';
  if (daysToMaturity <= 7) return '2_7D';
  if (daysToMaturity <= 30) return '8_30D';
  if (daysToMaturity <= 90) return '31_90D';
  if (daysToMaturity <= 180) return '91_180D';
  if (daysToMaturity <= 365) return '181_365D';
  return 'over365D';
}

// ---------------------------------------------------------------------------
// Allocate weighted amount into bucket
// ---------------------------------------------------------------------------

/**
 * Create a LcrBuckets record with `amount` placed into the correct bucket
 * and all other buckets zero.
 */
export function allocateToBucket(bucket: MaturityBucket, amount: number): LcrBuckets {
  const b = emptyBuckets();
  switch (bucket) {
    case 'overdue':        b.overdue = amount;       break;
    case '1D':             b.b1D = amount;            break;
    case '2_7D':           b.b2_7D = amount;          break;
    case '8_30D':          b.b8_30D = amount;         break;
    case '31_90D':         b.b31_90D = amount;        break;
    case '91_180D':        b.b91_180D = amount;       break;
    case '181_365D':       b.b181_365D = amount;      break;
    case 'over365D':       b.bOver365D = amount;      break;
    case 'open_maturity':  b.bOpenMaturity = amount;  break;
  }
  return b;
}

// ---------------------------------------------------------------------------
// Bucket aggregation helpers
// ---------------------------------------------------------------------------

/** Sum two LcrBuckets records element-wise */
export function addBuckets(a: LcrBuckets, b: LcrBuckets): LcrBuckets {
  return {
    overdue:       a.overdue       + b.overdue,
    b1D:           a.b1D           + b.b1D,
    b2_7D:         a.b2_7D         + b.b2_7D,
    b8_30D:        a.b8_30D        + b.b8_30D,
    b31_90D:       a.b31_90D       + b.b31_90D,
    b91_180D:      a.b91_180D      + b.b91_180D,
    b181_365D:     a.b181_365D     + b.b181_365D,
    bOver365D:     a.bOver365D     + b.bOver365D,
    bOpenMaturity: a.bOpenMaturity + b.bOpenMaturity,
  };
}

/** Sum all bucket values into a single number */
export function totalBuckets(b: LcrBuckets): number {
  return (
    b.overdue + b.b1D + b.b2_7D + b.b8_30D +
    b.b31_90D + b.b91_180D + b.b181_365D + b.bOver365D + b.bOpenMaturity
  );
}

// ---------------------------------------------------------------------------
// Calendar-day difference
// ---------------------------------------------------------------------------

/**
 * Calculate the number of calendar days from reportDate to maturityDate.
 * Returns null if either date is null/invalid.
 * Returns a negative number if maturityDate is before reportDate.
 */
export function calcDaysToMaturity(
  reportDate: string,
  maturityDate: string | null
): number | null {
  if (!maturityDate) return null;
  const report = dayjs(reportDate);
  const maturity = dayjs(maturityDate);
  if (!report.isValid() || !maturity.isValid()) return null;
  return maturity.diff(report, 'day');
}

// ---------------------------------------------------------------------------
// LCR 30-day window helper
// ---------------------------------------------------------------------------

/**
 * Returns true if the instrument matures within the 30-day LCR stress window.
 * Overdue instruments (already matured) are included (they need immediate liquidity).
 */
export function isWithin30DayWindow(bucket: MaturityBucket): boolean {
  return ['overdue', '1D', '2_7D', '8_30D'].includes(bucket);
}
