/**
 * Customer Type Service
 *
 * Resolves the Basel III counterparty classification for a given counterparty.
 *
 * Lookup strategy (in order):
 *   1. Exact match on counterpartyNo
 *   2. Prefix-based pattern match (e.g. "RET-" prefix → Retail)
 *   3. Falls back to "Unknown"
 *
 * TODO Phase 3: replace with counterparty master DB query or CRM integration.
 */

import { CustomerType, CustomerTypeEntry } from '../types/bs-re33';

type CustomerTypeIndex = Map<string, CustomerType>;

// Prefix-based rules applied when the exact counterpartyNo is not in the index.
// These can be configured later via an env var or DB table.
const PREFIX_RULES: Array<{ prefix: string; customerType: CustomerType }> = [
  { prefix: 'RET-', customerType: 'Retail' },
  { prefix: 'SME-', customerType: 'SME' },
  { prefix: 'CORP-', customerType: 'NonFinancialCorporate' },
  { prefix: 'FI-', customerType: 'FinancialInstitution' },
  { prefix: 'BK-', customerType: 'Interbank' },
  { prefix: 'CB-', customerType: 'CentralBank' },
  { prefix: 'SOV-', customerType: 'Sovereign' },
  { prefix: 'PSE-', customerType: 'PublicSectorEntity' },
];

let _index: CustomerTypeIndex | null = null;

export function buildCustomerTypeIndex(entries: CustomerTypeEntry[]): void {
  _index = new Map(entries.map((e) => [e.counterpartyNo.trim(), e.customerType]));
}

function getIndex(): CustomerTypeIndex {
  if (!_index) throw new Error('CustomerTypeService not initialised. Call buildCustomerTypeIndex() first.');
  return _index;
}

/**
 * Resolve the customer type for a counterparty number.
 *
 * @returns CustomerType string, or "Unknown" if not resolvable
 */
export function lookupCustomerType(counterpartyNo: string | null): CustomerType {
  if (!counterpartyNo) return 'Unknown';

  const idx = getIndex();
  const trimmed = counterpartyNo.trim();

  // 1. Exact match
  const exact = idx.get(trimmed);
  if (exact) return exact;

  // 2. Prefix match
  const upper = trimmed.toUpperCase();
  for (const rule of PREFIX_RULES) {
    if (upper.startsWith(rule.prefix.toUpperCase())) return rule.customerType;
  }

  return 'Unknown';
}
