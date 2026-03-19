/**
 * Assumption Service
 *
 * Looks up the LCR assumption rate (run-off / inflow / HQLA haircut factor)
 * for a given P-key, which is computed as:
 *
 *   pKey = middleCategory + "_" + customerType
 *
 * This mirrors Excel BS_RE33!P column = M&"_"&O.
 *
 * For accounts where customer type is not applicable (not in the CT-sensitive
 * set), customerType is treated as "" (empty), so pKey ends with "_":
 *   e.g. "Deposit_Asset(Our)_", "Inter-office (Inter-office A)_"
 *
 * Lookup:
 *   1. Exact pKey match in the index.
 *   2. Not found → 0.0 (conservative; caller adds a warning).
 *
 * TODO Phase 3: replace with DB-backed parametric table.
 */

import { AssumptionEntry } from '../types/bs-re33';

type AssumptionIndex = Map<string, AssumptionEntry>;

let _index: AssumptionIndex | null = null;

export function buildAssumptionIndex(entries: AssumptionEntry[]): void {
  _index = new Map();
  for (const entry of entries) {
    if (!entry.pKey) continue;
    _index.set(entry.pKey, entry);
  }
  console.log(
    `[assumptionService] Index built with ${_index.size} P-key entries.\n` +
    `[assumptionService] P-keys: [${[..._index.keys()].join(', ')}]`
  );
}

function getIndex(): AssumptionIndex {
  if (!_index) throw new Error('AssumptionService not initialised. Call buildAssumptionIndex() first.');
  return _index;
}

export interface AssumptionLookupResult {
  assumptionRate: number;
  description: string;
  /** How the entry was resolved */
  source: 'exact' | 'not_found';
}

/**
 * Look up the assumption rate for a given P-key.
 *
 * @param pKey  middleCategory + "_" + customerType (or just middleCategory + "_" for blank CT)
 */
export function lookupAssumptionByPKey(pKey: string | null): AssumptionLookupResult {
  if (!pKey) {
    return { assumptionRate: 0, description: 'No P-key — cannot determine assumption', source: 'not_found' };
  }

  const idx = getIndex();
  const entry = idx.get(pKey);
  if (entry) {
    return { assumptionRate: entry.assumptionRate, description: entry.description, source: 'exact' };
  }

  return {
    assumptionRate: 0,
    description: `No assumption found for pKey="${pKey}"`,
    source: 'not_found',
  };
}

/**
 * Legacy wrapper kept for backward compatibility.
 * Constructs the P-key from hqlaOrCashflowType (used as middleCategory fallback)
 * and customerType, then delegates to lookupAssumptionByPKey.
 *
 * @deprecated Use lookupAssumptionByPKey directly with the computed P-key.
 */
export function lookupAssumption(
  hqlaOrCashflowType: string | null,
  customerType: string | null,
): AssumptionLookupResult {
  if (!hqlaOrCashflowType) {
    return { assumptionRate: 0, description: 'No flow type — cannot determine assumption', source: 'not_found' };
  }
  const pKey = `${hqlaOrCashflowType}_${customerType ?? ''}`;
  return lookupAssumptionByPKey(pKey);
}
