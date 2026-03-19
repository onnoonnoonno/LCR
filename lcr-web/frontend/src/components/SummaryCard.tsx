/**
 * SummaryCard — reproduces the Excel Summary sheet KRI view.
 *
 * Primary metrics (top-of-page, matching workbook Summary rows 4-9):
 *   LCR % | 3M Liquidity Ratio % | 7D Gap | 1M Gap | 3M Gap
 *
 * Secondary section: 30-day cash flow components.
 */

import { ReportSummary } from '../services/api';

interface Props {
  summary: ReportSummary;
  sourceFilename?: string;
  onBack?: () => void;
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtPct(n: number | null, decimals = 2): string {
  if (n === null) return '—';
  return `${n.toFixed(decimals)}%`;
}

interface KriItemProps {
  label: string;
  value: string;
  pass?: boolean | null;
  passLabel?: string;
  failLabel?: string;
  sub?: string;
}

function KriItem({ label, value, pass, passLabel, failLabel, sub }: KriItemProps) {
  const color =
    pass === true  ? 'var(--color-success)' :
    pass === false ? 'var(--color-error)'   : 'var(--color-text)';

  return (
    <div className="kri-item">
      <span className="kri-label">{label}</span>
      <span className="kri-value" style={{ color }}>{value}</span>
      {pass !== undefined && pass !== null && (
        <span className="kri-status" style={{ color }}>
          {pass ? (passLabel ?? 'Pass') : (failLabel ?? 'Fail')}
        </span>
      )}
      {sub && <span className="kri-sub">{sub}</span>}
    </div>
  );
}

export function SummaryCard({ summary, sourceFilename, onBack }: Props) {
  const lcr     = summary.lcrRatio;
  const lr3m    = summary.ratio3mLr;
  const gap7d   = summary.ratio7d;
  const gap1m   = summary.ratio1m;
  const gap3m   = summary.ratio3m;

  const lcrPass  = lcr  !== null ? lcr  >= 100 : null;
  const lr3mPass = lr3m !== null ? lr3m >= 100 : null;
  // Gap ratios: positive = surplus, negative = deficit. No hard pass/fail displayed.

  return (
    <section className="card" aria-label="LCR Summary">

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h2 className="card__title" style={{ marginBottom: '0.25rem' }}>
            LCR Report — {summary.reportDate}
          </h2>
          {sourceFilename && (
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{sourceFilename}</p>
          )}
        </div>
        {onBack && (
          <button className="btn btn--ghost" onClick={onBack} style={{ flexShrink: 0 }}>
            Back
          </button>
        )}
      </div>

      {/* ── KRI panel (matches workbook Summary rows 4-9) ── */}
      <div className="summary-section">
        <h3 className="summary-section__title">Key Risk Indicators</h3>
        <div className="kri-grid">

          <KriItem
            label="LCR Ratio"
            value={fmtPct(lcr)}
            pass={lcrPass}
            passLabel="≥ 100% minimum"
            failLabel="Below 100% minimum"
          />

          <KriItem
            label="3M Liquidity Ratio"
            value={fmtPct(lr3m)}
            pass={lr3mPass}
            passLabel="≥ 100%"
            failLabel="Below 100%"
            sub="Assets / Liabilities (O/N–3M)"
          />

          <KriItem
            label="7-Day Gap Ratio"
            value={fmtPct(gap7d)}
            pass={gap7d !== null ? gap7d >= 0 : null}
            passLabel="Surplus"
            failLabel="Deficit"
            sub="(Cum. Assets − Cum. Liab.) / Total Assets"
          />

          <KriItem
            label="1-Month Gap Ratio"
            value={fmtPct(gap1m)}
            pass={gap1m !== null ? gap1m >= 0 : null}
            passLabel="Surplus"
            failLabel="Deficit"
            sub="(Cum. Assets − Cum. Liab.) / Total Assets"
          />

          <KriItem
            label="3-Month Gap Ratio"
            value={fmtPct(gap3m)}
            pass={gap3m !== null ? gap3m >= 0 : null}
            passLabel="Surplus"
            failLabel="Deficit"
            sub="(Cum. Assets − Cum. Liab.) / Total Assets"
          />

        </div>
      </div>

      {/* ── 30-day cash flow components ── */}
      <div className="summary-section">
        <h3 className="summary-section__title">30-Day Stress Cash Flows</h3>
        <table className="summary-table">
          <tbody>
            <tr>
              <td>Eligible HQLA</td>
              <td className="text-right mono">{fmt(summary.eligibleHqla)}</td>
            </tr>
            <tr>
              <td>Gross Outflows</td>
              <td className="text-right mono">{fmt(summary.grossOutflows)}</td>
            </tr>
            <tr>
              <td>Gross Inflows</td>
              <td className="text-right mono">{fmt(summary.grossInflows)}</td>
            </tr>
            <tr>
              <td>Capped Inflows (75% cap)</td>
              <td className="text-right mono">{fmt(summary.cappedInflows)}</td>
            </tr>
            <tr className="summary-table__total summary-table__total--highlight">
              <td><strong>Net Cash Outflows</strong></td>
              <td className="text-right mono"><strong>{fmt(summary.netCashOutflows)}</strong></td>
            </tr>
            <tr className="summary-table__total summary-table__total--highlight">
              <td><strong>LCR = HQLA / Net Outflows</strong></td>
              <td
                className="text-right mono"
                style={{ color: lcrPass === true ? 'var(--color-success)' : lcrPass === false ? 'var(--color-error)' : undefined }}
              >
                <strong>{fmtPct(lcr)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </section>
  );
}
