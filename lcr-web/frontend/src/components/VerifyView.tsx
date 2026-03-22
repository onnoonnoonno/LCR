/**
 * VerifyView — Main report display.
 *
 * Three modes:
 *   1. Auto-load: on mount, fetches the latest available run
 *   2. External runId: when a runId prop is passed (e.g. from History)
 *   3. Upload: user uploads a new file → stores raw_rows → runs summary
 *
 * Upload section remains visible even after results are displayed.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { UploadWithDate } from './UploadWithDate';
import { ExpandableCard } from './ExpandableCard';
import {
  uploadRaw,
  fetchGapForecast,
  fetchLmgSummary,
  fetchLatestRun,
  ForecastResponse,
  LmgSummaryResponse,
} from '../services/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunMeta {
  runId: string;
  reportDate: string;
  sourceFilename: string;
  rawRowCount: number;
  uploadedAt?: string;
}

type ViewState =
  | { status: 'loading'; message: string }
  | { status: 'empty' }
  | { status: 'processing'; message: string }
  | { status: 'done'; meta: RunMeta; lmg: LmgSummaryResponse; fc7d: ForecastResponse; fc1m: ForecastResponse; fc3m: ForecastResponse }
  | { status: 'error'; message: string };

interface VerifyViewProps {
  /** When set, load this specific run instead of the latest. */
  externalRunId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPct(v: number | null): string {
  if (v === null) return 'N/A';
  return (v * 100).toFixed(2) + '%';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VerifyView({ externalRunId }: VerifyViewProps) {
  const [state, setState] = useState<ViewState>({ status: 'loading', message: 'Loading latest report...' });
  const [showUpload, setShowUpload] = useState(false);
  const loadedRunRef = useRef<string | null>(null);

  // Load summary data for a given runId
  const loadRun = useCallback(async (meta: RunMeta) => {
    try {
      setState({ status: 'processing', message: 'Running summary pipeline...' });

      const [lmg, fc7d, fc1m, fc3m] = await Promise.all([
        fetchLmgSummary(meta.runId),
        fetchGapForecast(meta.runId, '7day'),
        fetchGapForecast(meta.runId, '1month'),
        fetchGapForecast(meta.runId, '3month'),
      ]);

      loadedRunRef.current = meta.runId;
      setState({ status: 'done', meta, lmg, fc7d, fc1m, fc3m });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load report.' });
    }
  }, []);

  // Auto-load latest run on mount (or when externalRunId changes)
  useEffect(() => {
    async function init() {
      try {
        if (externalRunId) {
          // Load specific run from History
          setState({ status: 'loading', message: 'Loading selected report...' });
          await loadRun({
            runId: externalRunId,
            reportDate: '', // will be filled from LMG response
            sourceFilename: '',
            rawRowCount: 0,
          });
          return;
        }

        // Auto-load latest
        setState({ status: 'loading', message: 'Loading latest report...' });
        const latest = await fetchLatestRun();
        if (!latest.success || !latest.found || !latest.runId) {
          setState({ status: 'empty' });
          setShowUpload(true);
          return;
        }

        await loadRun({
          runId: latest.runId,
          reportDate: latest.reportDate ?? '',
          sourceFilename: latest.sourceFilename ?? '',
          rawRowCount: latest.rawRowCount ?? 0,
          uploadedAt: latest.uploadedAt,
        });
      } catch {
        setState({ status: 'empty' });
        setShowUpload(true);
      }
    }
    init();
  }, [externalRunId, loadRun]);

  // Handle new file upload
  async function handleFile(file: File, reportDate: string) {
    try {
      setState({ status: 'processing', message: 'Uploading file...' });
      setShowUpload(false);

      const res = await uploadRaw(file, reportDate);
      if (!res.success) {
        setState({ status: 'error', message: 'Upload failed.' });
        return;
      }

      await loadRun({
        runId: res.runId,
        reportDate: res.reportDate,
        sourceFilename: res.sourceFilename,
        rawRowCount: res.rawRowCount,
      });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error.' });
    }
  }

  return (
    <div className="verify-view">
      {/* Loading */}
      {state.status === 'loading' && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <div className="spinner" />
          <p style={{ marginTop: '1rem', color: 'var(--color-text-muted)' }}>{state.message}</p>
        </div>
      )}

      {/* No reports yet */}
      {state.status === 'empty' && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
            No reports found. Upload a file to get started.
          </p>
          <UploadWithDate onUpload={handleFile} isLoading={false} />
        </div>
      )}

      {/* Processing */}
      {state.status === 'processing' && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <div className="spinner" />
          <p style={{ marginTop: '1rem', color: 'var(--color-text-muted)' }}>{state.message}</p>
        </div>
      )}

      {/* Error */}
      {state.status === 'error' && (
        <div className="card card--error" role="alert">
          <h2 className="card__title card__title--error">Error</h2>
          <p className="error-message">{state.message}</p>
          <button className="btn btn--primary" onClick={() => { setState({ status: 'empty' }); setShowUpload(true); }} style={{ marginTop: '1rem' }}>
            Try Again
          </button>
        </div>
      )}

      {/* Results */}
      {state.status === 'done' && (
        <>
          {/* Upload new file — at the top for easy access */}
          <div className="card" style={{ padding: '1rem 1.25rem' }}>
            {!showUpload ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Report Date
                    </span>
                    <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1a56db' }}>
                      {state.lmg.reportDate || state.meta.reportDate}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    {state.meta.sourceFilename || ''}
                  </span>
                  {state.meta.uploadedAt && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                      {new Date(state.meta.uploadedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <button className="btn btn--primary" style={{ whiteSpace: 'nowrap', padding: '0.5rem 1.25rem', fontSize: '0.9rem' }} onClick={() => setShowUpload(true)}>
                  Upload New File
                </button>
              </div>
            ) : (
              <div>
                <UploadWithDate onUpload={handleFile} isLoading={false} />
                <div style={{ textAlign: 'right', marginTop: '0.5rem' }}>
                  <button className="btn btn--ghost" onClick={() => setShowUpload(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* KRI Table */}
          <ExpandableCard>
            <h2 className="verify-step-title" style={{ marginBottom: '0.75rem' }}>Key Risk Indicators</h2>

            <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>KRI</th>
                    <th>KRI</th>
                    <th className="text-right">Ratio (%)</th>
                    <th className="text-right">Trigger</th>
                    <th>Reached?</th>
                    <th className="text-right">Limit</th>
                    <th>Breached?</th>
                  </tr>
                </thead>
                <tbody>
                  {(['7D', '1M', '3M'] as const).map((k, i) => {
                    const row = state.lmg.kri[k];
                    return (
                      <tr key={k}>
                        {i === 0 && <td rowSpan={3} style={{ fontWeight: 600, verticalAlign: 'top' }}>Liquidity Gap Ratio</td>}
                        <td>{k}</td>
                        <td className="text-right mono" style={{
                          fontWeight: 700,
                          color: row.reached === 'Y' ? 'var(--color-error)' : 'var(--color-success)',
                        }}>
                          {fmtPct(row.ratio)}
                        </td>
                        <td className="text-right mono" style={{ color: 'var(--color-trigger)', fontWeight: 700 }}>{fmtPct(row.trigger)}</td>
                        <td style={{ fontWeight: 700, textAlign: 'center', color: row.reached === 'Y' ? 'var(--color-error)' : 'var(--color-success)' }}>
                          {row.reached}
                        </td>
                        <td className="text-right mono">{fmtPct(row.limit)}</td>
                        <td style={{ fontWeight: 700, textAlign: 'center', color: row.breached === 'Y' ? 'var(--color-error)' : 'var(--color-success)' }}>
                          {row.breached}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-right">LCR (%)</th>
                    <th className="text-right">3M Liquidity Ratio (%)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--color-error)', fontSize: '1rem' }}>
                      {state.lmg.lcrPercent !== null ? fmtPct(state.lmg.lcrPercent) : 'N/A'}
                    </td>
                    <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--color-error)', fontSize: '1rem' }}>
                      {fmtPct(state.lmg.ratio3MLR)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </ExpandableCard>

          {/* 7-Day / 1-Month / 3-Month */}
          {renderForecastTable('7-Day Liquidity Gap Ratio', state.fc7d)}
          {renderForecastTable('1-Month Liquidity Gap Ratio', state.fc1m)}
          {renderForecastTable('3-Month Liquidity Gap Ratio', state.fc3m)}

        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forecast table renderer (shared by 7d / 1m / 3m)
// ---------------------------------------------------------------------------

function renderForecastTable(title: string, data: ForecastResponse) {
  return (
    <ExpandableCard>
      <h2 className="verify-step-title" style={{ marginBottom: '0.75rem' }}>{title}</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th></th>
              {data.months.map((m) => (
                <th key={m.from} className="text-right" style={{ minWidth: '100px' }}>{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>From</td>
              {data.months.map((m) => (
                <td key={m.from} className="text-right mono" style={{ fontSize: '0.7rem' }}>{m.from}</td>
              ))}
            </tr>
            <tr>
              <td style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>To</td>
              {data.months.map((m) => (
                <td key={m.from} className="text-right mono" style={{ fontSize: '0.7rem' }}>{m.to}</td>
              ))}
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Asset</td>
              {data.months.map((m) => (
                <td key={m.from} className="text-right mono">{m.asset.toLocaleString()}</td>
              ))}
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Liability</td>
              {data.months.map((m) => (
                <td key={m.from} className="text-right mono">{m.liab.toLocaleString()}</td>
              ))}
            </tr>
            <tr style={{ borderTop: '2px solid var(--color-border)' }}>
              <td style={{ fontWeight: 700 }}>Gap</td>
              {data.months.map((m) => (
                <td key={m.from} className="text-right mono" style={{ fontWeight: 700 }}>{m.gap.toLocaleString()}</td>
              ))}
            </tr>
            <tr>
              <td>Total Asset</td>
              {data.months.map((m) => (
                <td key={m.from} className="text-right mono">{m.totalAsset.toLocaleString()}</td>
              ))}
            </tr>
            <tr style={{ borderTop: '2px solid var(--color-border)' }}>
              <td style={{ fontWeight: 700 }}>Gap Ratio</td>
              {data.months.map((m) => (
                <td key={m.from} className="text-right mono" style={{
                  fontWeight: 700, fontSize: '1rem',
                  color: m.gapRatio !== null && m.gapRatio < m.trigger ? 'var(--color-error)' : 'var(--color-success)',
                }}>
                  {m.gapRatio !== null ? Math.round(m.gapRatio * 100) + '%' : 'N/A'}
                </td>
              ))}
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Trigger</td>
              {data.months.map((m) => (
                <td key={m.from} className="text-right mono" style={{ color: 'var(--color-trigger)', fontWeight: 700 }}>{Math.round(m.trigger * 100)}%</td>
              ))}
            </tr>
            <tr>
              <td>(-) Shortfall</td>
              {data.months.map((m) => (
                <td key={m.from} className="text-right mono">{m.shortfall.toLocaleString()}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </ExpandableCard>
  );
}
