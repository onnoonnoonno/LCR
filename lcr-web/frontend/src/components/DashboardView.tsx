/**
 * DashboardView — KRI Summary Dashboard with drill-down detail.
 *
 * Modes (controlled by `view` prop):
 *   dashboard — summary table with all items
 *   lcr       — LCR detail view
 *   3m_lr     — 3M Liquidity Ratio detail
 *   12m_ir    — 12M Interest Rate detail (placeholder)
 *   gap       — 7D / 1M / 3M GAP combined detail
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { UploadWithDate } from './UploadWithDate';
import { ExpandableCard } from './ExpandableCard';
import {
  listHistory,
  fetchLatestRun,
  fetchLmgSummary,
  fetchGapForecast,
  fetchLcrForecast,
  uploadRaw,
  HistoryItem,
  LmgSummaryResponse,
  ForecastResponse,
  LcrForecastResponse,
} from '../services/api';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Dot,
} from 'recharts';

// ============================================================
// Types & Configuration
// ============================================================

export type ViewMode = 'dashboard' | 'lcr' | '3m_lr' | '12m_ir' | 'gap';

type ItemKey = 'lcr' | '3m_lr' | '12m_ir' | '7d_gap' | '1m_gap' | '3m_gap';
type Section = 'liquidity' | 'gap';

interface ItemConfig {
  key: ItemKey;
  label: string;
  triggerDisplay: string;
  limitDisplay: string;
  triggerValue: number;
  limitValue: number | null;
  direction: 'lte' | 'gte';
  detailTab: ViewMode;
  section: Section;
}

const ITEMS: ItemConfig[] = [
  { key: 'lcr',    label: 'LCR',                                      triggerDisplay: '\u226450.0',         limitDisplay: '\u226445.0',         triggerValue: 50.0,  limitValue: 45.0,  direction: 'lte', detailTab: 'lcr',    section: 'liquidity' },
  { key: '3m_lr',  label: '3M Liquidity Ratio',                       triggerDisplay: '\u226440.0',         limitDisplay: '-',                  triggerValue: 40.0,  limitValue: null,  direction: 'lte', detailTab: '3m_lr',  section: 'liquidity' },
  { key: '12m_ir', label: '12M Interest Rate\nSensitive Gap Ratio',   triggerDisplay: '\u226530.0',         limitDisplay: '-',                  triggerValue: 30.0,  limitValue: null,  direction: 'gte', detailTab: '12m_ir', section: 'liquidity' },
  { key: '7d_gap', label: '7D GAP',                                   triggerDisplay: '\u22640.0',          limitDisplay: '\u2264 \u03945.0',   triggerValue: 0.0,   limitValue: -5.0,  direction: 'lte', detailTab: 'gap',    section: 'gap' },
  { key: '1m_gap', label: '1M GAP',                                   triggerDisplay: '\u2264 \u039415.0',  limitDisplay: '\u2264 \u039420.0',  triggerValue: -15.0, limitValue: -20.0, direction: 'lte', detailTab: 'gap',    section: 'gap' },
  { key: '3m_gap', label: '3M GAP',                                   triggerDisplay: '\u2264 \u039440.0',  limitDisplay: '\u2264 \u039445.0',  triggerValue: -40.0, limitValue: -45.0, direction: 'lte', detailTab: 'gap',    section: 'gap' },
];

const LIQUIDITY_ITEMS = ITEMS.filter((i) => i.section === 'liquidity');
const GAP_ITEMS       = ITEMS.filter((i) => i.section === 'gap');

// ============================================================
// Helpers
// ============================================================

/** Parse YYYY-MM-DD to timestamp for safe numeric date comparison. */
function toTs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

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

function extractValues(lmg: LmgSummaryResponse): Record<ItemKey, number | null> {
  return {
    lcr:     lmg.lcrPercent !== null ? lmg.lcrPercent * 100 : null,
    '3m_lr': lmg.ratio3MLR  !== null ? lmg.ratio3MLR  * 100 : null,
    '12m_ir': null,
    '7d_gap': lmg.kri['7D'].ratio !== null ? lmg.kri['7D'].ratio * 100 : null,
    '1m_gap': lmg.kri['1M'].ratio !== null ? lmg.kri['1M'].ratio * 100 : null,
    '3m_gap': lmg.kri['3M'].ratio !== null ? lmg.kri['3M'].ratio * 100 : null,
  };
}

function fmtVal(v: number | null): string {
  if (v === null) return '-';
  return v.toFixed(2);
}

function fmtChange(curr: number | null, prev: number | null): string {
  if (curr === null || prev === null) return '-';
  const d = curr - prev;
  return (d > 0 ? '+' : '') + d.toFixed(2);
}

function changeColor(change: number | null, direction: 'lte' | 'gte'): string | undefined {
  if (change === null || change === 0) return undefined;
  if (direction === 'lte') return change > 0 ? 'var(--color-success)' : 'var(--color-change-neg)';
  return change < 0 ? 'var(--color-success)' : 'var(--color-change-neg)';
}

function fmtPct(v: number | null): string {
  if (v === null) return 'N/A';
  return Math.round(v * 100) + '%';
}

/**
 * Find previous run from history: the first item whose report_date
 * is strictly before the given currentDate (Date numeric comparison).
 */
