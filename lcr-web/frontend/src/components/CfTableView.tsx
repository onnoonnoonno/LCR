/**
 * CfTableView — 30 days CF Table(ALL) equivalent.
 *
 * Upload file → compute → display the LCR summary (D97-D119)
 * plus per-pKey outflow/inflow breakdown.
 */

import { useState } from 'react';
import { UploadWithDate } from './UploadWithDate';
import {
  uploadRaw,
  fetchCfTable,
  UploadRawResponse,
  CfTableResponse,
} from '../services/api';

type ViewState =
  | { status: 'idle' }
  | { status: 'processing'; message: string }
  | { status: 'done'; meta: UploadRawResponse; cf: CfTableResponse }
  | { status: 'error'; message: string };

function fmt(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function CfTableView() {
  const [state, setState] = useState<ViewState>({ status: 'idle' });

  async function handleFile(file: File, reportDate: string) {
    try {
      setState({ status: 'processing', message: 'Uploading file...' });
      const meta = await uploadRaw(file, reportDate);
      if (!meta.success) { setState({ status: 'error', message: 'Upload failed.' }); return; }

      setState({ status: 'processing', message: 'Computing 30-day CF Table...' });
      const cf = await fetchCfTable(meta.runId);

      setState({ status: 'done', meta, cf });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error.' });
    }
  }

  function handleReset() { setState({ status: 'idle' }); }

  return (
    <div className="verify-view">
      {state.status === 'idle' && (
        <UploadWithDate onUpload={handleFile} isLoading={false} />
      )}

      {state.status === 'processing' && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <div className="spinner" />
          <p style={{ marginTop: '1rem', color: 'var(--color-text-muted)' }}>{state.message}</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="card card--error" role="alert">
          <h2 className="card__title card__title--error">Processing Failed</h2>
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
                <span className="verify-meta-label">Report Date</span>
                <span className="verify-meta-value verify-meta-value--lg">{state.meta.reportDate}</span>
              </div>
              <div className="verify-meta-item">
                <span className="verify-meta-label">Source File</span>
                <span className="verify-meta-value">{state.meta.sourceFilename}</span>
              </div>
              <div className="verify-meta-item">
                <span className="verify-meta-label">30-Day Window End</span>
                <span className="verify-meta-value">{state.cf.day30End}</span>
              </div>
              <div className="verify-meta-item">
                <span className="verify-meta-label">Rows</span>
                <span className="verify-meta-value">{state.meta.rawRowCount.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* LCR Summary (D97-D119) */}
          <div className="card">
            <h2 className="verify-step-title" style={{ marginBottom: '0.75rem' }}>
              30 Days CF Table (ALL) — LCR Summary
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Description</th>
                    <th className="text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="mono">D97</td>
                    <td>Outflow (base)</td>
                    <td className="text-right mono">{fmt(state.cf.baseOutflow)}</td>
                  </tr>
                  <tr>
                    <td className="mono">D99</td>
                    <td>Buybacks of domestic debt securities (5% or 10%)</td>
                    <td className="text-right mono">{fmt(state.cf.buybackOutflow)}</td>
                  </tr>
                  <tr>
                    <td className="mono">D101</td>
                    <td>Other Outflow</td>
                    <td className="text-right mono">{fmt(state.cf.otherOutflow)}</td>
                  </tr>
                  <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                    <td className="mono">D103</td>
                    <td style={{ fontWeight: 700 }}>Total Outflow</td>
                    <td className="text-right mono" style={{ fontWeight: 700 }}>{fmt(state.cf.grossOutflow)}</td>
                  </tr>
                  <tr><td colSpan={3} style={{ height: '0.5rem' }} /></tr>
                  <tr>
                    <td className="mono">D106</td>
                    <td>Inflow</td>
                    <td className="text-right mono">{fmt(state.cf.baseInflow)}</td>
                  </tr>
                  <tr>
                    <td className="mono">D108</td>
                    <td>Cash Inflows from committed funding facility (D103 * 20%)</td>
                    <td className="text-right mono">{fmt(state.cf.hoFacility)}</td>
                  </tr>
                  <tr>
                    <td className="mono">D110</td>
                    <td>Sum of Inflow</td>
                    <td className="text-right mono">{fmt(state.cf.sumInflow)}</td>
                  </tr>
                  <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                    <td className="mono">D112</td>
                    <td style={{ fontWeight: 700 }}>Total Inflow (capped at 75% of Total Outflow)</td>
                    <td className="text-right mono" style={{ fontWeight: 700 }}>{fmt(state.cf.cappedInflow)}</td>
                  </tr>
                  <tr><td colSpan={3} style={{ height: '0.5rem' }} /></tr>
                  <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                    <td className="mono">D115</td>
                    <td style={{ fontWeight: 700 }}>Net Cash Outflows</td>
                    <td className="text-right mono" style={{ fontWeight: 700 }}>{fmt(state.cf.netCashOutflow)}</td>
                  </tr>
                  <tr>
                    <td className="mono">D117</td>
                    <td style={{ fontWeight: 700 }}>HQLA</td>
                    <td className="text-right mono" style={{ fontWeight: 700 }}>{fmt(state.cf.hqla)}</td>
                  </tr>
                  <tr style={{ borderTop: '3px solid var(--color-primary)' }}>
                    <td className="mono">D119</td>
                    <td style={{ fontWeight: 800, fontSize: '1.1rem' }}>LCR (All Currency)</td>
                    <td className="text-right mono" style={{
                      fontWeight: 800, fontSize: '1.1rem',
                      color: state.cf.lcr !== null && state.cf.lcr >= 1 ? 'var(--color-success)' : 'var(--color-error)',
                    }}>
                      {state.cf.lcr !== null ? (state.cf.lcr * 100).toFixed(2) + '%' : 'N/A'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Outflow Detail */}
          <div className="card">
            <h2 className="verify-step-title" style={{ marginBottom: '0.75rem' }}>Outflow Detail (by P-Key)</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>P-Key</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Weighted Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {state.cf.outflowRows.map((r) => (
                    <tr key={r.pKey}>
                      <td className="mono" style={{ fontSize: '0.8rem' }}>{r.pKey}</td>
                      <td className="text-right mono">{r.rate}</td>
                      <td className="text-right mono">{fmt(r.amount)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                    <td style={{ fontWeight: 700 }}>Total</td>
                    <td></td>
                    <td className="text-right mono" style={{ fontWeight: 700 }}>
                      {fmt(state.cf.outflowRows.reduce((s, r) => s + r.amount, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Inflow Detail */}
          <div className="card">
            <h2 className="verify-step-title" style={{ marginBottom: '0.75rem' }}>Inflow Detail (by P-Key)</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>P-Key</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Weighted Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {state.cf.inflowRows.map((r) => (
                    <tr key={r.pKey}>
                      <td className="mono" style={{ fontSize: '0.8rem' }}>{r.pKey}</td>
                      <td className="text-right mono">{r.rate}</td>
                      <td className="text-right mono">{fmt(r.amount)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                    <td style={{ fontWeight: 700 }}>Total</td>
                    <td></td>
                    <td className="text-right mono" style={{ fontWeight: 700 }}>
                      {fmt(state.cf.inflowRows.reduce((s, r) => s + r.amount, 0))}
                    </td>
                  </tr>
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
