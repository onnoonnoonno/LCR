/**
 * Excel parsing service.
 *
 * Responsibilities:
 *  1. Read the first sheet of an xlsx buffer.
 *  2. Map columns A:K to strongly-typed LcrRawRow objects.
 *  3. Extract the report date from the filename.
 *
 * This module is intentionally pure (no side effects, no HTTP) so it
 * can be unit-tested independently and reused by the Phase 2 engine.
 */

import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { LcrRawRow } from '../types/lcr';

dayjs.extend(customParseFormat);

// ---------------------------------------------------------------------------
// Filename date extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the report date (YYYY-MM-DD) from the uploaded filename.
 *
 * Supported formats (date may appear anywhere in the filename):
 *   2024-03-15T143022.000.xlsx
 *   default - 2026-02-05T092024.784.xlsx
 *   any_prefix_YYYY-MM-DDTHHMMSS.mmm.xlsx
 *
 * Throws if no valid date can be found (no silent fallback to today).
 */
export function extractReportDate(filename: string): string {
  // Removed the ^ anchor so the date is found anywhere in the filename.
  const match = filename.match(/(\d{4}-\d{2}-\d{2})T/);

  console.log(`[excelParser] filename="${filename}" | dateMatch=${match ? match[1] : 'NOT FOUND'}`);

  if (match) {
    const parsed = dayjs(match[1]);
    if (parsed.isValid()) {
      const reportDate = parsed.format('YYYY-MM-DD');
      console.log(`[excelParser] reportDate extracted → ${reportDate}`);
      return reportDate;
    }
  }

  throw new Error(
    `Could not extract a valid report date from filename "${filename}". ` +
    `Expected a date segment in the format YYYY-MM-DDTHHMMSS anywhere in the filename ` +
    `(e.g. "default - 2026-02-05T092024.784.xlsx").`
  );
}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

function cellToString(cell: XLSX.CellObject | undefined): string | null {
  if (cell == null || cell.v == null) return null;
  return String(cell.v).trim() || null;
}

function cellToNumber(cell: XLSX.CellObject | undefined): number | null {
  if (cell == null || cell.v == null) return null;
  const n = Number(cell.v);
  return isNaN(n) ? null : n;
}

/**
 * Converts an Excel date cell to an ISO date string (YYYY-MM-DD).
 *
 * Excel stores dates as serial numbers. The xlsx library exposes them via
 * cell.t === 'n' with a date format code, or can return a JS Date via
 * cell.t === 'd'. We handle both cases.
 */