function findPreviousRun(items: Array<{ runId: string; reportDate: string }>, currentDate: string) {
  if (!currentDate) return null;
  const curTs = toTs(currentDate);
  return items.find((h) => toTs(h.reportDate) < curTs) ?? null;
}

// ============================================================
// Component
// ============================================================

interface Props {
  view: ViewMode;
  externalRunId?: string;
  onNavigate?: (tab: string) => void;
}

export function DashboardView({ view, externalRunId, onNavigate }: Props) {
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [hasData, setHasData]       = useState(true);
  const [currentValues, setCurrentValues]   = useState<Record<ItemKey, number | null> | null>(null);
  const [previousValues, setPreviousValues] = useState<Record<ItemKey, number | null> | null>(null);
  const [reportDate, setReportDate]         = useState('');
  const [prevDate, setPrevDate]             = useState('');
  const [sourceFilename, setSourceFilename] = useState('');
  const [uploadedAt, setUploadedAt]         = useState('');

  const [lmg, setLmg]       = useState<LmgSummaryResponse | null>(null);
  const [fc7d, setFc7d]     = useState<ForecastResponse | null>(null);
  const [fc1m, setFc1m]     = useState<ForecastResponse | null>(null);
  const [fc3m, setFc3m]     = useState<ForecastResponse | null>(null);

  const [popupItem, setPopupItem]   = useState<ItemKey | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [lcrForecast, setLcrForecast] = useState<LcrForecastResponse | null>(null);
  const [chartPopup, setChartPopup] = useState<'actual' | 'forecast' | null>(null);
  const [forecastDateFilter, setForecastDateFilter] = useState('');

  // ----------------------------------------------------------
  // Data loading
  // ----------------------------------------------------------

  const loadData = useCallback(async (specificRunId?: string) => {
    setLoading(true);
    setError(null);
    try {
      let currentRunId: string;
      let currentDateStr = '';
      let prevRunId: string | null = null;
      let prevDateStr = '';

      if (specificRunId) {
        // Specific run requested (e.g. from History tab)
        currentRunId = specificRunId;
        try {
          const history = await listHistory();
          if (history.items?.length) {
            setHistoryItems(history.items);
            const item = history.items.find((h) => h.runId === specificRunId);
            currentDateStr = item?.reportDate ?? '';
            if (item) { setSourceFilename(item.sourceFilename); setUploadedAt(item.uploadedAt); }
            const prev = findPreviousRun(history.items, currentDateStr);
            if (prev) { prevRunId = prev.runId; prevDateStr = prev.reportDate; }
          }
        } catch { /* proceed */ }
      } else {
        // Default: use fetchLatestRun (sorted by uploaded_at DESC, not report_date)
        const latest = await fetchLatestRun();
        if (!latest.success || !latest.found || !latest.runId) {
          setHasData(false); setLoading(false); return;
        }
        currentRunId = latest.runId;
        currentDateStr = latest.reportDate ?? '';
        setSourceFilename(latest.sourceFilename ?? '');
        setUploadedAt(latest.uploadedAt ?? '');

        // Find previous run from history (date < current report date)
        try {
          const history = await listHistory();
          if (history.items?.length) {
            setHistoryItems(history.items);
            const prev = findPreviousRun(history.items, currentDateStr);
            if (prev) { prevRunId = prev.runId; prevDateStr = prev.reportDate; }
          }
        } catch { /* no previous */ }
      }

      setHasData(true);
      setReportDate(currentDateStr);
      setPrevDate(prevDateStr);

      const [lmgData, f7d, f1m, f3m, lcrFc] = await Promise.all([
        fetchLmgSummary(currentRunId!),
        fetchGapForecast(currentRunId!, '7day'),
        fetchGapForecast(currentRunId!, '1month'),
        fetchGapForecast(currentRunId!, '3month'),
        fetchLcrForecast(currentRunId!),
      ]);

      setLmg(lmgData);
      setFc7d(f7d);
      setFc1m(f1m);
      setFc3m(f3m);
      setLcrForecast(lcrFc);
      setCurrentValues(extractValues(lmgData));

      if (prevRunId) {
        try {
          const prevLmg = await fetchLmgSummary(prevRunId);
          setPreviousValues(extractValues(prevLmg));
        } catch { setPreviousValues(null); }
      } else {
        setPreviousValues(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(externalRunId); }, [externalRunId, loadData]);

  // ----------------------------------------------------------
  // Upload handler
  // ----------------------------------------------------------

  async function handleFile(file: File, date: string) {
    try {
      setLoading(true);
      setShowUpload(false);

      const res = await uploadRaw(file, date);
      const newDate = res.reportDate;

      // Fetch KRI data for the new run
      const [lmgData, f7d, f1m, f3m, lcrFc] = await Promise.all([
        fetchLmgSummary(res.runId),
        fetchGapForecast(res.runId, '7day'),
        fetchGapForecast(res.runId, '1month'),
        fetchGapForecast(res.runId, '3month'),
        fetchLcrForecast(res.runId),
      ]);

      // Find previous from history (date < new upload date)
      let prevRunId: string | null = null;
      let prevDateStr = '';
      try {
        const history = await listHistory();
        if (history.items?.length) {
          setHistoryItems(history.items);
          const prev = findPreviousRun(history.items, newDate);
          if (prev) { prevRunId = prev.runId; prevDateStr = prev.reportDate; }
        }
      } catch { /* no previous */ }

      setLmg(lmgData);
      setFc7d(f7d);
      setFc1m(f1m);
      setFc3m(f3m);
      setLcrForecast(lcrFc);
      setCurrentValues(extractValues(lmgData));
      setReportDate(newDate);
      setPrevDate(prevDateStr);
      setSourceFilename(res.sourceFilename);
      setUploadedAt(new Date().toISOString());
      setHasData(true);

      if (prevRunId) {
        try {
          const prevLmg = await fetchLmgSummary(prevRunId);
          setPreviousValues(extractValues(prevLmg));
        } catch { setPreviousValues(null); }
      } else {
        setPreviousValues(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // ----------------------------------------------------------
  // Render: two-line header cell
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // Render: shared metric card
  // ----------------------------------------------------------

  function renderMetricCard(item: ItemConfig) {
    const curr = currentValues![item.key];
    const prev = previousValues?.[item.key] ?? null;
    const breach = checkBreach(curr, item);
    const diff = curr !== null && prev !== null ? curr - prev : null;

    return (
      <div className="detail-grid">
        <div className="detail-metric">
          <span className="detail-metric-label">Current Day{reportDate ? ` (${reportDate})` : ''}</span>
          <span className="detail-metric-value" style={{ fontSize: '1.6rem', fontWeight: 700 }}>{fmtVal(curr)}</span>
        </div>
        <div className="detail-metric">
          <span className="detail-metric-label">Previous Day{prevDate ? ` (${prevDate})` : ''}</span>
          <span className="detail-metric-value">{fmtVal(prev)}</span>
        </div>
        <div className="detail-metric">
          <span className="detail-metric-label">Daily Change</span>
          <span className="detail-metric-value" style={{ color: changeColor(diff, item.direction) }}>{fmtChange(curr, prev)}</span>
        </div>
        <div className="detail-metric">
          <span className="detail-metric-label">Trigger</span>
          <span className="detail-metric-value mono">{item.triggerDisplay}</span>
        </div>
        <div className="detail-metric">
          <span className="detail-metric-label">Limit</span>
          <span className="detail-metric-value mono">{item.limitDisplay}</span>
        </div>
        <div className="detail-metric">
          <span className="detail-metric-label">Breach</span>
          <span className={`breach-badge breach-badge--${breach.toLowerCase()}`}>{breach}</span>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------
  // Render: forecast table
  // ----------------------------------------------------------

  function renderForecastTable(title: string, data: ForecastResponse) {
    return (
      <ExpandableCard key={title}>
        <h2 className="verify-step-title" style={{ marginBottom: '0.75rem' }}>{title}</h2>
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
              <tr style={{ borderTop: '2px solid var(--color-border)' }}><td style={{ fontWeight: 700 }}>Gap Ratio</td>{data.months.map((m) => <td key={m.from} className="text-right mono" style={{ fontWeight: 700, fontSize: '1rem', color: m.gapRatio !== null && m.gapRatio < m.trigger ? 'var(--color-error)' : 'var(--color-success)' }}>{fmtPct(m.gapRatio)}</td>)}</tr>
              <tr><td style={{ color: '#FF0000', fontWeight: 700 }}>Trigger</td>{data.months.map((m) => <td key={m.from} className="text-right mono" style={{ color: '#FF0000', fontWeight: 700 }}>{Math.round(m.trigger * 100)}%</td>)}</tr>
              <tr><td>(-) Shortfall</td>{data.months.map((m) => <td key={m.from} className="text-right mono">{m.shortfall.toLocaleString()}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </ExpandableCard>
    );
  }

  // ----------------------------------------------------------
  // Render: summary row
  // ----------------------------------------------------------

  function renderItemRow(item: ItemConfig) {
    const curr = currentValues![item.key];
    const prev = previousValues?.[item.key] ?? null;
    const breach = checkBreach(curr, item);
    const diff = curr !== null && prev !== null ? curr - prev : null;

    return (
      <tr key={item.key} className="summary-row" onClick={() => setPopupItem(item.key)}>
        <td className="summary-item-cell">
          <span className="summary-item-chevron">{'\u203A'}</span>
          <span className="summary-item-label" style={{ whiteSpace: 'pre-line' }}>{item.label}</span>
        </td>
        <td className="text-right mono summary-trigger-limit">{item.triggerDisplay}</td>
        <td className="text-right mono summary-trigger-limit">{item.limitDisplay}</td>
        <td className="text-right mono summary-num-prev">{fmtVal(prev)}</td>
        <td className="text-right mono summary-num-current current-day-col">
          {fmtVal(curr)}
        </td>
        <td className="text-right mono summary-num-change" style={{ color: changeColor(diff, item.direction) }}>
          {fmtChange(curr, prev)}
        </td>
        <td style={{ textAlign: 'center' }}>
          <span className={`breach-badge breach-badge--${breach.toLowerCase()}`}>{breach}</span>
        </td>
      </tr>
    );
  }

  // ----------------------------------------------------------
  // Render: summary table
  // ----------------------------------------------------------

  function renderSummaryTable() {
    if (!currentValues) return null;

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
                {thTwoLine('Previous Day', prevDate)}
                {thTwoLine('Current Day', reportDate, 'current-day-col current-day-col--top')}
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

        {/* Footnotes */}
        <ul className="summary-footnotes">
          <li>In the event of a Trigger breach, it must be reported to the RMC.</li>
          <li>In the event of a Limit breach, it must be reported to APRA and SOOA.</li>
          <li>Even if the 3M Liquidity Ratio falls to 40% or below, it is not considered a breach provided the monthly average LCR remains at 80% or higher.</li>
        </ul>
      </div>
    );
  }

  // ----------------------------------------------------------
  // LCR Trend chart data
  // ----------------------------------------------------------

  const LCR_TRIGGER = 50.0;
  const LCR_LIMIT   = 45.0;

  // Deduplicate: keep only the latest-uploaded entry per report_date
  const lcrChartData = useMemo(() => {
    const byDate = new Map<string, HistoryItem>();
    for (const h of historyItems) {
      if (h.lcrRatio === null) continue;
      const existing = byDate.get(h.reportDate);
      if (!existing || new Date(h.uploadedAt).getTime() > new Date(existing.uploadedAt).getTime()) {
        byDate.set(h.reportDate, h);
      }
    }
    return Array.from(byDate.values())
      .map((h) => ({ date: h.reportDate, lcr: h.lcrRatio as number }))
      .sort((a, b) => toTs(a.date) - toTs(b.date));
  }, [historyItems]);

  const lcrMin = useMemo(() => {
    if (!lcrChartData.length) return null;
    return lcrChartData.reduce((min, d) => d.lcr < min.lcr ? d : min, lcrChartData[0]);
  }, [lcrChartData]);

  function renderLcrTrendChart() {
    if (!lcrChartData.length) return null;

    const allVals = [...lcrChartData.map((d) => d.lcr), LCR_TRIGGER, LCR_LIMIT];
    const yMin = Math.floor(Math.min(...allVals) / 5) * 5 - 5;
    const yMax = Math.ceil(Math.max(...allVals) / 10) * 10 + 10;

    // Custom dot: color by zone
    const renderDot = (props: any) => {
      const { cx, cy, payload } = props;
      if (cx == null || cy == null) return null;
      const v = payload.lcr;
      let fill = 'var(--color-primary)';
      if (v <= LCR_LIMIT)       fill = '#dc2626';
      else if (v <= LCR_TRIGGER) fill = '#f59e0b';
      return <Dot cx={cx} cy={cy} r={5} fill={fill} stroke="#fff" strokeWidth={1.5} />;
    };

    const minColor = lcrMin
      ? lcrMin.lcr <= LCR_LIMIT ? '#dc2626' : lcrMin.lcr <= LCR_TRIGGER ? '#f59e0b' : 'var(--color-primary)'
      : 'var(--color-text)';

    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
        {/* Left: LCR Trend chart */}
        <div className="card" style={{ margin: 0, cursor: 'pointer' }} onClick={() => setChartPopup('actual')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 className="verify-step-title" style={{ margin: 0 }}>LCR Trend</h2>
            <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>Unit: %</span>
          </div>

          {/* Minimum LCR highlight box */}
          {lcrMin && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.75rem',
              background: `${minColor}0D`, border: `1px solid ${minColor}33`,
              borderRadius: '8px', padding: '0.5rem 1rem', marginBottom: '1rem',
            }}>
              <div>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }}>Minimum LCR</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: minColor, lineHeight: 1.1 }}>{lcrMin.lcr.toFixed(2)}%</div>
              </div>
              <div style={{ width: 1, height: 36, background: `${minColor}33` }} />
              <div>
                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }}>Recorded on</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>{lcrMin.date}</div>
              </div>
            </div>
          )}

          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={lcrChartData} margin={{ top: 10, right: 110, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-border)' }}
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-border)' }}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                contentStyle={{ fontSize: '0.85rem', borderRadius: '6px', border: '1px solid var(--color-border)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                formatter={(value: any) => [`${Number(value).toFixed(2)}%`, 'LCR']}
                labelFormatter={(label: any) => `Date: ${label}`}
              />
              <ReferenceLine y={LCR_TRIGGER} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `Trigger ${LCR_TRIGGER}%`, position: 'right', fill: '#f59e0b', fontSize: 11, fontWeight: 600 }} />
              <ReferenceLine y={LCR_LIMIT}   stroke="#dc2626" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `Limit ${LCR_LIMIT}%`,     position: 'right', fill: '#dc2626', fontSize: 11, fontWeight: 600 }} />
              <Line
                type="monotone"
                dataKey="lcr"
                stroke="var(--color-primary)"
                strokeWidth={2.5}
                dot={renderDot}
                activeDot={{ r: 7, stroke: 'var(--color-primary)', strokeWidth: 2, fill: '#fff' }}
              />
            </LineChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            <span><span style={{ display: 'inline-block', width: 12, height: 3, background: 'var(--color-primary)', marginRight: 4, verticalAlign: 'middle' }} />Normal</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 3, background: '#f59e0b', marginRight: 4, verticalAlign: 'middle' }} />Trigger (&le;{LCR_TRIGGER}%)</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 3, background: '#dc2626', marginRight: 4, verticalAlign: 'middle' }} />Limit (&le;{LCR_LIMIT}%)</span>
          </div>
        </div>

        {/* Right: Forecast LCR Trend chart */}
        {renderForecastLcrChart(false)}
      </div>
    );
  }

  // ----------------------------------------------------------
  // Forecast LCR Trend chart (right side)
  // ----------------------------------------------------------

  const fcLowest = useMemo(() => {
    if (!lcrForecast?.forecast.length) return null;
    const valid = lcrForecast.forecast.filter((m) => m.lcr !== null);
    if (!valid.length) return null;
    return valid.reduce((min, m) => (m.lcr! < min.lcr!) ? m : min, valid[0]);
  }, [lcrForecast]);

  const fcTriggerBreach = useMemo(() => {
    if (!lcrForecast?.forecast.length) return false;
    return lcrForecast.forecast.some((m) => m.lcr !== null && m.lcr <= LCR_TRIGGER);
  }, [lcrForecast]);

  // fcLimitBreach removed — Forecast chart now shows Trigger line only

  function renderForecastLcrChart(isPopup: boolean) {
    if (!lcrForecast?.forecast.length) {
      return (
        <div className="card" style={{ margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem', minHeight: 300 }}>
          <span style={{ opacity: 0.5 }}>No forecast data available</span>
        </div>
      );
    }

    const data = lcrForecast.forecast.map((m) => ({ date: m.date, label: m.label, lcr: m.lcr }));
    const allVals = [...data.map((d) => d.lcr ?? 0), LCR_TRIGGER];
    const yMin = Math.floor(Math.min(...allVals) / 5) * 5 - 5;
    const yMax = Math.ceil(Math.max(...allVals) / 10) * 10 + 10;

    const renderDotFc = (props: any) => {
      const { cx, cy, payload } = props;
      if (cx == null || cy == null || payload.lcr == null) return null;
      const v = payload.lcr;
      let fill = 'var(--color-primary)';
      if (v <= LCR_TRIGGER) fill = '#f59e0b';
      return <Dot cx={cx} cy={cy} r={5} fill={fill} stroke="#fff" strokeWidth={1.5} />;
    };

    const lowestColor = fcLowest && fcLowest.lcr !== null
      ? fcLowest.lcr <= LCR_TRIGGER ? '#f59e0b' : 'var(--color-primary)'
      : 'var(--color-text)';

    const chartHeight = isPopup ? 400 : 300;

    const chartContent = (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h2 className="verify-step-title" style={{ margin: 0, fontSize: isPopup ? '1.1rem' : undefined }}>Forecast LCR Trend</h2>
          <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>Unit: %</span>
        </div>

        {/* Info badges row */}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          {fcLowest && fcLowest.lcr !== null && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: `${lowestColor}0D`, border: `1px solid ${lowestColor}33`, borderRadius: '6px', padding: '0.3rem 0.7rem', fontSize: '0.78rem' }}>
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Lowest:</span>
              <span style={{ fontWeight: 800, color: lowestColor }}>{fcLowest.lcr.toFixed(2)}%</span>
              <span style={{ color: '#1e293b', fontWeight: 600 }}>{fcLowest.date}</span>
            </div>
          )}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: fcTriggerBreach ? '#fef2f211' : '#f0fdf40D', border: `1px solid ${fcTriggerBreach ? '#dc262633' : '#16a34a33'}`, borderRadius: '6px', padding: '0.3rem 0.7rem', fontSize: '0.78rem' }}>
            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Trigger Breach:</span>
            <span style={{ fontWeight: 700, color: fcTriggerBreach ? '#dc2626' : '#16a34a' }}>{fcTriggerBreach ? 'Yes' : 'No'}</span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={chartHeight}>
          <LineChart data={data} margin={{ top: 10, right: 100, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} />
            <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip
              contentStyle={{ fontSize: '0.85rem', borderRadius: '6px', border: '1px solid var(--color-border)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
              formatter={(value: any) => [value != null ? `${Number(value).toFixed(2)}%` : 'N/A', 'Forecast LCR']}
              labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.date ? `Date: ${payload[0].payload.date}` : ''}
            />
            <ReferenceLine y={LCR_TRIGGER} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `Trigger ${LCR_TRIGGER}%`, position: 'right', fill: '#f59e0b', fontSize: 11, fontWeight: 600 }} />
            <Line type="monotone" dataKey="lcr" stroke="var(--color-primary)" strokeWidth={2.5} dot={renderDotFc} activeDot={{ r: 7, stroke: 'var(--color-primary)', strokeWidth: 2, fill: '#fff' }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </>
    );

    if (isPopup) return chartContent;

    return (
      <div className="card" style={{ margin: 0, cursor: 'pointer' }} onClick={() => setChartPopup('forecast')}>
        {chartContent}
      </div>
    );
  }

  // ----------------------------------------------------------
  // Chart popup (enlarged view)
  // ----------------------------------------------------------

  function renderChartPopup() {
    if (!chartPopup) return null;
    return (
      <div className="modal-overlay" onClick={() => setChartPopup(null)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '90vw', width: '1100px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
            <button className="btn btn--sm btn--ghost" onClick={() => setChartPopup(null)} aria-label="Close">{'\u2715'}</button>
          </div>
          {chartPopup === 'actual' && (() => {
            if (!lcrChartData.length) return null;
            const allVals = [...lcrChartData.map((d) => d.lcr), LCR_TRIGGER, LCR_LIMIT];
            const yMinP = Math.floor(Math.min(...allVals) / 5) * 5 - 5;
            const yMaxP = Math.ceil(Math.max(...allVals) / 10) * 10 + 10;
            const renderDotP = (props: any) => {
              const { cx, cy, payload } = props;
              if (cx == null || cy == null) return null;
              const v = payload.lcr;
              let fill = 'var(--color-primary)';
              if (v <= LCR_LIMIT) fill = '#dc2626';
              else if (v <= LCR_TRIGGER) fill = '#f59e0b';
              return <Dot cx={cx} cy={cy} r={5} fill={fill} stroke="#fff" strokeWidth={1.5} />;
            };
            return (
              <>
                <h2 className="verify-step-title" style={{ marginBottom: '1rem' }}>LCR Trend (Actual)</h2>
                <ResponsiveContainer width="100%" height={450}>
                  <LineChart data={lcrChartData} margin={{ top: 10, right: 110, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} />
                    <YAxis domain={[yMinP, yMaxP]} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip contentStyle={{ fontSize: '0.85rem', borderRadius: '6px', border: '1px solid var(--color-border)' }} formatter={(value: any) => [`${Number(value).toFixed(2)}%`, 'LCR']} labelFormatter={(label: any) => `Date: ${label}`} />
                    <ReferenceLine y={LCR_TRIGGER} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `Trigger ${LCR_TRIGGER}%`, position: 'right', fill: '#f59e0b', fontSize: 11, fontWeight: 600 }} />
                    <ReferenceLine y={LCR_LIMIT} stroke="#dc2626" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `Limit ${LCR_LIMIT}%`, position: 'right', fill: '#dc2626', fontSize: 11, fontWeight: 600 }} />
                    <Line type="monotone" dataKey="lcr" stroke="var(--color-primary)" strokeWidth={2.5} dot={renderDotP} activeDot={{ r: 7, stroke: 'var(--color-primary)', strokeWidth: 2, fill: '#fff' }} />
                  </LineChart>
                </ResponsiveContainer>
              </>
            );
          })()}
          {chartPopup === 'forecast' && renderForecastLcrChart(true)}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------
  // Forecast table (8-month LCR projection)
  // ----------------------------------------------------------

  const [fcPage, setFcPage] = useState(0);

  function renderLcrForecastTable() {
    if (!lcrForecast?.forecast.length) return null;
    const fc = lcrForecast.forecast;

    // Date search takes priority over pagination
    const isSearching = forecastDateFilter.length > 0;
    const filtered = isSearching
      ? fc.filter((m) => m.date.includes(forecastDateFilter))
      : [fc[fcPage]].filter(Boolean); // show 1 month per page

    const currentMonth = fc[fcPage];
    const totalPages = fc.length; // 8 pages (1 per month)

    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 className="verify-step-title" style={{ margin: 0 }}>8-Month LCR Forecast</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="text"
              placeholder="Search by date..."
              value={forecastDateFilter}
              onChange={(e) => { setForecastDateFilter(e.target.value); setFcPage(0); }}
              style={{ padding: '0.35rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', width: '160px' }}
            />
            {forecastDateFilter && <button className="btn btn--ghost" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setForecastDateFilter('')}>Clear</button>}
          </div>
        </div>

        {/* Month pagination (hidden when searching) */}
        {!isSearching && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.82rem' }}>
            <button className="btn btn--ghost" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} disabled={fcPage === 0} onClick={() => setFcPage(fcPage - 1)}>&laquo; Prev</button>
            {fc.map((m, i) => (
              <button
                key={m.date}
                className={`btn ${fcPage === i ? 'btn--primary' : 'btn--ghost'}`}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', minWidth: '28px' }}
                onClick={() => setFcPage(i)}
              >
                {m.label}
              </button>
            ))}
            <button className="btn btn--ghost" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} disabled={fcPage >= totalPages - 1} onClick={() => setFcPage(fcPage + 1)}>Next &raquo;</button>
          </div>
        )}

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="text-right">HQLA</th>
                <th className="text-right">Total Outflow</th>
                <th className="text-right">Total Inflow</th>
                <th className="text-right" style={{ fontWeight: 700 }}>LCR (%)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const lcrColor = m.lcr !== null
                  ? m.lcr <= LCR_TRIGGER ? '#f59e0b' : 'var(--color-success)'
                  : undefined;
                return (
                  <tr key={m.date}>
                    <td style={{ fontWeight: 600 }}>{m.date}</td>
                    <td className="text-right mono">{m.hqla.toLocaleString()}</td>
                    <td className="text-right mono">{m.totalOutflow.toLocaleString()}</td>
                    <td className="text-right mono">{m.totalInflow.toLocaleString()}</td>
                    <td className="text-right mono" style={{ fontWeight: 700, color: lcrColor }}>{m.lcr !== null ? m.lcr.toFixed(2) + '%' : 'N/A'}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '1rem' }}>No results for &ldquo;{forecastDateFilter}&rdquo;</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {!isSearching && currentMonth && (
          <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            Month {fcPage + 1} of {totalPages} &mdash; Window: {currentMonth.date} (+30 days)
          </div>
        )}
      </div>
    );
  }

  // ----------------------------------------------------------
  // Detail views
  // ----------------------------------------------------------

  function renderLcrDetail() {
    const item = ITEMS.find((i) => i.key === 'lcr')!;
    const curr = currentValues?.[item.key] ?? null;
    const prev = previousValues?.[item.key] ?? null;
    const breach = checkBreach(curr, item);

    return (
      <>
        {renderLcrTrendChart()}

        {/* LCR Detail — single row inline */}
        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <h2 className="verify-step-title" style={{ margin: 0 }}>LCR Detail</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Today{reportDate ? ` (${reportDate})` : ''}</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)' }}>{fmtVal(curr)}</div>
              </div>
              <div style={{ width: 1, height: 36, background: 'var(--color-border)' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Previous{prevDate ? ` (${prevDate})` : ''}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{fmtVal(prev)}</div>
              </div>
              <div style={{ width: 1, height: 36, background: 'var(--color-border)' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Trigger</div>
                <div className="mono" style={{ fontSize: '1rem', fontWeight: 700, color: '#dc2626' }}>{item.triggerDisplay}</div>
              </div>
              <div style={{ width: 1, height: 36, background: 'var(--color-border)' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Limit</div>
                <div className="mono" style={{ fontSize: '1rem', fontWeight: 700, color: '#dc2626' }}>{item.limitDisplay}</div>
              </div>
              <div style={{ width: 1, height: 36, background: 'var(--color-border)' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Breach</div>
                <span className={`breach-badge breach-badge--${breach.toLowerCase()}`}>{breach}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 8-Month Forecast Table */}
        {renderLcrForecastTable()}

        {/* Chart enlarged popup */}
        {renderChartPopup()}
      </>
    );
  }

  function render3mDetail() {
    const item = ITEMS.find((i) => i.key === '3m_lr')!;
    return (
      <div className="card">
        <h2 className="verify-step-title" style={{ marginBottom: '1rem' }}>3M Liquidity Ratio Detail</h2>
        {renderMetricCard(item)}
        {lmg && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-text-muted)' }}>Liquidity Gap Summary</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr><th></th><th className="text-right">Cum. Asset</th><th className="text-right">Cum. Liability</th><th className="text-right">Gap</th><th className="text-right">Total Asset</th><th className="text-right">Ratio</th></tr></thead>
                <tbody>
                  {(['7D', '1M', '3M'] as const).map((k) => { const s = lmg.summary[k]; return (
                    <tr key={k}><td style={{ fontWeight: 600 }}>{k}</td><td className="text-right mono">{s.cumAsset.toLocaleString()}</td><td className="text-right mono">{s.cumLiab.toLocaleString()}</td><td className="text-right mono" style={{ fontWeight: 700 }}>{s.gap.toLocaleString()}</td><td className="text-right mono">{s.totalAsset.toLocaleString()}</td><td className="text-right mono" style={{ fontWeight: 700, color: s.ratio !== null && s.ratio < s.trigger ? 'var(--color-error)' : 'var(--color-success)' }}>{fmtPct(s.ratio)}</td></tr>
                  ); })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  function render12mDetail() {
    const item = ITEMS.find((i) => i.key === '12m_ir')!;
    return (
      <div className="card">
        <h2 className="verify-step-title" style={{ marginBottom: '1rem' }}>12M Interest Rate Sensitive Gap Ratio</h2>
        {renderMetricCard(item)}
        <div style={{ marginTop: '1.5rem', padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderRadius: 'var(--radius, 6px)' }}>
          <p style={{ fontSize: '0.9rem' }}>Calculation formula will be provided in a future update.</p>
        </div>
      </div>
    );
  }

  function renderGapDetail() {
    return (
      <>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 className="verify-step-title">GAP Summary</h2>
            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>(Unit: %, %p)</span>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>Period</th><th className="text-right">Trigger</th><th className="text-right">Limit</th>{thTwoLine('Previous Day', prevDate)}{thTwoLine('Current Day', reportDate)}<th className="text-right">Daily Change</th><th style={{ textAlign: 'center' }}>Breach</th></tr></thead>
              <tbody>
                {GAP_ITEMS.map((item) => { const curr = currentValues![item.key]; const prev = previousValues?.[item.key] ?? null; const breach = checkBreach(curr, item); const diff = curr !== null && prev !== null ? curr - prev : null; return (
                  <tr key={item.key}><td style={{ fontWeight: 600 }}>{item.label}</td><td className="text-right mono">{item.triggerDisplay}</td><td className="text-right mono">{item.limitDisplay}</td><td className="text-right mono" style={{ fontWeight: 600 }}>{fmtVal(prev)}</td><td className="text-right mono" style={{ fontWeight: 700 }}>{fmtVal(curr)}</td><td className="text-right mono" style={{ fontWeight: 600, color: changeColor(diff, item.direction) }}>{fmtChange(curr, prev)}</td><td style={{ textAlign: 'center' }}><span className={`breach-badge breach-badge--${breach.toLowerCase()}`}>{breach}</span></td></tr>
                ); })}
              </tbody>
            </table>
          </div>
        </div>
        {fc7d && renderForecastTable('7-Day Liquidity Gap Ratio', fc7d)}
        {fc1m && renderForecastTable('1-Month Liquidity Gap Ratio', fc1m)}
        {fc3m && renderForecastTable('3-Month Liquidity Gap Ratio', fc3m)}
      </>
    );
  }

  // ----------------------------------------------------------
  // Popup modal — reuses exact same tables from VerifyView
  // ----------------------------------------------------------

  /**
   * KRI Table — exact copy of VerifyView lines 227-290.
   * Used by both LCR and 3M Liquidity Ratio popups.
   */
  function renderKriTable() {
    if (!lmg) return null;
    return (
      <>
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
                const row = lmg.kri[k];
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
                    <td className="text-right mono" style={{ color: '#FF0000', fontWeight: 700 }}>{fmtPct(row.trigger)}</td>
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
                <td className="text-right mono" style={{ fontWeight: 700, color: '#FF0000', fontSize: '1rem' }}>
                  {lmg.lcrPercent !== null ? fmtPct(lmg.lcrPercent) : 'N/A'}
                </td>
                <td className="text-right mono" style={{ fontWeight: 700, color: '#FF0000', fontSize: '1rem' }}>
                  {fmtPct(lmg.ratio3MLR)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    );
  }

  /**
   * Forecast table for popup — exact copy of VerifyView renderForecastTable (lines 308-387).
   * Used by 7D/1M/3M GAP popups.
   */
  function renderPopupForecastTable(data: ForecastResponse) {
    return (
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
              <td style={{ color: '#FF0000', fontWeight: 700 }}>Trigger</td>
              {data.months.map((m) => (
                <td key={m.from} className="text-right mono" style={{ color: '#FF0000', fontWeight: 700 }}>{Math.round(m.trigger * 100)}%</td>
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
    );
  }

  function renderPopup() {
    const item = ITEMS.find((i) => i.key === popupItem);
    if (!item || !currentValues) return null;

    const gapFcMap: Record<string, { data: ForecastResponse | null; title: string }> = {
      '7d_gap': { data: fc7d, title: '7-Day Liquidity Gap Ratio' },
      '1m_gap': { data: fc1m, title: '1-Month Liquidity Gap Ratio' },
      '3m_gap': { data: fc3m, title: '3-Month Liquidity Gap Ratio' },
    };

    const popupTitle = item.label.replace('\n', ' ');
    const isGap = item.section === 'gap';
    const isKri = item.key === 'lcr' || item.key === '3m_lr';

    return (
      <div className="modal-overlay" onClick={() => setPopupItem(null)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: isGap ? 'calc(100vw - 4rem)' : '780px', width: isGap ? '95vw' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>{isKri ? 'Key Risk Indicators' : (isGap ? gapFcMap[item.key].title : popupTitle)}</h3>
            <button className="btn btn--sm btn--ghost" onClick={() => setPopupItem(null)} aria-label="Close">{'\u2715'}</button>
          </div>

          {/* LCR / 3M Liquidity → KRI Table (same as VerifyView) */}
          {isKri && renderKriTable()}

          {/* 12M Interest Rate → placeholder */}
          {item.key === '12m_ir' && (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderRadius: 'var(--radius, 6px)' }}>
              <p style={{ fontSize: '0.9rem' }}>Calculation formula will be provided in a future update.</p>
            </div>
          )}

          {/* GAP → Forecast Table (same as VerifyView renderForecastTable) */}
          {isGap && gapFcMap[item.key].data && renderPopupForecastTable(gapFcMap[item.key].data!)}
          {isGap && !gapFcMap[item.key].data && (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '1rem' }}>No forecast data available.</p>
          )}

          {/* More Details — LCR only */}
          {item.key === 'lcr' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button className="btn btn--primary" onClick={() => { setPopupItem(null); onNavigate?.(item.detailTab); }}>
                More Details {'\u2192'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------
  // Main render
  // ----------------------------------------------------------

  if (loading) return (<div className="verify-view"><div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}><div className="spinner" /><p style={{ marginTop: '1rem', color: 'var(--color-text-muted)' }}>Loading data...</p></div></div>);
  if (error) return (<div className="verify-view"><div className="card card--error" role="alert"><h2 className="card__title card__title--error">Error</h2><p className="error-message">{error}</p><button className="btn btn--primary" onClick={() => { setError(null); loadData(); }} style={{ marginTop: '1rem' }}>Retry</button></div></div>);
  if (!hasData || !currentValues) return (<div className="verify-view"><div className="card" style={{ textAlign: 'center', padding: '2rem' }}><p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>No reports found. Upload a file to get started.</p><UploadWithDate onUpload={handleFile} isLoading={false} /></div></div>);

  return (
    <div className="verify-view">
      <div className="card" style={{ padding: '1rem 1.25rem' }}>
        {!showUpload ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Report Date</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-primary)' }}>{reportDate}</span>
              </div>
              {sourceFilename && <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{sourceFilename}</span>}
              {uploadedAt && <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{new Date(uploadedAt).toLocaleString()}</span>}
            </div>
            {view === 'dashboard' && <button className="btn btn--primary" style={{ whiteSpace: 'nowrap', padding: '0.5rem 1.25rem', fontSize: '0.9rem' }} onClick={() => setShowUpload(true)}>Upload New File</button>}
          </div>
        ) : (
          <div>
            <UploadWithDate onUpload={handleFile} isLoading={false} />
            <div style={{ textAlign: 'right', marginTop: '0.5rem' }}><button className="btn btn--ghost" onClick={() => setShowUpload(false)}>Cancel</button></div>
          </div>
        )}
      </div>

      {view === 'dashboard' && renderSummaryTable()}
      {view === 'lcr'      && renderLcrDetail()}
      {view === '3m_lr'    && render3mDetail()}
      {view === '12m_ir'   && render12mDetail()}
      {view === 'gap'      && renderGapDetail()}
      {popupItem !== null  && renderPopup()}
    </div>
  );
}
