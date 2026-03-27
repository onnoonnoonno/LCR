/**
 * StressTestView — Interest Rate Stress Test page (admin-only).
 *
 * Displays VaR (6 shock scenarios), EaR, Gap Ratio, and 16-bucket
 * repricing summary from the /api/stress-test endpoint.
 *
 * Custom Rate Shock %: computed frontend-only using netPosition from
 * the backend response and the standard EaR time-weight formula.
 * No backend round-trip needed for custom rate shocks.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  fetchStressTest,
  fetchLatestRun,
  StressTestResponse,
} from '../services/api';

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

function fmtPct(v: number | null, decimals = 2): string {
  if (v === null) return 'N/A';
  return (v * 100).toFixed(decimals) + '%';
}

function fmtDollar(v: number): string {
  return '$' + Math.round(Math.abs(v)).toLocaleString();
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
    if (!data) return { ear: 0, earRatio: 0 };
    const rateShock = rateShockPct / 100;
    let earTotal = 0;
    for (let i = 0; i < TIME_WEIGHTS.length && i < data.bucketSummary.length; i++) {
      earTotal += data.bucketSummary[i].netPosition * TIME_WEIGHTS[i] * rateShock;
    }
    const earRatio = data.totalAsset !== 0 ? earTotal / data.totalAsset : 0;
    return { ear: earTotal, earRatio };
  }, [data, rateShockPct]);

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

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const labelStyle: React.CSSProperties = { fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.2rem' };
  const primaryValStyle: React.CSSProperties = { fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.1 };
  const secondaryValStyle: React.CSSProperties = { fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-muted)', marginTop: '0.2rem' };

  return (
    <>
      {/* Page header */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h2 className="verify-step-title" style={{ marginBottom: '0.25rem' }}>Interest Rate Stress Test</h2>
            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              Report Date: <strong>{data.reportDate}</strong> &nbsp;·&nbsp; Admin-only analytical view
            </span>
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
            {fmtPct(Math.abs(data.varRatio), 4)}
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
            {fmtPct(Math.abs(customEar.earRatio), 4)}
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
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              onClick={() => setDetailTab('buckets')}
              style={{
                padding: '0.35rem 0.85rem', fontSize: '0.78rem', fontWeight: 600,
                border: '1px solid', borderRadius: '4px', cursor: 'pointer',
                background: detailTab === 'buckets' ? 'var(--color-primary)' : 'transparent',
                color: detailTab === 'buckets' ? '#fff' : 'var(--color-text-muted)',
                borderColor: detailTab === 'buckets' ? 'var(--color-primary)' : '#e2e8f0',
              }}
            >
              Repricing Bucket Summary
            </button>
            <button
              onClick={() => setDetailTab('shocks')}
              style={{
                padding: '0.35rem 0.85rem', fontSize: '0.78rem', fontWeight: 600,
                border: '1px solid', borderRadius: '4px', cursor: 'pointer',
                background: detailTab === 'shocks' ? 'var(--color-primary)' : 'transparent',
                color: detailTab === 'shocks' ? '#fff' : 'var(--color-text-muted)',
                borderColor: detailTab === 'shocks' ? 'var(--color-primary)' : '#e2e8f0',
              }}
            >
              Shock Scenario Analysis
            </button>
          </div>
        </div>

        {/* Tab: Repricing Bucket Summary */}
        {detailTab === 'buckets' && (
          <>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
              16 rate-sensitive repricing buckets. Non-sensitive amounts ({fmtDollar(data.nonSensitive.asset)} asset / {fmtDollar(data.nonSensitive.liability)} liability) included in Overnight bucket.
            </p>
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
                  <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 700 }}>
                    <td>Total</td>
                    <td className="text-right mono">{fmtNum(data.bucketSummary.reduce((s, b) => s + b.asset, 0))}</td>
                    <td className="text-right mono">{fmtNum(data.bucketSummary.reduce((s, b) => s + b.liability, 0))}</td>
                    <td className="text-right mono" style={{ color: data.bucketSummary.reduce((s, b) => s + b.netPosition, 0) >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                      {fmtNum(data.bucketSummary.reduce((s, b) => s + b.netPosition, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
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
                        {fmtPct(ratio, 4)}
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
          <li>EaR uses within-1-year repricing buckets with proportional time weights. Custom rate shock is computed client-side.</li>
          <li>Gap Ratio (12M) = |Asset − Liability| within 1 year / Total rate-sensitive assets.</li>
          <li>Non-sensitive amounts are placed in the Overnight bucket per regulatory convention.</li>
        </ul>
      </div>
    </>
  );
}
