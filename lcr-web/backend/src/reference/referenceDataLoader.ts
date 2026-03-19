/**
 * Reference Data Loader
 *
 * Single entry point for loading all reference tables.
 *
 * Architecture note:
 *   Phase 2  → loads from JSON files in reference/data/
 *   Phase 3+ → swap loadFromJson() with loadFromDatabase() without touching
 *              the rest of the engine. The ReferenceData interface is stable.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ReferenceData,
  AccountMapping,
  CustomerTypeEntry,
  AssumptionEntry,
  MaturityAdjustmentEntry,
} from '../types/bs-re33';

const DATA_DIR = path.join(__dirname, 'data');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readJson<T>(filename: string): T {
  const file = path.join(DATA_DIR, filename);
  const raw = fs.readFileSync(file, 'utf-8');
  // Strip entries that are pure comment objects (have a _comment key and nothing else meaningful)
  const parsed = JSON.parse(raw) as T;
  return parsed;
}

function stripComments<T extends object>(entries: T[]): T[] {
  // Remove any entries that only serve as JSON comment markers (_comment or _section keys only)
  return entries.filter((e) => {
    const hasData = 'acCode' in e || 'counterpartyNo' in e || 'pKey' in e || 'hqlaOrCashflowType' in e;
    const isComment = ('_comment' in e || '_section' in e || '_note' in e) && !hasData;
    return !isComment;
  });
}

// ---------------------------------------------------------------------------
// Loaders per table
// ---------------------------------------------------------------------------

function loadAccountMappings(): AccountMapping[] {
  const raw = readJson<Array<AccountMapping & { _comment?: string; _section?: string }>>('accountMapping.json');
  return stripComments(raw) as AccountMapping[];
}

function loadCustomerTypes(): CustomerTypeEntry[] {
  const raw = readJson<Array<CustomerTypeEntry & { _comment?: string; _note?: string }>>('customerTypes.json');
  return stripComments(raw) as CustomerTypeEntry[];
}

function loadAssumptions(): AssumptionEntry[] {
  const raw = readJson<Array<AssumptionEntry & { _comment?: string; _section?: string; _note?: string }>>('assumptions.json');
  return stripComments(raw) as AssumptionEntry[];
}

function loadMaturityAdjustments(): MaturityAdjustmentEntry[] {
  const raw = readJson<Array<MaturityAdjustmentEntry & { _comment?: string; _note?: string }>>('maturityAdjustments.json');
  return stripComments(raw) as MaturityAdjustmentEntry[];
}

// ---------------------------------------------------------------------------
// Singleton cache – reference data is static within a process lifetime
// (flush by restarting the server, or add a reload endpoint later)
// ---------------------------------------------------------------------------

let _cached: ReferenceData | null = null;

/**
 * Load all reference tables and return them as a single bundle.
 * Results are cached after the first load.
 *
 * @param forceReload  Set true to bypass the cache (useful for hot-reload in dev)
 */
export function loadReferenceData(forceReload = false): ReferenceData {
  if (_cached && !forceReload) return _cached;

  const accountMappings = loadAccountMappings();
  const customerTypes = loadCustomerTypes();
  const assumptions = loadAssumptions();
  const maturityAdjustments = loadMaturityAdjustments();

  console.log(
    `[referenceData] Loaded: ${accountMappings.length} accountMappings, ` +
    `${customerTypes.length} customerTypes, ` +
    `${assumptions.length} assumptions, ` +
    `${maturityAdjustments.length} maturityAdjustments`
  );

  _cached = { accountMappings, customerTypes, assumptions, maturityAdjustments };
  return _cached;
}
