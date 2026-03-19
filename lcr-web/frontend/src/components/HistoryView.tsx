/**
 * HistoryView
 *
 * Date-based report viewer with calendar date picker and pagination (5 dates/page).
 * Selecting a date loads and displays that date's results inline
 * (using the latest upload for that date).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ExpandableCard } from './ExpandableCard';
import {
  listHistory,
  fetchLmgSummary,
  fetchGapForecast,
  HistoryItem,
  LmgSummaryResponse,
  ForecastResponse,
} from '../services/api';

interface Props {
  onSelectRun: (runId: string) => void;
}

type LoadedReport = {
  item: HistoryItem;
  lmg: LmgSummaryResponse;
  fc7d: ForecastResponse;
  fc1m: ForecastResponse;
  fc3m: ForecastResponse;
};

const PAGE_SIZE = 5;

function fmtPct(v: number | null): string {
  if (v === null) return 'N/A';
  return (v * 100).toFixed(2) + '%';
}

export function HistoryView({ onSelectRun: _onSelectRun }: Props) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loadingDate, setLoadingDate] = useState<string | null>(null);
  const [report, setReport] = useState<LoadedReport | null>(null);
  const [dateFilter, setDateFilter] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    listHistory()
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load history'))
      .finally(() => setLoading(false));
  }, []);

  // Deduplicate: keep only the latest (first) item per date
  const dates = useMemo(() => {
    const map = new Map<string, HistoryItem>();
    for (const item of items) {
      if (!map.has(item.reportDate)) map.set(item.reportDate, item);
    }
    return Array.from(map.values());
  }, [items]);

  // Filter by selected calendar date
  const filtered = useMemo(() => {
    if (!dateFilter) return dates;
    return dates.filter((d) => d.reportDate === dateFilter);
  }, [dates, dateFilter]);

  // Reset page when filter changes
  useEffect(() => { setPage(0); }, [dateFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const loadReport = useCallback(async (item: HistoryItem) => {
    setLoadingDate(item.reportDate);
    setSelectedDate(item.reportDate);
    setReport(null);
    try {
      const [lmg, fc7d, fc1m, fc3m] = await Promise.all([
        fetchLmgSummary(item.runId),
        fetchGapForecast(item.runId, '7day'),
        fetchGapForecast(item.runId, '1month'),
        fetchGapForecast(item.runId, '3month'),
      ]);
      setReport({ item, lmg, fc7d, fc1m, fc3m });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load report');
    } finally {
      setLoadingDate(null);
    }
  }, []);

  return (
    <div className="verify-view">
      {/* Date selector with calendar picker + pagination */}
      <section className="card" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2 className="verify-step-title" style={{ margin: 0 }}>Report History</h2>

          {/* Calendar date picker */}
          {!loading && dates.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>
                Find Date:
              </label>
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                style={{
                  padding: '0.35rem 0.6rem',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontFamily: 'var(--font-mono)',
                  width: '170px',
                }}
              />
              {dateFilter && (
                <button
                  className="btn btn--ghost"
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  onClick={() => setDateFilter('')}
                >
                  Show All
                </button>
              )}
            </div>
          )}
        </div>

        {loading && <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>}

        {error && (
          <p style={{ color: 'var(--color-error)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>
        )}

        {!loading && dates.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)' }}>
            No reports yet. Upload a file via the Forecast tab to get started.
          </p>
        )}

        {!loading && dates.length > 0 && filtered.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)', padding: '1rem 0' }}>
            No report found for {dateFilter}.
          </p>
        )}

        {pageItems.length > 0 && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Report Date</th>
                    <th>Source File</th>
                    <th className="text-right">LCR %</th>
                    <th className="text-right">3M Liquidity Ratio</th>
                    <th>Status</th>
                    <th>Uploaded</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item) => {
                    const isSelected = selectedDate === item.reportDate;
                    const isLoading = loadingDate === item.reportDate;
                    return (
                      <tr
                        key={item.runId}
                        style={{
                          cursor: 'pointer',
                          background: isSelected ? '#eff6ff' : undefined,
                        }}
                        onClick={() => loadReport(item)}
                      >
                        <td>
                          <span style={{ color: 'var(--color-primary)', fontWeight: 700, fontSize: '0.95rem' }}>
                            {item.reportDate}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.sourceFilename || '—'}
                        </td>
                        <td className="text-right mono" style={{ fontWeight: 700 }}>
                          {item.lcrRatio !== null
                            ? <span style={{ color: item.lcrRatio >= 100 ? 'var(--color-success)' : 'var(--color-error)' }}>{item.lcrRatio.toFixed(2)}%</span>
                            : <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                          }
                        </td>
                        <td className="text-right mono" style={{ fontWeight: 700 }}>
                          {item.ratio3mLr !== null
                            ? <span>{(item.ratio3mLr * 100).toFixed(2)}%</span>
                            : <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                          }
                        </td>
                        <td>
                          <span style={{
                            padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                            background: item.status === 'complete' ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                            color: item.status === 'complete' ? 'var(--color-success)' : 'var(--color-warning)',
                          }}>
                            {item.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                          {new Date(item.uploadedAt).toLocaleString()}
                        </td>
                        <td>
                          {isLoading ? (
                            <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                          ) : (
                            <span style={{ color: isSelected ? 'var(--color-primary)' : 'var(--color-text-muted)', fontSize: '0.8rem', fontWeight: isSelected ? 700 : 400 }}>
                              {isSelected ? 'Selected' : 'View'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '0.75rem', marginTop: '0.75rem', fontSize: '0.85rem',
              }}>
                <button
                  className="btn btn--ghost"
                  style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i}
                    className={`btn ${page === i ? 'btn--primary' : 'btn--ghost'}`}
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', minWidth: '32px' }}
                    onClick={() => setPage(i)}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  className="btn btn--ghost"
                  style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                  {filtered.length} date{filtered.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {/* Loading indicator */}
      {loadingDate && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner" />
          <p style={{ marginTop: '0.75rem', color: 'var(--color-text-muted)' }}>Loading report for {loadingDate}...</p>
        </div>
      )}

      {/* Loaded report results — inline */}
      {report && !loadingDate && (
        <>
          <ExpandableCard>
            <h2 className="verify-step-title" style={{ marginBottom: '0.75rem' }}>
              Key Risk Indicators — {report.lmg.reportDate}
            </h2>

            <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
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
                    const row = report.lmg.kri[k];
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
                      {report.lmg.lcrPercent !== null ? fmtPct(report.lmg.lcrPercent) : 'N/A'}
                    </td>
                    <td className="text-right mono" style={{ fontWeight: 700, color: '#FF0000', fontSize: '1rem' }}>
                      {fmtPct(report.lmg.ratio3MLR)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </ExpandableCard>

          {renderForecastTable('7-Day Liquidity Gap Ratio', report.fc7d)}
          {renderForecastTable('1-Month Liquidity Gap Ratio', report.fc1m)}
          {renderForecastTable('3-Month Liquidity Gap Ratio', report.fc3m)}
        </>
      )}
    </div>
  );
}

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
    </ExpandableCard>
  );
}
