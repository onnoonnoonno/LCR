/**
 * SummaryView
 *
 * Displays the aggregated LCR summary:
 *   - LCR ratio prominently
 *   - HQLA breakdown (Level 1, 2A, 2B)
 *   - Cash outflows vs inflows vs net
 *   - Row coverage statistics
 */

import { LcrSummary } from '../types/bs-re33';

interface SummaryViewProps {
  summary: LcrSummary;
  calculationId: string;
  warnings: number;
  errors: number;
}

function fmtNum(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtRate(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SummaryView({ summary, calculationId, warnings, errors }: SummaryViewProps) {
  const lcr = summary.lcrRatio;
  const lcrClass = lcr === null ? '' : lcr >= 100 ? 'lcr-ratio--pass' : 'lcr-ratio--fail';

  return (
    <section className="card" aria-label="LCR Summary">
      <h2 className="card__title">LCR Summary — {summary.reportDate}</h2>

      {/* LCR ratio hero */}
      <div className="lcr-hero">
        <div className={`lcr-ratio ${lcrClass}`}>
          <span className="lcr-ratio__label">LCR Ratio</span>
          <span className="lcr-ratio__value">
            {lcr !== null ? `${fmtRate(lcr)}%` : 'N/A'}
          </span>
          {lcr !== null && (
            <span className="lcr-ratio__status">
              {lcr >= 100 ? '✓ Meets 100% minimum' : '✗ Below 100% minimum'}
            </span>
          )}
        </div>

        <div className="lcr-hero-metrics">
          <div className="metric-item">
            <span className="metric-label">Eligible HQLA</span>
            <span className="metric-value">{fmtNum(summary.hqla.eligibleTotal)}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Net Cash Outflows</span>
            <span className="metric-value">{fmtNum(summary.netCashOutflows)}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Gross Outflows</span>
            <span className="metric-value">{fmtNum(summary.cashOutflows.total)}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Capped Inflows</span>
            <span className="metric-value">{fmtNum(summary.cappedInflowsTotal)}</span>
          </div>
        </div>
      </div>

      {/* HQLA breakdown */}
      <div className="summary-section">
        <h3 className="summary-section__title">HQLA Stock</h3>
        <table className="summary-table">
          <thead>
            <tr>
              <th>Level</th>
              <th className="text-right">Raw Balance</th>
              <th className="text-right">After Haircut</th>
              <th className="text-right">Haircut Rate</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Level 1 (0% haircut)</td>
              <td className="text-right mono">{fmtNum(summary.hqla.level1Raw)}</td>
              <td className="text-right mono">{fmtNum(summary.hqla.level1Weighted)}</td>
              <td className="text-right mono">0%</td>
            </tr>
            <tr>
              <td>Level 2A (15% haircut)</td>
              <td className="text-right mono">{fmtNum(summary.hqla.level2aRaw)}</td>
              <td className="text-right mono">{fmtNum(summary.hqla.level2aWeighted)}</td>
              <td className="text-right mono">15%</td>
            </tr>
            <tr>
              <td>Level 2B (25–50% haircut)</td>
              <td className="text-right mono">{fmtNum(summary.hqla.level2bRaw)}</td>
              <td className="text-right mono">{fmtNum(summary.hqla.level2bWeighted)}</td>
              <td className="text-right mono">25–50%</td>
            </tr>
            <tr className="summary-table__total">
              <td>Adjusted Total (pre-cap)</td>
              <td className="text-right mono"></td>
              <td className="text-right mono">{fmtNum(summary.hqla.adjustedTotal)}</td>
              <td></td>
            </tr>
            <tr className="summary-table__total summary-table__total--highlight">
              <td>Eligible HQLA (after Level2 caps)</td>
              <td className="text-right mono"></td>
              <td className="text-right mono"><strong>{fmtNum(summary.hqla.eligibleTotal)}</strong></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Cash flows */}
      <div className="summary-section">
        <h3 className="summary-section__title">Cash Flows (30-day stress)</h3>
        <table className="summary-table">
          <thead>
            <tr>
              <th>Component</th>
              <th className="text-right">Amount</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Gross Cash Outflows</td>
              <td className="text-right mono">{fmtNum(summary.cashOutflows.total)}</td>
              <td></td>
            </tr>
            <tr>
              <td>Gross Cash Inflows</td>
              <td className="text-right mono">{fmtNum(summary.cashInflows.total)}</td>
              <td></td>
            </tr>
            <tr>
              <td>Inflow Cap (75% of outflows)</td>
              <td className="text-right mono">{fmtNum(summary.cashOutflows.total * 0.75)}</td>
              <td className="text-muted">Basel III Article 425</td>
            </tr>
            <tr>
              <td>Capped Inflows Applied</td>
              <td className="text-right mono">{fmtNum(summary.cappedInflowsTotal)}</td>
              <td></td>
            </tr>
            <tr className="summary-table__total summary-table__total--highlight">
              <td>Net Cash Outflows</td>
              <td className="text-right mono"><strong>{fmtNum(summary.netCashOutflows)}</strong></td>
              <td className="text-muted">= Outflows − Capped Inflows</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Coverage statistics */}
      <div className="summary-section">
        <h3 className="summary-section__title">Coverage Statistics</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-label">Total Rows</span>
            <span className="stat-value">{summary.rowCount.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Mapped Rows</span>
            <span className="stat-value stat-value--success">{summary.mappedRows.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Unmapped Rows</span>
            <span className={`stat-value ${summary.unmappedRows > 0 ? 'stat-value--warning' : ''}`}>
              {summary.unmappedRows.toLocaleString()}
            </span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Rows with Warnings</span>
            <span className={`stat-value ${summary.rowsWithWarnings > 0 ? 'stat-value--warning' : ''}`}>
              {summary.rowsWithWarnings.toLocaleString()}
            </span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Calc Warnings</span>
            <span className={`stat-value ${warnings > 0 ? 'stat-value--warning' : ''}`}>{warnings}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Calc Errors</span>
            <span className={`stat-value ${errors > 0 ? 'stat-value--error' : ''}`}>{errors}</span>
          </div>
        </div>
      </div>

      <p className="calc-id-note">Calculation ID: <code>{calculationId}</code></p>
    </section>
  );
}
