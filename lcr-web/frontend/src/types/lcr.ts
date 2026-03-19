/**
 * Frontend-side type definitions mirroring the backend API contract.
 * Update these whenever the API response shape changes.
 */

export interface LcrRawRow {
  rowNumber: number;
  acCode: string | null;
  acName: string | null;
  refNo: string | null;
  counterpartyNo: string | null;
  counterpartyName: string | null;
  ccy: string | null;
  balanceAmt: number | null;
  baseCcyAmt: number | null;
  approvalContractDate: string | null;
  maturityDate: string | null;
  nextInterestResetDate: string | null;
}

export interface RowValidationError {
  rowNumber: number;
  field: string;
  message: string;
}

export interface UploadSuccessResponse {
  success: true;
  reportDate: string;
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
