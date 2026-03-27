/**
 * StressTestView — Interest Rate Stress Test page (admin-only).
 *
 * Displays VaR (6 shock scenarios), EaR, Gap Ratio, and 16-bucket
 * repricing summary from the /api/stress-test endpoint.
 *
 * This component does NOT perform any calculations itself — it is
 * display-only, consuming the verified backend result.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  fetchStressTest,
  fetchLatestRun,
  StressTestResponse,
} from '../services/api';

interface Props {
  externalRunId?: string;
}

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

function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (abs >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return v.toFixed(0);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StressTestView({ externalRunId }: Props) {
  const [data, setData]       = useState<StressTestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

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

  const defaultEar = data.earResults.find(e => e.rateShock === 0.03) ?? data.earResults[0];

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

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
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
            Gap Ratio (12M)
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-primary)' }}>
            {fmtPct(data.gapRatio)}
          </div>
        </div>

        {/* VaR */}
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
            VaR ({worstShock.shockType})
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: data.var < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
            {fmtMoney(data.var)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
            Ratio: {fmtPct(data.varRatio, 4)}
          </div>
        </div>

        {/* EaR (default 3%) */}
        {defaultEar && (
          <div className="card" style={{ padding: '1rem 1.25rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
              EaR ({(defaultEar.rateShock * 100).toFixed(0)}% Shock)
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: defaultEar.ear < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
              {fmtMoney(defaultEar.ear)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
              Ratio: {fmtPct(defaultEar.earRatio, 4)}
            </div>
          </div>
        )}

        {/* Total Asset */}
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
            Total Asset
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--color-text)' }}>
            {fmtNum(data.totalAsset)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
            Rate-Sensitive: {fmtNum(data.totalAssetSensitive)}
          </div>
        </div>
      </div>

      {/* Shock Scenarios */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 className="verify-step-title" style={{ marginBottom: '0.75rem' }}>Shock Scenario Analysis</h3>
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
      </div>

      {/* EaR Scenarios */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 className="verify-step-title" style={{ marginBottom: '0.75rem' }}>Earnings at Risk (EaR) Scenarios</h3>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rate Shock</th>
                <th className="text-right">EaR</th>
                <th className="text-right">EaR Ratio</th>
              </tr>
            </thead>
            <tbody>
              {data.earResults.map((e) => (
                <tr key={e.rateShock}>
                  <td style={{ fontWeight: 600 }}>{(e.rateShock * 100).toFixed(1)}%</td>
                  <td className="text-right mono" style={{ fontWeight: 600, color: e.ear < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
                    {fmtNum(e.ear)}
                  </td>
                  <td className="text-right mono" style={{ fontWeight: 600, color: e.earRatio < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
                    {fmtPct(e.earRatio, 4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bucket Summary */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 className="verify-step-title" style={{ marginBottom: '0.75rem' }}>Repricing Bucket Summary</h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
          16 rate-sensitive repricing buckets. Non-sensitive amounts ({fmtNum(data.nonSensitive.asset)} asset / {fmtNum(data.nonSensitive.liability)} liability) are included in the Overnight bucket.
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
              {/* Total row */}
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
      </div>

      {/* Notes */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 className="verify-step-title" style={{ marginBottom: '0.5rem' }}>Notes</h3>
        <ul style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: 1.8, paddingLeft: '1.25rem', margin: 0 }}>
          <li>Values are based on currently stored report data (report date: {data.reportDate}).</li>
          <li>VaR is the minimum (worst-case) of 6 Basel IRRBB standard shock scenarios.</li>
          <li>EaR uses within-1-year repricing buckets with proportional time weights.</li>
          <li>Gap Ratio (12M) = |Asset − Liability| within 1 year / Total rate-sensitive assets.</li>
          <li>Non-sensitive amounts are placed in the Overnight bucket per regulatory convention.</li>
          <li>This page is restricted to admin users for analytical purposes.</li>
        </ul>
      </div>
    </>
  );
}
