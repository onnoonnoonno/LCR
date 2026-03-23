/**
 * HistoryView
 *
 * Report History with per-item delete, plus Regulatory Indicators section
 * identical to Dashboard (7 columns, Previous/Current Day, Daily Change, footnotes).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  listHistory,
  deleteHistoryRun,
  fetchLmgSummary,
  fetchGapForecast,
  fetchIrrbb,
  HistoryItem,
  LmgSummaryResponse,
  ForecastResponse,
  IrrbbData,
} from '../services/api';
import { IrrbbTable } from './IrrbbTable';

// ---------------------------------------------------------------------------
// Shared types / constants — identical to DashboardView
// ---------------------------------------------------------------------------

type ItemKey = 'lcr' | '3m_lr' | '12m_ir' | '7d_gap' | '1m_gap' | '3m_gap';

interface ItemConfig {
  key: ItemKey;
  label: string;
  triggerDisplay: string;
  limitDisplay: string;
  triggerValue: number;
  limitValue: number | null;
  direction: 'lte' | 'gte';
}

const ITEMS: ItemConfig[] = [
  { key: 'lcr',    label: 'LCR',                                      triggerDisplay: '\u226450.0',         limitDisplay: '\u226445.0',         triggerValue: 50.0,  limitValue: 45.0,  direction: 'lte' },
  { key: '3m_lr',  label: '3M Liquidity Ratio',                       triggerDisplay: '\u226440.0',         limitDisplay: '-',                  triggerValue: 40.0,  limitValue: null,  direction: 'lte' },
  { key: '12m_ir', label: '12M Interest Rate\nSensitive Gap Ratio',   triggerDisplay: '\u226530.0',         limitDisplay: '-',                  triggerValue: 30.0,  limitValue: null,  direction: 'gte' },
  { key: '7d_gap', label: '7D GAP',                                   triggerDisplay: '\u22640.0',          limitDisplay: '\u2264 \u03945.0',   triggerValue: 0.0,   limitValue: -5.0,  direction: 'lte' },
  { key: '1m_gap', label: '1M GAP',                                   triggerDisplay: '\u2264 \u039415.0',  limitDisplay: '\u2264 \u039420.0',  triggerValue: -15.0, limitValue: -20.0, direction: 'lte' },
  { key: '3m_gap', label: '3M GAP',                                   triggerDisplay: '\u2264 \u039440.0',  limitDisplay: '\u2264 \u039445.0',  triggerValue: -40.0, limitValue: -45.0, direction: 'lte' },
];

const LIQUIDITY_ITEMS = ITEMS.filter((i) => ['lcr', '3m_lr', '12m_ir'].includes(i.key));
const GAP_ITEMS       = ITEMS.filter((i) => i.key.endsWith('_gap'));

function toTs(d: string): number { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).getTime(); }

function checkBreach(value: number | null, cfg: ItemConfig): 'N' | 'Y' | 'Crisis' {
  if (value === null) return 'N';
  if (cfg.direction === 'lte') {
    if (cfg.limitValue !== null && value <= cfg.limitValue) return 'Crisis';
    if (value <= cfg.triggerValue) return 'Y';
    return 'N';
  }
  if (cfg.limitValue !== null && value >= cfg.limitValue) return 'Crisis';
  if (value >= cfg.triggerValue) return 'Y';
  return 'N';
}

function extractValues(lmg: LmgSummaryResponse, irrbb?: IrrbbData | null): Record<ItemKey, number | null> {
  return {
    lcr:     lmg.lcrPercent !== null ? lmg.lcrPercent * 100 : null,
    '3m_lr': lmg.ratio3MLR  !== null ? lmg.ratio3MLR  * 100 : null,
    '12m_ir': irrbb?.ratio != null ? irrbb.ratio * 100 : null,
    '7d_gap': lmg.kri['7D'].ratio !== null ? lmg.kri['7D'].ratio * 100 : null,
    '1m_gap': lmg.kri['1M'].ratio !== null ? lmg.kri['1M'].ratio * 100 : null,
    '3m_gap': lmg.kri['3M'].ratio !== null ? lmg.kri['3M'].ratio * 100 : null,
  };
}

function fmtVal(v: number | null): string { return v === null ? '-' : v.toFixed(2); }
function fmtPct(v: number | null): string { return v === null ? 'N/A' : Math.round(v * 100) + '%'; }
function fmtChange(c: number | null, p: number | null): string {
  if (c === null || p === null) return '-';
  const d = c - p; return (d > 0 ? '+' : '') + d.toFixed(2);
}
function changeColor(ch: number | null, dir: 'lte' | 'gte'): string | undefined {
  if (ch === null || ch === 0) return undefined;
  if (dir === 'lte') return ch > 0 ? 'var(--color-success)' : 'var(--color-change-neg)';
  return ch < 0 ? 'var(--color-success)' : 'var(--color-change-neg)';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props { onSelectRun: (runId: string) => void; userRole?: string; onNavigateToLcr?: (runId: string) => void; }

type LoadedReport = {
  item: HistoryItem;
  lmg: LmgSummaryResponse;
  fc7d: ForecastResponse;
  fc1m: ForecastResponse;
  fc3m: ForecastResponse;
  irrbb: IrrbbData | null;
  currentValues: Record<ItemKey, number | null>;
  currentDate: string;
  previousValues: Record<ItemKey, number | null> | null;
  prevDate: string;
};

const PAGE_SIZE = 5;

export function HistoryView({ onSelectRun: _onSelectRun, userRole, onNavigateToLcr }: Props) {
  const isAdmin = userRole === 'admin';
  const [items, setItems]               = useState<HistoryItem[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loadingDate, setLoadingDate]   = useState<string | null>(null);
  const [report, setReport]             = useState<LoadedReport | null>(null);
  const [dateFilter, setDateFilter]     = useState('');
  const [page, setPage]                 = useState(0);
  const [popupItem, setPopupItem]       = useState<ItemKey | null>(null);
  const [deleteTarget, setDeleteTarget]   = useState<HistoryItem | null>(null);
  const [deleteSubmitting, setDeleteSubmitting]   = useState(false);
  const [deleteError, setDeleteError]             = useState<string | null>(null);

  // ---------------------------------------------------------------
  // Load history list
  // ---------------------------------------------------------------

  const reload = useCallback(() => {
    setLoading(true); setError(null);
    listHistory()
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load history'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const dates = useMemo(() => {
    const map = new Map<string, HistoryItem>();
    for (const item of items) { if (!map.has(item.reportDate)) map.set(item.reportDate, item); }
    return Array.from(map.values());
  }, [items]);

  const filtered = useMemo(() => dateFilter ? dates.filter((d) => d.reportDate === dateFilter) : dates, [dates, dateFilter]);
  useEffect(() => { setPage(0); }, [dateFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ---------------------------------------------------------------
  // Load report + previous run (same logic as Dashboard)
  // ---------------------------------------------------------------

  const loadReport = useCallback(async (item: HistoryItem) => {
    setLoadingDate(item.reportDate);
    setSelectedDate(item.reportDate);
    setReport(null);
    console.debug('[History] loadReport — runId:', item.runId, 'date:', item.reportDate);
    try {
      const [lmg, fc7d, fc1m, fc3m, irrbbRes] = await Promise.all([
        fetchLmgSummary(item.runId),
        fetchGapForecast(item.runId, '7day'),
        fetchGapForecast(item.runId, '1month'),
        fetchGapForecast(item.runId, '3month'),
        fetchIrrbb(item.runId).catch(() => null),
      ]);

      const irrbb = irrbbRes?.irrbb ?? null;
      console.debug('[History] irrbb for runId', item.runId, ':', irrbb ? `ratio=${irrbb.ratio}` : 'null');

      const currentDate = item.reportDate;
      const currentValues = extractValues(lmg, irrbb);

      // Find previous: first history item with report_date strictly before current
      let previousValues: Record<ItemKey, number | null> | null = null;
      let prevDate = '';
      const curTs = toTs(currentDate);
      const prevItem = items.find((h) => toTs(h.reportDate) < curTs);
      if (prevItem) {
        try {
          const [prevLmg, prevIrrbbRes] = await Promise.all([
            fetchLmgSummary(prevItem.runId),
            fetchIrrbb(prevItem.runId).catch(() => null),
          ]);
          const prevIrrbb = prevIrrbbRes?.irrbb ?? null;
          previousValues = extractValues(prevLmg, prevIrrbb);
          prevDate = prevItem.reportDate;
        } catch { /* no previous data */ }
      }

      setReport({ item, lmg, fc7d, fc1m, fc3m, irrbb, currentValues, currentDate, previousValues, prevDate });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load report');
    } finally {
      setLoadingDate(null);
    }
  }, [items]);

  // ---------------------------------------------------------------
  // Delete handler
  // ---------------------------------------------------------------

  /** Step 1: user clicks Delete → show confirm modal */
  function handleDeleteRequest(item: HistoryItem) {
    setDeleteTarget(item);
    setDeleteError(null);
  }

  /** Step 2: user confirms → perform delete via JWT auth */
  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    setDeleteError(null);
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteHistoryRun(target.runId);
      if (report?.item.runId === target.runId) { setReport(null); setSelectedDate(null); }
      reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to delete';
      setDeleteError(msg);
    } finally {
      setDeleteSubmitting(false);
    }
  }

  // ---------------------------------------------------------------
  // Render: Regulatory Indicators — IDENTICAL to Dashboard
  // ---------------------------------------------------------------

  function thTwoLine(label: string, date: string, extra?: string) {
    return (
      <th className={`text-right${extra ? ' ' + extra : ''}`}>
        <div className="th-two-line">
          <span className="th-two-line__label">{label}</span>
          {date && <span className="th-two-line__date">{date}</span>}
        </div>
      </th>
    );
  }

  function renderItemRow(item: ItemConfig) {
    if (!report) return null;
    const curr = report.currentValues[item.key];
    const prev = report.previousValues?.[item.key] ?? null;
    const breach = checkBreach(curr, item);
    const diff = curr !== null && prev !== null ? curr - prev : null;

    return (
      <tr key={item.key} className="summary-row" onClick={() => setPopupItem(item.key)}>
        <td className="summary-item-cell">
          <span className="summary-item-chevron">{'\u203A'}</span>
          <span className="summary-item-label" style={{ whiteSpace: 'pre-line' }}>{item.label}</span>
        </td>
        <td className="text-right mono summary-trigger-val">{item.triggerDisplay}</td>
        <td className="text-right mono summary-limit-val">{item.limitDisplay}</td>
        <td className="text-right mono summary-num-prev">{fmtVal(prev)}</td>
        <td className="text-right mono summary-num-current current-day-col">{fmtVal(curr)}</td>
        <td className="text-right mono summary-num-change" style={{ color: changeColor(diff, item.direction) }}>
          {fmtChange(curr, prev)}
        </td>
        <td style={{ textAlign: 'center' }}>
          <span className={`breach-badge breach-badge--${breach.toLowerCase()}`}>{breach}</span>
        </td>
      </tr>
    );
  }

  function renderRegulatoryIndicators() {
    if (!report) return null;

    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 className="verify-step-title">Regulatory Indicators</h2>
          <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>(Unit: %, %p)</span>
        </div>

        <div className="table-wrapper">
          <table className="data-table summary-table summary-table--lg">
            <thead>
              <tr>
                <th>Items</th>
                <th className="text-right">Trigger</th>
                <th className="text-right">Limit</th>
                {thTwoLine('Previous Day', report.prevDate)}
                {thTwoLine('Current Day', report.currentDate, 'current-day-col current-day-col--top')}
                <th className="text-right">Daily Change</th>
                <th style={{ textAlign: 'center' }}>Breach</th>
              </tr>
            </thead>
            <tbody>
              {LIQUIDITY_ITEMS.map((item) => renderItemRow(item))}
              {GAP_ITEMS.map((item) => renderItemRow(item))}
            </tbody>
          </table>
        </div>

        <ul className="summary-footnotes">
          <li>In the event of a Trigger breach, it must be reported to the RMC.</li>
          <li>In the event of a Limit breach, it must be reported to APRA and SOOA.</li>
          <li>Even if the 3M Liquidity Ratio falls to 40% or below, it is not considered a breach provided the monthly average LCR remains at 80% or higher.</li>
        </ul>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Render: Popup — identical to Dashboard popup structure
  // ---------------------------------------------------------------

  function renderPopup() {
    const cfg = ITEMS.find((i) => i.key === popupItem);
    if (!cfg || !report) return null;

    const isKri = cfg.key === 'lcr' || cfg.key === '3m_lr';
    const isGap = cfg.key.endsWith('_gap');
    const gapMap: Record<string, { data: ForecastResponse; title: string }> = {
      '7d_gap': { data: report.fc7d, title: '7-Day Liquidity Gap Ratio' },
      '1m_gap': { data: report.fc1m, title: '1-Month Liquidity Gap Ratio' },
      '3m_gap': { data: report.fc3m, title: '3-Month Liquidity Gap Ratio' },
    };
    const popupTitle = isKri ? 'Key Risk Indicators' : isGap ? gapMap[cfg.key].title : cfg.label.replace('\n', ' ');

    return (
      <div className="modal-overlay" onClick={() => setPopupItem(null)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: isGap ? 'calc(100vw - 4rem)' : '780px', width: isGap ? '95vw' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>{popupTitle}</h3>
            <button className="btn btn--sm btn--ghost" onClick={() => setPopupItem(null)} aria-label="Close">{'\u2715'}</button>
          </div>

          {isKri && (
            <>
              <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
                <table className="data-table">
                  <thead><tr><th>KRI</th><th>KRI</th><th className="text-right">Ratio (%)</th><th className="text-right">Trigger</th><th>Reached?</th><th className="text-right">Limit</th><th>Breached?</th></tr></thead>
                  <tbody>
                    {(['7D', '1M', '3M'] as const).map((k, i) => {
                      const row = report.lmg.kri[k];
                      return (
                        <tr key={k}>
                          {i === 0 && <td rowSpan={3} style={{ fontWeight: 600, verticalAlign: 'top' }}>Liquidity Gap Ratio</td>}
                          <td>{k}</td>
                          <td className="text-right mono" style={{ fontWeight: 700, color: row.reached === 'Y' ? 'var(--color-error)' : 'var(--color-success)' }}>{fmtPct(row.ratio)}</td>
                          <td className="text-right mono" style={{ color: 'var(--color-trigger)', fontWeight: 700 }}>{fmtPct(row.trigger)}</td>
                          <td style={{ fontWeight: 700, textAlign: 'center', color: row.reached === 'Y' ? 'var(--color-error)' : 'var(--color-success)' }}>{row.reached}</td>
                          <td className="text-right mono" style={{ color: 'var(--color-limit)', fontWeight: 700 }}>{fmtPct(row.limit)}</td>
                          <td style={{ fontWeight: 700, textAlign: 'center', color: row.breached === 'Y' ? 'var(--color-error)' : 'var(--color-success)' }}>{row.breached}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead><tr><th className="text-right">LCR (%)</th><th className="text-right">3M Liquidity Ratio (%)</th></tr></thead>
                  <tbody><tr>
                    <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--color-error)', fontSize: '1rem' }}>{report.lmg.lcrPercent !== null ? fmtPct(report.lmg.lcrPercent) : 'N/A'}</td>
                    <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--color-error)', fontSize: '1rem' }}>{fmtPct(report.lmg.ratio3MLR)}</td>
                  </tr></tbody>
                </table>
              </div>
            </>
          )}

          {cfg.key === '12m_ir' && (() => {
            console.debug('[History] popup irrbb for runId', report.item.runId, ':', report.irrbb ? `ratio=${report.irrbb.ratio}` : 'null');
            return <IrrbbTable data={report.irrbb} />;
          })()}

          {isGap && (() => {
            const data = gapMap[cfg.key].data;
            return (
              <>
                <div style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
                  Unit: AUD
                </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead><tr><th></th>{data.months.map((m) => <th key={m.from} className="text-right" style={{ minWidth: '100px' }}>{m.label}</th>)}</tr></thead>
                  <tbody>
                    <tr><td style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>From</td>{data.months.map((m) => <td key={m.from} className="text-right mono" style={{ fontSize: '0.7rem' }}>{m.from}</td>)}</tr>
                    <tr><td style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>To</td>{data.months.map((m) => <td key={m.from} className="text-right mono" style={{ fontSize: '0.7rem' }}>{m.to}</td>)}</tr>
                    <tr><td style={{ fontWeight: 600 }}>Asset</td>{data.months.map((m) => <td key={m.from} className="text-right mono">{m.asset.toLocaleString()}</td>)}</tr>
                    <tr><td style={{ fontWeight: 600 }}>Liability</td>{data.months.map((m) => <td key={m.from} className="text-right mono">{m.liab.toLocaleString()}</td>)}</tr>
                    <tr style={{ borderTop: '2px solid var(--color-border)' }}><td style={{ fontWeight: 700 }}>Gap</td>{data.months.map((m) => <td key={m.from} className="text-right mono" style={{ fontWeight: 700 }}>{m.gap.toLocaleString()}</td>)}</tr>
                    <tr><td>Total Asset</td>{data.months.map((m) => <td key={m.from} className="text-right mono">{m.totalAsset.toLocaleString()}</td>)}</tr>
                    <tr style={{ borderTop: '2px solid var(--color-border)' }}><td style={{ fontWeight: 700 }}>Gap Ratio</td>{data.months.map((m) => <td key={m.from} className="text-right mono" style={{ fontWeight: 700, fontSize: '1rem', color: m.gapRatio !== null && m.gapRatio < m.trigger ? 'var(--color-error)' : 'var(--color-success)' }}>{m.gapRatio !== null ? Math.round(m.gapRatio * 100) + '%' : 'N/A'}</td>)}</tr>
                    <tr><td style={{ fontWeight: 700 }}>Trigger</td>{data.months.map((m) => <td key={m.from} className="text-right mono" style={{ color: 'var(--color-trigger)', fontWeight: 700 }}>{Math.round(m.trigger * 100)}%</td>)}</tr>
                    <tr><td>(-) Shortfall</td>{data.months.map((m) => <td key={m.from} className="text-right mono">{m.shortfall.toLocaleString()}</td>)}</tr>
                  </tbody>
                </table>
              </div>
              </>
            );
          })()}

          {cfg.key === 'lcr' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button className="btn btn--primary" onClick={() => { setPopupItem(null); if (report) onNavigateToLcr?.(report.item.runId); }}>More Details {'\u2192'}</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------

  return (
    <div className="verify-view">
      {/* Report History */}
      <section className="card" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2 className="verify-step-title" style={{ margin: 0 }}>Report History</h2>
          {!loading && dates.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>Find Date:</label>
              <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} style={{ padding: '0.35rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.85rem', fontFamily: 'var(--font-mono)', width: '170px' }} />
              {dateFilter && <button className="btn btn--ghost" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setDateFilter('')}>Show All</button>}
            </div>
          )}
        </div>

        {loading && <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>}
        {error && <p style={{ color: 'var(--color-error)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
        {!loading && dates.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>No report history available.</p>}
        {!loading && dates.length > 0 && filtered.length === 0 && <p style={{ color: 'var(--color-text-muted)', padding: '1rem 0' }}>No report found for {dateFilter}.</p>}

        {pageItems.length > 0 && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Report Date</th><th>Source File</th><th className="text-right">LCR %</th><th className="text-right">3M Liquidity Ratio</th><th>Status</th><th>Uploaded</th><th></th>{isAdmin && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item) => {
                    const isSelected = selectedDate === item.reportDate;
                    const isLoading = loadingDate === item.reportDate;
                    return (
                      <tr key={item.runId} style={{ cursor: 'pointer', background: isSelected ? '#eff6ff' : undefined }}>
                        <td onClick={() => loadReport(item)}><span style={{ color: 'var(--color-primary)', fontWeight: 700, fontSize: '0.95rem' }}>{item.reportDate}</span></td>
                        <td onClick={() => loadReport(item)} style={{ fontSize: '0.8rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sourceFilename || '\u2014'}</td>
                        <td className="text-right mono" style={{ fontWeight: 700 }} onClick={() => loadReport(item)}>
                          {item.lcrRatio !== null ? <span style={{ color: checkBreach(item.lcrRatio, ITEMS[0]) !== 'N' ? 'var(--color-error)' : 'var(--color-success)' }}>{item.lcrRatio.toFixed(2)}%</span> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}
                        </td>
                        <td className="text-right mono" style={{ fontWeight: 700 }} onClick={() => loadReport(item)}>
                          {item.ratio3mLr !== null ? <span>{(item.ratio3mLr * 100).toFixed(2)}%</span> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}
                        </td>
                        <td onClick={() => loadReport(item)}>
                          <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, background: item.status === 'complete' ? 'var(--color-success-bg)' : 'var(--color-warning-bg)', color: item.status === 'complete' ? 'var(--color-success)' : 'var(--color-warning)' }}>{item.status}</span>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }} onClick={() => loadReport(item)}>{new Date(item.uploadedAt).toLocaleString()}</td>
                        <td onClick={() => loadReport(item)}>
                          {isLoading ? <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : <span style={{ color: isSelected ? 'var(--color-primary)' : 'var(--color-text-muted)', fontSize: '0.8rem', fontWeight: isSelected ? 700 : 400 }}>{isSelected ? 'Selected' : 'View'}</span>}
                        </td>
                        {isAdmin && (
                          <td>
                            <button className="btn btn--sm btn--ghost" style={{ color: 'var(--color-error)', fontSize: '0.78rem', padding: '0.2rem 0.5rem' }} onClick={(e) => { e.stopPropagation(); handleDeleteRequest(item); }} title="Delete this report">{'\u2715'}</button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginTop: '0.75rem', fontSize: '0.85rem' }}>
                <button className="btn btn--ghost" style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button key={i} className={`btn ${page === i ? 'btn--primary' : 'btn--ghost'}`} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', minWidth: '32px' }} onClick={() => setPage(i)}>{i + 1}</button>
                ))}
                <button className="btn btn--ghost" style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }} disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</button>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>{filtered.length} date{filtered.length !== 1 ? 's' : ''}</span>
              </div>
            )}
          </>
        )}
      </section>

      {loadingDate && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner" />
          <p style={{ marginTop: '0.75rem', color: 'var(--color-text-muted)' }}>Loading report for {loadingDate}...</p>
        </div>
      )}

      {report && !loadingDate && renderRegulatoryIndicators()}
      {popupItem !== null && renderPopup()}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Delete Report</h3>
            <p style={{ margin: '0 0 0.5rem' }}>Are you sure you want to delete the report for <strong>{deleteTarget.reportDate}</strong>?</p>
            <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>This will permanently delete the run, raw data, processed data, and summary. This action cannot be undone.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className="btn btn--ghost" onClick={() => setDeleteTarget(null)} disabled={deleteSubmitting}>Cancel</button>
              <button className="btn btn--primary" style={{ background: 'var(--color-error)' }} onClick={handleDeleteConfirmed} disabled={deleteSubmitting}>
                {deleteSubmitting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteError && (
        <div style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', background: 'var(--color-error-bg, #fef2f2)', color: 'var(--color-error)', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.85rem', zIndex: 3000, boxShadow: '0 2px 12px rgba(0,0,0,0.15)' }}>
          {deleteError}
          <button className="btn btn--sm btn--ghost" style={{ marginLeft: '0.75rem' }} onClick={() => setDeleteError(null)}>{'\u2715'}</button>
        </div>
      )}
    </div>
  );
}
