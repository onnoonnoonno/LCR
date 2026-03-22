/**
 * IrrbbTable — shared popup/detail table for 12M Interest Rate Sensitive Gap Ratio.
 *
 * Used by DashboardView (popup + 12m_ir detail view) and HistoryView (popup).
 * Single source of truth for IRRBB rendering so both views stay identical.
 */

import { IrrbbData } from '../services/api';

interface Props {
  data: IrrbbData | null;
}

export function IrrbbTable({ data }: Props) {
  if (!data) {
    return (
      <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderRadius: 'var(--radius, 6px)' }}>
        <p style={{ fontSize: '0.9rem' }}>No IRRBB data available for this run.</p>
      </div>
    );
  }

  const lastIdx = data.table.length - 1;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {data.table.map((row, i) => (
            <tr key={i}>
              <td style={{ fontWeight: i === lastIdx ? 700 : undefined }}>{row.label}</td>
              <td
                className="text-right mono"
                style={{
                  fontWeight: i === lastIdx ? 700 : undefined,
                  color:      i === lastIdx ? 'var(--color-primary)' : undefined,
                }}
              >
                {row.value === null
                  ? 'N/A'
                  : row.isPercent
                    ? (row.value * 100).toFixed(2) + '%'
                    : row.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
