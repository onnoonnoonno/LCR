/**
 * BsRe33DebugView — Full BS_RE33-equivalent dataset for row-by-row comparison with Excel.
 * Read-only debug view. No aggregation, no filtering.
 */

import { useState } from 'react';
import { UploadWithDate } from './UploadWithDate';
import {
  uploadRaw,
  fetchBsRe33,
  UploadRawResponse,
  BsRe33Response,
  BsRe33Row,
} from '../services/api';

type ViewState =
  | { status: 'idle' }
  | { status: 'processing'; message: string }
  | { status: 'done'; meta: UploadRawResponse; data: BsRe33Response }
  | { status: 'error'; message: string };

function fmt(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function BsRe33DebugView() {
  const [state, setState] = useState<ViewState>({ status: 'idle' });

  async function handleFile(file: File, reportDate: string) {
    try {
      setState({ status: 'processing', message: 'Uploading...' });
      const meta = await uploadRaw(file, reportDate);
      if (!meta.success) { setState({ status: 'error', message: 'Upload failed.' }); return; }
      setState({ status: 'processing', message: 'Loading BS_RE33 data...' });
      const data = await fetchBsRe33(meta.runId, 1, 9999);
      setState({ status: 'done', meta, data });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error.' });
    }
  }

  async function loadPage(runId: string, p: number) {
    if (state.status !== 'done') return;
    const data = await fetchBsRe33(runId, p, 100);
    setState({ ...state, data });
  }

  function handleReset() { setState({ status: 'idle' }); }

  return (
    <div className="verify-view">
      {state.status === 'idle' && <UploadWithDate onUpload={handleFile} isLoading={false} />}

      {state.status === 'processing' && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <div className="spinner" />
          <p style={{ marginTop: '1rem', color: 'var(--color-text-muted)' }}>{state.message}</p>
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
          {/* Header */}
          <div className="card">
            <div className="verify-meta-grid">
              <div className="verify-meta-item">
                <span className="verify-meta-label">Report Date (N4)</span>
                <span className="verify-meta-value verify-meta-value--lg">{state.data.reportDate}</span>
              </div>
              <div className="verify-meta-item">
                <span className="verify-meta-label">Source File</span>
                <span className="verify-meta-value">{state.meta.sourceFilename}</span>
              </div>
              <div className="verify-meta-item">
                <span className="verify-meta-label">Total Rows</span>
                <span className="verify-meta-value">{state.data.total}</span>
              </div>
              <div className="verify-meta-item">
                <span className="verify-meta-label">Page</span>
                <span className="verify-meta-value">{state.data.page} / {state.data.totalPages}</span>
              </div>
            </div>
            {/* Bucket ranges */}
            <p className="verify-hint" style={{ marginTop: '0.5rem' }}>
              Bucket ranges: {state.data.bucketRanges.map(b => b.name + '=[' + b.start + '..' + b.end + ']').join('  ')}
            </p>
          </div>

          {/* Data table */}
          <div className="card" style={{ padding: '0.5rem' }}>
            <div style={{ overflow: 'auto', maxHeight: '80vh' }}>
              <table className="data-table" style={{ fontSize: '0.7rem' }}>
                <thead>
                  <tr>
                    <th style={stickyTh}>Row</th>
                    <th style={stickyTh}>acCode</th>
                    <th style={stickyTh}>acName</th>
                    <th style={stickyTh}>refNo</th>
                    <th style={stickyTh}>cptyNo</th>
                    <th style={stickyTh}>L</th>
                    <th style={stickyTh}>M</th>
                    <th style={stickyTh}>N</th>
                    <th style={stickyTh}>O</th>
                    <th style={stickyTh}>P</th>
                    <th style={{ ...stickyTh, textAlign: 'right' }}>H</th>
                    <th style={{ ...stickyTh, textAlign: 'right' }}>Q</th>
                    <th style={{ ...stickyTh, textAlign: 'right' }}>R</th>
                    <th style={stickyTh}>S</th>
                    <th style={{ ...stickyTh, textAlign: 'right' }}>T</th>
                    <th style={{ ...stickyTh, textAlign: 'right' }}>U</th>
                    <th style={stickyTh}>V</th>
                    <th style={stickyTh}>W</th>
                    {state.data.bucketNames.map(bn => (
                      <th key={bn} style={{ ...stickyTh, textAlign: 'right' }}>{bn}</th>
                    ))}
                    <th style={stickyTh}>AH</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.rows.map((r: BsRe33Row) => (
                    <tr key={r.row} className={!r.L ? 'tr--unmapped' : ''}>
                      <td className="mono">{r.row}</td>
                      <td className="mono">{r.acCode}</td>
                      <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.acName}</td>
                      <td className="mono">{r.refNo}</td>
                      <td className="mono">{r.cptyNo}</td>
                      <td>{r.L}</td>
                      <td>{r.M}</td>
                      <td>{r.N}</td>
                      <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.O}</td>
                      <td className="mono" style={{ fontSize: '0.6rem', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.P}</td>
                      <td className="text-right mono">{fmt(r.H)}</td>
                      <td className="text-right mono" style={{ color: r.Q !== r.H ? 'var(--color-warning)' : undefined }}>{fmt(r.Q)}</td>
                      <td className="text-right mono">{r.R !== null ? r.R : ''}</td>
                      <td className="mono" style={{ color: r.S === 'Tomorrow' ? 'var(--color-primary)' : undefined }}>{r.S}</td>
                      <td className="text-right mono">{r.T !== null ? r.T : ''}</td>
                      <td className="text-right mono">{fmt(r.U)}</td>
                      <td className="mono" style={{ color: r.V === 'Tomorrow' ? 'var(--color-primary)' : undefined }}>{r.V}</td>
                      <td>{r.W}</td>
                      {r.buckets.map((b: number, i: number) => (
                        <td key={i} className="text-right mono" style={{
                          color: b !== 0 ? 'var(--color-primary)' : 'var(--color-text-muted)',
                          fontWeight: b !== 0 ? 600 : undefined,
                        }}>
                          {b !== 0 ? fmt(b) : ''}
                        </td>
                      ))}
                      <td style={{
                        fontWeight: 600,
                        color: r.AH ? 'var(--color-success)' : 'var(--color-error)',
                      }}>
                        {r.AH ? 'T' : 'F'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {state.data.totalPages > 1 && (
              <div className="pagination" style={{ marginTop: '0.5rem' }}>
                <button className="btn btn--sm btn--ghost" disabled={state.data.page <= 1}
                  onClick={() => loadPage(state.data.runId, state.data.page - 1)}>Prev</button>
                <span className="pagination__info">
                  Page {state.data.page} / {state.data.totalPages} ({state.data.total} rows)
                </span>
                <button className="btn btn--sm btn--ghost" disabled={state.data.page >= state.data.totalPages}
                  onClick={() => loadPage(state.data.runId, state.data.page + 1)}>Next</button>
              </div>
            )}
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
