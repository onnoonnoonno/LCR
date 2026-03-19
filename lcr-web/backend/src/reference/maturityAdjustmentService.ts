/**
 * Maturity Adjustment Service
 *
 * Provides regulatory / behavioural maturity overrides for specific
 * account codes and/or reference numbers.
 *
 * Lookup priority:
 *   1. Exact match: (acCode, refNo)       — specific contract override
 *   2. Account-level: (acCode, null)      — applies to all contracts under account
 *   3. No match → return null (use raw maturityDate)
 *
 * Formula-based entries: if an entry has `formulaType` set, the adjusted
 * maturity date is computed at lookup time from the supplied reportDate,
 * reproducing the Excel Maturity Adjustment sheet formula logic:
 *   "tomorrow"           → reportDate + 1 day
 *   "far_future"         → "2999-12-31"
 *   "year_end"           → DATE(YEAR(reportDate), 12, 31)
 *   "eomonth_plus_N"     → EOMONTH(reportDate, 0) + formulaParams.days
 *   "edate_year_end_60M" → DATE(YEAR(EDATE(reportDate, 60)), 12, 31)
 *
 * TODO Phase 3: replace with DB-backed override table.
 */

import dayjs from 'dayjs';
import { MaturityAdjustmentEntry } from '../types/bs-re33';

// Two-level index: acCode → Map<refNo|"*", entry>
type AdjIndex = Map<string, Map<string, MaturityAdjustmentEntry>>;

let _index: AdjIndex | null = null;

const WILDCARD = '*';

export function buildMaturityAdjustmentIndex(entries: MaturityAdjustmentEntry[]): void {
  _index = new Map();
  for (const entry of entries) {
    if (!entry.acCode) continue; // skip malformed entries
    if (!_index.has(entry.acCode)) _index.set(entry.acCode, new Map());
    const refKey = entry.refNo ?? WILDCARD;
    _index.get(entry.acCode)!.set(refKey, entry);
  }
}

function getIndex(): AdjIndex {
  if (!_index) throw new Error('MaturityAdjustmentService not initialised. Call buildMaturityAdjustmentIndex() first.');
  return _index;
}

// ---------------------------------------------------------------------------
// Formula-based date computation
// Reproduces Excel Maturity Adjustment sheet formula patterns.
// ---------------------------------------------------------------------------

function computeAdjustedDate(entry: MaturityAdjustmentEntry, reportDate: string): string {
  if (!entry.formulaType) {
    // Static entry — return the stored date
    return entry.adjustedMaturityDate ?? '2999-12-31';
  }

  const report = dayjs(reportDate);

  switch (entry.formulaType) {
    case 'tomorrow':
      // Excel: "Tomorrow" → next calendar day
      return report.add(1, 'day').format('YYYY-MM-DD');

    case 'far_future':
      // Excel: 2999-12-31 literal — effectively "never matures"
      return '2999-12-31';

    case 'year_end':
      // Excel: DATE(YEAR(N4), 12, 31) — last day of the report year
      return dayjs(new Date(report.year(), 11, 31)).format('YYYY-MM-DD');

    case 'eomonth_plus_N': {
      // Excel: EOMONTH(N4, 0) + N — end of current month plus N calendar days
      const days = entry.formulaParams?.days ?? 0;
      const eom = report.endOf('month');
      return eom.add(days, 'day').format('YYYY-MM-DD');
    }

    case 'edate_year_end_60M': {
      // Excel: DATE(YEAR(EDATE(N4, 60)), 12, 31)
      // = last day of the calendar year that is 60 months from reportDate
      const future60m = report.add(60, 'month');
      return dayjs(new Date(future60m.year(), 11, 31)).format('YYYY-MM-DD');
    }

    default:
      // Unknown formula type — fall back to stored date or far future
      return entry.adjustedMaturityDate ?? '2999-12-31';
  }
}

// ---------------------------------------------------------------------------
// Public lookup API
// ---------------------------------------------------------------------------

export interface MaturityAdjustmentResult {
  adjustedMaturityDate: string;
  reason: string;
  matchLevel: 'exact_contract' | 'account_wildcard';
}

/**
 * Look up a maturity adjustment for a specific account/contract.
 *
 * @param acCode      Account code from the raw row
 * @param refNo       Reference number from the raw row (nullable)
 * @param reportDate  YYYY-MM-DD report date — required for formula-based entries
 * @returns Adjustment details with computed date, or null if no override exists
 */
export function lookupMaturityAdjustment(
  acCode: string | null,
  refNo: string | null,
  reportDate: string,
): MaturityAdjustmentResult | null {
  if (!acCode) return null;

  const idx = getIndex();
  const acMap = idx.get(acCode.trim());
  if (!acMap) return null;

  // 1. Exact contract match
  if (refNo) {
    const exact = acMap.get(refNo.trim());
    if (exact) {
      return {
        adjustedMaturityDate: computeAdjustedDate(exact, reportDate),
        reason: exact.reason,
        matchLevel: 'exact_contract',
      };
    }
  }

  // 2. Wildcard (applies to all refNos under this account)
  const wildcard = acMap.get(WILDCARD);
  if (wildcard) {
    return {
      adjustedMaturityDate: computeAdjustedDate(wildcard, reportDate),
      reason: wildcard.reason,
      matchLevel: 'account_wildcard',
    };
  }

  return null;
}
