/**
 * BS_RE33 Calculation Engine – Orchestrator
 *
 * This is the single entry point for Phase 2 calculations.
 * It:
 *   1. Loads and indexes all reference data (once per process)
 *   2. Runs each raw row through the row calculator
 *   3. Aggregates results into a summary
 *   4. Returns a fully populated BS_RE33Output
 *
 * To extend in Phase 3:
 *   - Replace loadReferenceData() with a DB-backed loader
 *   - Add currency conversion before step 2
 *   - Add multi-scenario stress testing by parameterising the assumption rates
 */

import { randomUUID } from 'crypto';
import { BS_RE33Input, BS_RE33Output, CalculationError } from '../types/bs-re33';
import { loadReferenceData } from '../reference/referenceDataLoader';
import { buildAccountMappingIndex, resetLookupDebugLog } from '../reference/accountMappingService';
import { buildCustomerTypeIndex } from '../reference/customerTypeService';
import { buildAssumptionIndex } from '../reference/assumptionService';
import { buildMaturityAdjustmentIndex } from '../reference/maturityAdjustmentService';
import { calculateRow, resetRowDebugLog } from './rowCalculator';
import { aggregateSummary } from './summaryAggregator';

// ---------------------------------------------------------------------------
// Reference data initialisation (lazy, cached per process)
// ---------------------------------------------------------------------------

let _refInitialised = false;

function ensureReferenceDataReady(forceReload = false): void {
  if (_refInitialised && !forceReload) return;

  const refData = loadReferenceData(forceReload);

  buildAccountMappingIndex(refData.accountMappings);
  buildCustomerTypeIndex(refData.customerTypes);
  buildAssumptionIndex(refData.assumptions);
  buildMaturityAdjustmentIndex(refData.maturityAdjustments);

  _refInitialised = true;
  console.log('[calculationEngine] Reference data indexes built.');
}

// ---------------------------------------------------------------------------
// Main engine entry point
// ---------------------------------------------------------------------------

/**
 * Run the full BS_RE33 calculation pipeline.
 *
 * @param input  Report date + raw rows (from Excel upload)
 * @returns      Fully calculated output including rows, summary, and errors
 */
export function runBS_RE33(input: BS_RE33Input): BS_RE33Output {
  const { reportDate, rows } = input;
  const calculationId = randomUUID();
  const calculatedAt  = new Date().toISOString();

  // Ensure reference data is loaded and indexed
  ensureReferenceDataReady();

  // Reset debug log counters so first 20 entries of each run are always logged
  resetLookupDebugLog();
  resetRowDebugLog();

  // -------------------------------------------------------------------------
  // Row-level calculation
  // -------------------------------------------------------------------------
  const calculationErrors: CalculationError[] = [];
  const calculatedRows = rows
    .map((raw) => {
      try {
        return calculateRow(raw, reportDate);
      } catch (err) {
        calculationErrors.push({
          rowNumber: raw.rowNumber,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // -------------------------------------------------------------------------
  // Summary aggregation
  // -------------------------------------------------------------------------
  const summary = aggregateSummary(calculatedRows, reportDate);

  return {
    calculationId,
    reportDate,
    calculatedAt,
    rowCount: rows.length,
    rows: calculatedRows,
    summary,
    calculationErrors,
  };
}

// ---------------------------------------------------------------------------
// Hot-reload helper (dev mode)
// ---------------------------------------------------------------------------

/**
 * Force a reload of reference data and rebuild indexes.
 * Useful in development when JSON files are edited without restarting.
 */
export function reloadReferenceData(): void {
  _refInitialised = false;
  ensureReferenceDataReady(true);
}
