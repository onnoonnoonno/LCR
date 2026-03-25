/**
 * Account Mapping Service
 *
 * Looks up the LCR classification for a given account code.
 * Backed by reference/data/accountMapping.json (Phase 2).
 *
 * Lookup strategy (in order):
 *   1. Exact match on normalised acCode
 *   2. Prefix match – if exact match fails, try progressively shorter prefixes
 *      (useful when the chart-of-accounts uses hierarchical codes like 21001 → 2100x)
 *   3. Not found → return null (the caller adds a warning)
 *
 * TODO Phase 3: replace JSON file with DB query.
 */

import { AccountMapping } from '../types/bs-re33';

// ---------------------------------------------------------------------------
// Key normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise an account code to a canonical string before indexing or lookup.
 *
 * Both the index-build path AND the lookup path call this function so both
 * sides are always comparable on equal footing.
 *
 * Rules applied in order:
 *  1. Cast to string   – handles numeric cells where xlsx returns cell.v as a number
 *  2. Replace NBSP     – some Excel exports use U+00A0 non-breaking spaces
 *  3. Trim whitespace  – strip leading/trailing spaces
 *  4. Strip trailing   – "11000.0" / "11000.00" → "11000"
 *                        (happens when account code is stored in a numeric-formatted cell)
 */
function normalizeKey(raw: unknown): string {
  return String(raw)
    .replace(/\u00A0/g, ' ')  // non-breaking space → regular space
    .trim()
    .replace(/\.0+$/, '');    // "11000.0" → "11000", "11000.00" → "11000"
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

type MappingIndex = Map<string, AccountMapping>;

let _index: MappingIndex | null = null;

// ---------------------------------------------------------------------------
// Debug throttle
// ---------------------------------------------------------------------------

const DEBUG_LIMIT = 20;
let _debugCount = 0;

/**
 * Reset the per-run debug counter.
 * Call once at the start of each calculation run so the first 20 lookups
 * of every new run are logged regardless of prior runs.
 */
export function resetLookupDebugLog(): void {
  _debugCount = 0;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Build the lookup index from the loaded account mapping table.
 * Logs all index keys so mismatches with uploaded acCodes can be spotted.
 */
export function buildAccountMappingIndex(mappings: AccountMapping[]): void {
  _index = new Map(
    mappings.map((m) => [normalizeKey(m.acCode), m])
  );

  const keys = Array.from(_index.keys());
  const first20 = keys.slice(0, 20).join(', ');
  const remaining = keys.length > 20 ? ` ... (+${keys.length - 20} more)` : '';
  console.log(
    `[accountMapping] Index built with ${keys.length} real account codes.\n` +
    `[accountMapping] First 20 keys: [${first20}]${remaining}`
  );
}

function getIndex(): MappingIndex {
  if (!_index) {
    throw new Error(
      'AccountMappingService not initialised. Call buildAccountMappingIndex() first.'
    );
  }
  return _index;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Look up account mapping for an account code.
 *
 * Normalises the incoming acCode the same way the index was built, so
 * numeric-vs-string mismatches and whitespace differences are handled.
 *
 * @param acCode  Raw account code from the upload (string or numeric-as-string)
 * @returns       Matching AccountMapping, or null if not found
 */
/**
 * Returns true if the account mapping index has been built.
 */
export function isIndexReady(): boolean {
  return _index !== null;
}

// ---------------------------------------------------------------------------
// Bulk validation
// ---------------------------------------------------------------------------

/**
 * Validate a set of raw rows against the account mapping index.
 *
 * For each row, checks whether `acCode` resolves via lookupAccountMapping.
 * Also checks whether `acName` exists in any mapping entry.
 *
 * Returns deduplicated, sorted arrays of unmapped codes and names.
 * Empty arrays = all valid.
 */
/**
 * Normalise an account name for comparison.
 * Strips leading dashes/hyphens, collapses whitespace, trims, lowercases.
 */
function normalizeName(raw: string): string {
  return String(raw)
    .replace(/\u00A0/g, ' ')     // NBSP → space
    .replace(/^[-–—]+/, '')      // strip leading dashes (common in chart-of-accounts naming)
    .replace(/\s+/g, ' ')        // collapse multiple spaces
    .trim()
    .toLowerCase();
}

export function validateAgainstMappings(
  rows: { acCode: string | null; acName: string | null }[]
): { unmappedCodes: string[]; unmappedNames: string[] } {
  const idx = getIndex();

  // Build a set of all known acNames (normalised for comparison)
  const knownNames = new Set<string>();
  for (const mapping of idx.values()) {
    if (mapping.acName) knownNames.add(normalizeName(mapping.acName));
  }

  const badCodes = new Set<string>();
  const badNames = new Set<string>();

  for (const row of rows) {
    // Check acCode via existing lookup (exact + prefix fallback)
    const codeOk = row.acCode != null && String(row.acCode).trim() !== ''
      ? lookupAccountMapping(row.acCode) !== null
      : true; // null/empty code is not an unmapped-code error (Zod catches missing fields)

    if (!codeOk) badCodes.add(normalizeKey(row.acCode));

    // Check acName — if the acCode mapped successfully, skip acName check
    // (the row is identified by its code; name variants are acceptable)
    if (!codeOk && row.acName != null && String(row.acName).trim() !== '') {
      const norm = normalizeName(row.acName);
      if (!knownNames.has(norm)) badNames.add(String(row.acName).trim());
    }
  }

  return {
    unmappedCodes: Array.from(badCodes).sort(),
    unmappedNames: Array.from(badNames).sort(),
  };
}

export function lookupAccountMapping(acCode: string | null): AccountMapping | null {
  const idx = getIndex();
  const debug = _debugCount < DEBUG_LIMIT;

  // Treat null/empty as unmapped immediately
  if (acCode == null || String(acCode).trim() === '') {
    if (debug) {
      _debugCount++;
      console.log(
        `[accountMapping] [${_debugCount}/${DEBUG_LIMIT}] ` +
        `raw="${acCode}" → NOT FOUND (null or empty input)`
      );
    }
    return null;
  }

  const normalised = normalizeKey(acCode);

  // 1. Exact match on normalised key
  const exact = idx.get(normalised);
  if (exact) {
    if (debug) {
      _debugCount++;
      console.log(
        `[accountMapping] [${_debugCount}/${DEBUG_LIMIT}] ` +
        `raw="${acCode}" → normalised="${normalised}" → FOUND exact → category="${exact.category}"`
      );
    }
    return exact;
  }

  // 2. Prefix fallback – strip trailing characters up to 3 levels
  for (let len = normalised.length - 1; len >= Math.max(2, normalised.length - 3); len--) {
    const prefix = normalised.slice(0, len);
    const prefixMatch = idx.get(prefix);
    if (prefixMatch) {
      if (debug) {
        _debugCount++;
        console.log(
          `[accountMapping] [${_debugCount}/${DEBUG_LIMIT}] ` +
          `raw="${acCode}" → normalised="${normalised}" → FOUND via prefix="${prefix}" → category="${prefixMatch.category}"`
        );
      }
      return { ...prefixMatch, acCode: normalised };
    }
  }

  // 3. Not found
  if (debug) {
    _debugCount++;
    console.log(
      `[accountMapping] [${_debugCount}/${DEBUG_LIMIT}] ` +
      `raw="${acCode}" → normalised="${normalised}" → NOT FOUND`
    );
  }
  return null;
}
