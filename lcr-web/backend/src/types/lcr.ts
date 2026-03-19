/**
 * Core domain types for the LCR (Liquidity Coverage Ratio) workflow.
 *
 * Phase 1: raw row shape + upload response.
 * Phase 2: extend with BS_RE33 calculation engine inputs/outputs.
 */

// ---------------------------------------------------------------------------
// Raw row – direct mapping from Excel columns A:K
// ---------------------------------------------------------------------------

export interface LcrRawRow {
  /** Excel row number (1-based, header = 1, data starts at 2) */
  rowNumber: number;

  /** Column A */
  acCode: string | null;
  /** Column B */
  acName: string | null;
  /** Column C */
  refNo: string | null;
  /** Column D */
  counterpartyNo: string | null;
  /** Column E */
  counterpartyName: string | null;
  /** Column F */
  ccy: string | null;
  /** Column G */
  balanceAmt: number | null;
  /** Column H */
  baseCcyAmt: number | null;
  /** Column I – stored as ISO date string YYYY-MM-DD */
  approvalContractDate: string | null;
  /** Column J – stored as ISO date string YYYY-MM-DD */
  maturityDate: string | null;
  /** Column K – stored as ISO date string YYYY-MM-DD */
  nextInterestResetDate: string | null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface RowValidationError {
  rowNumber: number;
  field: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Upload API response
// ---------------------------------------------------------------------------

export interface UploadSuccessResponse {
  success: true;
  reportDate: string;        // YYYY-MM-DD extracted from filename
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: LcrRawRow[];
  validationErrors: RowValidationError[];
}

export interface UploadErrorResponse {
  success: false;
  error: string;
}

export type UploadResponse = UploadSuccessResponse | UploadErrorResponse;

// ---------------------------------------------------------------------------
// Phase 2 placeholders – calculation engine types
// (kept here so the module boundary is clear; implement in Phase 2)
// ---------------------------------------------------------------------------

/**
 * Input to the BS_RE33 calculation engine.
 * Will be derived from validated LcrRawRow[].
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface BS_RE33Input {
  reportDate: string;
  rows: LcrRawRow[];
  // TODO Phase 2: add bucket definitions, HQA thresholds, etc.
}

/**
 * Output from the BS_RE33 calculation engine.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface BS_RE33Output {
  // TODO Phase 2: LCR ratio, HQLA breakdown, net cash outflows, etc.
}
