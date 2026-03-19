/**
 * In-Memory Calculation Store
 *
 * Stores BS_RE33Output results keyed by calculationId.
 * Results expire after TTL_HOURS to prevent unbounded memory growth.
 *
 * Phase 3 upgrade path:
 *   Replace this with a Redis store or DB-backed cache.
 *   The interface (get / set) stays the same.
 */

import { BS_RE33Output } from '../types/bs-re33';

const TTL_HOURS = 4;
const TTL_MS    = TTL_HOURS * 60 * 60 * 1000;
const MAX_ENTRIES = 50; // evict oldest when limit reached

interface StoreEntry {
  result: BS_RE33Output;
  createdAt: number;
}

const store = new Map<string, StoreEntry>();

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

function evictExpired(): void {
  const now = Date.now();
  for (const [id, entry] of store.entries()) {
    if (now - entry.createdAt > TTL_MS) store.delete(id);
  }
}

function evictOldestIfNeeded(): void {
  if (store.size < MAX_ENTRIES) return;
  // Delete the oldest entry by insertion order (Map preserves insertion order)
  const oldest = store.keys().next().value;
  if (oldest) store.delete(oldest);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Store a calculation result.
 *
 * @param result  The BS_RE33Output to store
 * @returns       The calculationId for retrieval
 */
export function storeCalculation(result: BS_RE33Output): string {
  evictExpired();
  evictOldestIfNeeded();
  store.set(result.calculationId, { result, createdAt: Date.now() });
  return result.calculationId;
}

/**
 * Retrieve a previously stored calculation by ID.
 *
 * @returns BS_RE33Output, or null if not found / expired
 */
export function getCalculation(calculationId: string): BS_RE33Output | null {
  evictExpired();
  const entry = store.get(calculationId);
  if (!entry) return null;
  return entry.result;
}

/**
 * List all active calculation IDs and their metadata.
 * Useful for debugging and admin endpoints.
 */
export function listCalculations(): Array<{ calculationId: string; reportDate: string; calculatedAt: string; rowCount: number }> {
  evictExpired();
  return Array.from(store.entries()).map(([id, entry]) => ({
    calculationId: id,
    reportDate:    entry.result.reportDate,
    calculatedAt:  entry.result.calculatedAt,
    rowCount:      entry.result.rowCount,
  }));
}
