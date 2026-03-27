/**
 * StressTestView — IRRBB Stress Test page (admin-only).
 *
 * Displays VaR (6 shock scenarios), EaR, Gap Ratio, and 16-bucket
 * repricing summary from the /api/stress-test endpoint.
 * Aligned with [Summary_IRRBB] sheet: non-sensitive shown separately.
 *
 * Custom Rate Shock %: computed frontend-only using sensitiveNetPositions
 * from the backend response and the standard EaR time-weight formula.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  fetchStressTest,
  fetchLatestRun,
  StressTestResponse,
} from '../services/api';
import { exportSectionsToPdf } from '../services/pdfExport';

interface Props {
  externalRunId?: string;
}

// ---------------------------------------------------------------------------
// Constants — must match backend stressTestService.ts TIME_WEIGHTS
// ---------------------------------------------------------------------------

const TIME_WEIGHTS = [
  364 / 365,       // Bucket 0: O/N
  (12 - 0.5) / 12, // Bucket 1: 0 to <1 month
  (12 - 1.5) / 12, // Bucket 2: 1 to <2 months
  (12 - 2.5) / 12, // Bucket 3: 2 to <3 months
  (12 - 4.5) / 12, // Bucket 4: 3 to <6 months
  (12 - 7.5) / 12, // Bucket 5: 6 to <9 months
  (12 - 10.5) / 12, // Bucket 6: 9 to <12 months
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtNum(v: number): string {
  return Math.round(v).toLocaleString();
}

function fmtPct(v: number | null): string {
  if (v === null) return 'N/A';
  return (Math.round(v * 100 * 100) / 100).toFixed(2) + '%';
}

function fmtDollar(v: number): string {
  return '$' + Math.round(Math.abs(v)).toLocaleString();
}

// Download icon SVG (matches Dashboard/LCR export buttons)
function DownloadIcon({ spinning }: { spinning?: boolean }) {
  if (spinning) {
    return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, animation: 'spin 1s linear infinite' }}><circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" /></svg>;
  }
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type DetailTab = 'buckets' | 'shocks';

export function StressTestView({ externalRunId }: Props) {
  const [data, setData]               = useState<StressTestResponse | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [rateShockPct, setRateShockPct] = useState(3);
  const [detailTab, setDetailTab]     = useState<DetailTab>('buckets');
  const [pdfExporting, setPdfExporting] = useState(false);

  // Refs for PDF export
  const pageRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async (runId?: string) => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      let targetRunId = runId;
      if (!targetRunId) {
        const latest = await fetchLatestRun();
        if (!latest.success || !latest.found || !latest.runId) {
          setError('No report data available. Please upload a report first.');
          setLoading(false);
          return;
        }
        targetRunId = latest.runId;
      }

      const result = await fetchStressTest(targetRunId);
      if (!result.success) {
        setError('Failed to load stress test data.');
        setLoading(false);
        return;
      }
      setData(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('403') || msg.includes('Forbidden') || msg.includes('denied')) {
        setError('Access denied. This page is restricted to admin users.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(externalRunId); }, [externalRunId, loadData]);

  // ------------------------------------------------------------------
  // Frontend-only EaR recalculation for custom rate shock
  // ------------------------------------------------------------------

  const customEar = useMemo(() => {
    if (!data || !data.sensitiveNetPositions) return { ear: 0, earRatio: 0 };
    const rateShock = rateShockPct / 100;
    let earTotal = 0;
    for (let i = 0; i < TIME_WEIGHTS.length && i < data.sensitiveNetPositions.length; i++) {
      earTotal += data.sensitiveNetPositions[i] * TIME_WEIGHTS[i] * rateShock;
    }
    const earRatio = data.totalAsset !== 0 ? earTotal / data.totalAsset : 0;
    return { ear: earTotal, earRatio };
  }, [data, rateShockPct]);

  // ------------------------------------------------------------------
  // PDF export
  // ------------------------------------------------------------------

  async function handleExportPdf() {
    if (!pageRef.current || !data) return;
    setPdfExporting(true);
    try {
      await exportSectionsToPdf(
        [{ element: pageRef.current }],
        `IRRBB_StressTest_${data.reportDate || 'export'}`,
        { singlePage: true },
      );
    } finally {
      setPdfExporting(false);
    }
  }

  // ------------------------------------------------------------------
  // Loading / Error / Empty states
  // ------------------------------------------------------------------

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <p style={{ color: 'var(--color-text-muted)' }}>Loading stress test data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <p style={{ color: 'var(--color-error)', fontWeight: 600 }}>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <p style={{ color: 'var(--color-text-muted)' }}>No stress test data available.</p>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Derived values
  // ------------------------------------------------------------------

  const worstShock = data.shockResults.reduce((worst, s) =>
    s.total < worst.total ? s : worst, data.shockResults[0]);

  const labelStyle: React.CSSProperties = { fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.2rem' };
  const primaryValStyle: React.CSSProperties = { fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.1 };
  const secondaryValStyle: React.CSSProperties = { fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-muted)', marginTop: '0.2rem' };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div ref={pageRef}>
      {/* Page header — compact info bar */}
      <div className="card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Report Date</span>
              <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-primary)' }}>{data.reportDate}</span>
            </div>
            <div style={{ width: 1, height: 28, background: 'var(--color-border)' }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>IRRBB Stress Test</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>Admin-only analytical view</span>
            <button
              className="btn btn--ghost"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0.35rem', borderRadius: '6px', lineHeight: 1 }}
              onClick={handleExportPdf}
              disabled={pdfExporting}
              title="Export PDF"
              aria-label="Export PDF"
            >
              <DownloadIcon spinning={pdfExporting} />
            </button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {/* Gap Ratio */}
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={labelStyle}>Gap Ratio (12M)</div>
          <div style={{ ...primaryValStyle, color: 'var(--color-primary)' }}>
            {fmtPct(data.gapRatio)}
          </div>
        </div>

        {/* VaR — Ratio primary, amount secondary */}
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={labelStyle}>VaR Ratio ({worstShock.shockType})</div>
          <div style={{ ...primaryValStyle, color: data.varRatio < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
            {fmtPct(Math.abs(data.varRatio))}
          </div>
          <div style={secondaryValStyle}>
            {fmtDollar(data.var)}
          </div>
        </div>

        {/* EaR — Ratio primary, amount secondary, with custom rate input */}
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>EaR Ratio</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
              (
              <input
                type="number"
                value={rateShockPct}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v >= 0 && v <= 100) setRateShockPct(v);
                }}
                style={{
                  width: '3.2rem', padding: '0.1rem 0.25rem', fontSize: '0.72rem',
                  fontFamily: 'var(--font-mono)', border: '1px solid #cbd5e1', borderRadius: '3px',
                  textAlign: 'right', fontWeight: 600,
                }}
                min={0} max={100} step={0.1}
              />
              % shock)
            </span>
          </div>
          <div style={{ ...primaryValStyle, color: customEar.earRatio < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
            {fmtPct(Math.abs(customEar.earRatio))}
          </div>
          <div style={secondaryValStyle}>
            {fmtDollar(customEar.ear)}
          </div>
        </div>

        {/* Total Asset — both values equal importance */}
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={labelStyle}>Total Asset</div>
          <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'baseline', marginTop: '0.15rem' }}>
            <div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text)' }}>
                {fmtDollar(data.totalAsset)}
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>All</div>
            </div>
            <div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text)' }}>
                {fmtDollar(data.totalAssetSensitive)}
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Rate-Sensitive</div>
            </div>
          </div>
        </div>
      </div>

      {/* Detail Information — tabbed section */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 className="verify-step-title" style={{ margin: 0 }}>Detail Information</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <button
              className={`btn ${detailTab === 'buckets' ? 'btn--primary' : 'btn--ghost'}`}
              style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem' }}
              onClick={() => setDetailTab('buckets')}
            >
              Repricing Bucket Summary
            </button>
            <button
              className={`btn ${detailTab === 'shocks' ? 'btn--primary' : 'btn--ghost'}`}
              style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem' }}
              onClick={() => setDetailTab('shocks')}
            >
              Shock Scenario Analysis
            </button>
          </div>
        </div>

        {/* Tab: Repricing Bucket Summary */}
        {detailTab === 'buckets' && (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th className="text-right">Asset</th>
                  <th className="text-right">Liability</th>
                  <th className="text-right">Net Position</th>
                </tr>
              </thead>
              <tbody>
                {data.bucketSummary.map((b) => (
                  <tr key={b.bucketName}>
                    <td style={{ fontWeight: 500, fontSize: '0.82rem' }}>{b.bucketName}</td>
                    <td className="text-right mono" style={{ fontWeight: 600 }}>{fmtNum(b.asset)}</td>
                    <td className="text-right mono" style={{ fontWeight: 600 }}>{fmtNum(b.liability)}</td>
                    <td className="text-right mono" style={{ fontWeight: 700, color: b.netPosition >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                      {fmtNum(b.netPosition)}
                    </td>
                  </tr>
                ))}
                {/* Non-interest rate sensitive row — separate per [Summary_IRRBB] */}
                <tr style={{ borderTop: '1px solid var(--color-border)', fontStyle: 'italic', color: 'var(--color-text-muted)' }}>
                  <td style={{ fontWeight: 500, fontSize: '0.82rem' }}>Non-interest rate sensitive</td>
                  <td className="text-right mono" style={{ fontWeight: 600 }}>{fmtNum(data.nonSensitive.asset)}</td>
                  <td className="text-right mono" style={{ fontWeight: 600 }}>{fmtNum(data.nonSensitive.liability)}</td>
                  <td className="text-right mono" style={{ fontWeight: 700, color: (data.nonSensitive.asset - data.nonSensitive.liability) >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                    {fmtNum(data.nonSensitive.asset - data.nonSensitive.liability)}
                  </td>
                </tr>
                {/* Total row */}
                <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 700 }}>
                  <td>Total</td>
                  <td className="text-right mono">{fmtNum(data.bucketSummary.reduce((s, b) => s + b.asset, 0) + data.nonSensitive.asset)}</td>
                  <td className="text-right mono">{fmtNum(data.bucketSummary.reduce((s, b) => s + b.liability, 0) + data.nonSensitive.liability)}</td>
                  <td className="text-right mono" style={{ color: (data.bucketSummary.reduce((s, b) => s + b.netPosition, 0) + data.nonSensitive.asset - data.nonSensitive.liability) >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                    {fmtNum(data.bucketSummary.reduce((s, b) => s + b.netPosition, 0) + data.nonSensitive.asset - data.nonSensitive.liability)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Tab: Shock Scenario Analysis */}
        {detailTab === 'shocks' && (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Shock Type</th>
                  <th className="text-right">Impact</th>
                  <th className="text-right">Ratio</th>
                </tr>
              </thead>
              <tbody>
                {data.shockResults.map((s) => {
                  const ratio = data.totalAsset !== 0 ? s.total / data.totalAsset : 0;
                  const isWorst = s.total === data.var;
                  return (
                    <tr key={s.shockType} style={isWorst ? { background: '#fef2f2' } : undefined}>
                      <td style={{ fontWeight: isWorst ? 700 : 500 }}>
                        {s.shockType}
                        {isWorst && <span style={{ color: 'var(--color-error)', fontSize: '0.72rem', marginLeft: '0.5rem' }}>← VaR</span>}
                      </td>
                      <td className="text-right mono" style={{ fontWeight: 600, color: s.total < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
                        {fmtNum(s.total)}
                      </td>
                      <td className="text-right mono" style={{ fontWeight: 600, color: ratio < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
                        {fmtPct(ratio)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 className="verify-step-title" style={{ marginBottom: '0.5rem' }}>Notes</h3>
        <ul style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: 1.8, paddingLeft: '1.25rem', margin: 0 }}>
          <li>Values are based on currently stored report data (report date: {data.reportDate}).</li>
          <li>VaR is the minimum (worst-case) of 6 Basel IRRBB standard shock scenarios.</li>
          <li>EaR uses within-1-year rate-sensitive repricing buckets with proportional time weights.</li>
          <li>Gap Ratio (12M) = |Asset − Liability| within 1 year / Total rate-sensitive assets.</li>
          <li>Non-interest rate sensitive amounts are shown separately, matching [Summary_IRRBB] convention.</li>
        </ul>
      </div>
    </div>
  );
}
