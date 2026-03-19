/**
 * Row validation service.
 *
 * Uses Zod for schema definition and produces a list of RowValidationErrors
 * that the API returns alongside the parsed rows.
 *
 * Designed to be extended in Phase 2 without touching the parser.
 */

import { z } from 'zod';
import { LcrRawRow, RowValidationError } from '../types/lcr';

// ---------------------------------------------------------------------------
// ISO date string validator helper
// ---------------------------------------------------------------------------
const isoDateOrNull = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
  .nullable();

// ---------------------------------------------------------------------------
// Row schema
// ---------------------------------------------------------------------------
const lcrRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  acCode: z.string().min(1, 'acCode is required').nullable(),
  acName: z.string().nullable(),
  refNo: z.string().nullable(),
  counterpartyNo: z.string().nullable(),
  counterpartyName: z.string().nullable(),
  ccy: z
    .string()
    .length(3, 'Currency must be a 3-letter ISO code')
    .nullable(),
  balanceAmt: z.number().nullable(),
  baseCcyAmt: z.number().nullable(),
  approvalContractDate: isoDateOrNull,
  maturityDate: isoDateOrNull,
  nextInterestResetDate: isoDateOrNull,
});

// ---------------------------------------------------------------------------
// Validation function
// ---------------------------------------------------------------------------

export interface ValidationResult {
  validRows: LcrRawRow[];
  invalidRows: LcrRawRow[];
  errors: RowValidationError[];
}

/**
 * Validates an array of parsed rows and returns segregated valid/invalid rows
 * plus a flat list of field-level errors.
 */
export function validateRows(rows: LcrRawRow[]): ValidationResult {
  const validRows: LcrRawRow[] = [];
  const invalidRows: LcrRawRow[] = [];
  const errors: RowValidationError[] = [];

  for (const row of rows) {
    const result = lcrRowSchema.safeParse(row);

    if (result.success) {
      validRows.push(row);
    } else {
      invalidRows.push(row);
      for (const issue of result.error.issues) {
        errors.push({
          rowNumber: row.rowNumber,
          field: issue.path.join('.') || 'row',
          message: issue.message,
        });
      }
    }
  }

  return { validRows, invalidRows, errors };
}
