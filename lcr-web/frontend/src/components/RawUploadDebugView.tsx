/**
 * RawUploadDebugView — Shows raw Excel cell values WITHOUT any transformation.
 * No date parsing, no normalization. Shows cell type, raw value, and format code.
 * Purpose: verify that I/J/K columns are being read correctly from the source file.
 */

import { useState, useRef } from 'react';
import { fetchRawCells, RawCellRow } from '../services/api';

type ViewState =
  | { status: 'idle' }
  | { status: 'processing' }
  | { status: 'done'; filename: string; sheetName: string; total: number; rows: RawCellRow[] }
  | { status: 'error'; message: string };

const COL_KEYS = [
  { key: 'A_acCode', label: 'A: acCode' },
  { key: 'B_acName', label: 'B: acName' },
  { key: 'C_refNo', label: 'C: refNo' },
  { key: 'D_cptyNo', label: 'D: cptyNo' },
  { key: 'E_cptyName', label: 'E: cptyName' },
  { key: 'F_ccy', label: 'F: ccy' },
  { key: 'G_balanceAmt', label: 'G: balAmt' },
  { key: 'H_baseCcyAmt', label: 'H: baseCcyAmt' },
  { key: 'I_contractDate', label: 'I: contractDate' },
  { key: 'J_maturityDate', label: 'J: maturityDate' },
  { key: 'K_resetDate', label: 'K: resetDate' },
];

// Columns I, J, K need special attention — show type/raw/fmt
const DATE_COLS = ['I_contractDate', 'J_maturityDate', 'K_resetDate'];

export function RawUploadDebugView() {
  const [state, setState] = useState<ViewState>({ status: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    try {
      setState({ status: 'processing' });
      const res = await fetchRawCells(file);
      if (!res.success) { setState({ status: 'error', message: 'Upload failed.' }); return; }
      setState({ status: 'done', filename: res.filename, sheetName: res.sheetName, total: res.total, rows: res.rows });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error.' });
    }
  }

  function handleReset() { setState({ status: 'idle' }); }

  return (
    <div className="verify-view">
      {state.status === 'idle' && (
        <div>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Raw Cell Debug</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              Upload an Excel file to see the raw cell values exactly as read by the parser.
              No date parsing, no normalization. Shows cell type, raw value, and format code for I/J/K.
            </p>
          </div>
          <div
            className="upload-zone"
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <input ref={inputRef} type="file" accept=".xlsx,.xls"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              style={{ display: 'none' }}
            />
            <div className="upload-zone__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" />
              </svg>
            </div>
            <p className="upload-zone__primary">Drop Excel file or click to browse</p>
            <p className="upload-zone__secondary">.xlsx or .xls — no report date needed for this view</p>
          </div>
        </div>
      )}

      {state.status === 'processing' && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="spinner" />
          <p style={{ marginTop: '1rem', color: 'var(--color-text-muted)' }}>Reading raw cells...</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="card card--error" role="alert">
          <h2 className="card__title card__title--error">Failed</h2>
          <p className="error-message">{state.message}</p>
          <button className="btn btn--primary" onClick={handleReset} style={{ marginTop: '1rem' }}>Try Again</button>
        </div>
      )}

      {state.status === 'done' && (
        <>
          <div className="card">
            <h2 className="verify-step-title" style={{ marginBottom: '0.75rem' }}>
              Raw Cell Values (no transformation)
            </h2>
            <div className="verify-meta-grid">
              <div className="verify-meta-item">
                <span className="verify-meta-label">Filename</span>
                <span className="verify-meta-value">{state.filename}</span>
              </div>
              <div className="verify-meta-item">
                <span className="verify-meta-label">Sheet</span>
                <span className="verify-meta-value">{state.sheetName}</span>
              </div>
              <div className="verify-meta-item">
                <span className="verify-meta-label">Total Rows</span>
                <span className="verify-meta-value">{state.total}</span>
              </div>
            </div>
            <p className="verify-hint" style={{ marginTop: '0.5rem' }}>
              For columns I/J/K, each cell shows: <strong>display value</strong> plus
              [type | raw | format] underneath. Compare against Excel to verify correct reading.
            </p>
          </div>

          <div className="card" style={{ padding: '0.5rem' }}>
            <div style={{ overflow: 'auto', maxHeight: '75vh' }}>
              <table className="data-table" style={{ fontSize: '0.72rem' }}>
                <thead>
                  <tr>
                    <th style={stickyTh}>Row</th>
                    {COL_KEYS.map((c) => (
                      <th key={c.key} style={{
                        ...stickyTh,
                        textAlign: DATE_COLS.includes(c.key) || c.key.includes('Amt') ? 'right' : 'left',
                        background: DATE_COLS.includes(c.key) ? '#fef3c7' : '#f1f5f9',
                      }}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="mono">{r.rowNumber}</td>
                      {COL_KEYS.map((c) => {
                        const val = r[c.key];
                        const isDateCol = DATE_COLS.includes(c.key);
                        const cellType = r[c.key + '_type'] as string | null;
                        const cellRaw = r[c.key + '_raw'];
                        const cellFmt = r[c.key + '_fmt'] as string | null;

                        if (val == null) {
                          return (
                            <td key={c.key} style={{ color: 'var(--color-text-muted)' }}>
                              {isDateCol ? '(empty)' : ''}
                            </td>
                          );
                        }

                        if (isDateCol) {
                          return (
                            <td key={c.key} className="mono" style={{ background: '#fffbeb' }}>
                              <div style={{ fontWeight: 600 }}>{String(val)}</div>
                              <div style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>
                                t={cellType} | raw={String(cellRaw)} | z={cellFmt || '(none)'}
                              </div>
                            </td>
                          );
                        }

                        return (
                          <td key={c.key} className={c.key.includes('Amt') ? 'text-right mono' : ''}>
                            {String(val)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <button className="btn btn--ghost" onClick={handleReset}>Upload Different File</button>
          </div>
        </>
      )}
    </div>
  );
}

const stickyTh: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  background: '#f1f5f9',
};