function cellToDateString(cell: XLSX.CellObject | undefined): string | null {
  if (cell == null || cell.v == null) return null;

  // xlsx can decode dates as JS Date objects when cellDates: true
  if (cell.t === 'd' && cell.v instanceof Date) {
    const d = dayjs(cell.v);
    return d.isValid() ? d.format('YYYY-MM-DD') : null;
  }

  // Numeric serial date
  if (cell.t === 'n') {
    const date = XLSX.SSF.parse_date_code(cell.v as number);
    if (date) {
      const d = dayjs(
        new Date(date.y, date.m - 1, date.d)
      );
      return d.isValid() ? d.format('YYYY-MM-DD') : null;
    }
  }

  // String representation – try to parse with dayjs.
  // Australian-format dates (dd/mm/yyyy) are common in LCR workbooks.
  // dayjs default parsing treats M/D/YYYY, which misinterprets dd/mm/yyyy
  // (e.g. "09/03/2026" becomes Sep 3 instead of Mar 9). Try DD/MM/YYYY first.
  if (typeof cell.v === 'string') {
    const trimmed = cell.v.trim();
    if (!trimmed) return null;

    // Try DD/MM/YYYY (Australian format) first
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
      const d = dayjs(trimmed, 'DD/MM/YYYY', true);
      if (d.isValid()) return d.format('YYYY-MM-DD');
    }

    // Fallback: try ISO or other standard formats
    const d = dayjs(trimmed);
    return d.isValid() ? d.format('YYYY-MM-DD') : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Column index constants (0-based)
// ---------------------------------------------------------------------------
const COL = {
  acCode: 0,              // A
  acName: 1,              // B
  refNo: 2,               // C
  counterpartyNo: 3,      // D
  counterpartyName: 4,    // E
  ccy: 5,                 // F
  balanceAmt: 6,          // G
  baseCcyAmt: 7,          // H
  approvalContractDate: 8, // I
  maturityDate: 9,         // J
  nextInterestResetDate: 10, // K
} as const;

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export interface ParseResult {
  rows: LcrRawRow[];
  /** Total data rows read (Row 2 onward), including blanks */
  totalDataRows: number;
}

/**
 * Parses an xlsx buffer and returns structured rows.
 *
 * @param buffer  Raw Excel file bytes
 * @returns       ParseResult with mapped rows
 */
export function parseExcelBuffer(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,   // decode date serials to JS Date
    cellNF: true,      // preserve number formats (useful for dates)
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('The uploaded Excel file contains no sheets.');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:K1');

  // Row 0 = header (index 0 in 0-based), data starts at row index 1
  const rows: LcrRawRow[] = [];

  for (let r = 1; r <= range.e.r; r++) {
    // Stop early if all tracked columns in this row are empty
    const hasAnyValue = Object.values(COL).some((c) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      return sheet[addr] != null && sheet[addr].v != null;
    });

    if (!hasAnyValue) continue;

    const get = (c: number): XLSX.CellObject | undefined =>
      sheet[XLSX.utils.encode_cell({ r, c })];

    rows.push({
      rowNumber: r + 1, // 1-based, header = 1
      acCode: cellToString(get(COL.acCode)),
      acName: cellToString(get(COL.acName)),
      refNo: cellToString(get(COL.refNo)),
      counterpartyNo: cellToString(get(COL.counterpartyNo)),
      counterpartyName: cellToString(get(COL.counterpartyName)),
      ccy: cellToString(get(COL.ccy)),
      balanceAmt: cellToNumber(get(COL.balanceAmt)),
      baseCcyAmt: cellToNumber(get(COL.baseCcyAmt)),
      approvalContractDate: cellToDateString(get(COL.approvalContractDate)),
      maturityDate: cellToDateString(get(COL.maturityDate)),
      nextInterestResetDate: cellToDateString(get(COL.nextInterestResetDate)),
    });
  }

  return { rows, totalDataRows: rows.length };
}

// ---------------------------------------------------------------------------
// IRRBB extraction
// ---------------------------------------------------------------------------

export interface IrrbbTableRow {
  label: string;
  value: number | null;
  isPercent: boolean;
}

export interface IrrbbData {
  ratio: number | null;
  table: IrrbbTableRow[];
}

/**
 * Reads the Summary_IRRBB sheet from an xlsx buffer.
 * Returns null if the sheet is not found.
 *
 * Cells read:
 *   O26:P30  — label (O) and value (P) for the 5-row summary table
 *   P30      — 12M Interest Rate Sensitive Gap Ratio (used as the indicator value)
 *
 * P26–P29 are numeric; P30 is a ratio (percentage).
 */
export function extractIrrbbData(buffer: Buffer): IrrbbData | null {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellNF: true });
  const ws = workbook.Sheets['Summary_IRRBB'];
  if (!ws) return null;

  const table: IrrbbTableRow[] = [];
  for (let row = 26; row <= 30; row++) {
    const oCell = ws[`O${row}`];
    const pCell = ws[`P${row}`];
    const label = oCell?.v != null ? String(oCell.v) : `Row ${row}`;
    const value = pCell?.v != null && typeof pCell.v === 'number' ? pCell.v : null;
    table.push({ label, value, isPercent: row === 30 });
  }

  const ratio = table[4]?.value ?? null; // P30
  return { ratio, table };
}
