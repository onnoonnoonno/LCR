/**
 * AccountMappingView — Displays the Account Mapping reference table from the DB.
 *
 * Columns shown match the Excel Account Mapping sheet:
 *   A: Account Code
 *   B: Account Name
 *   C: Category
 *   D: Middle Category
 *   E: LCR Classification (hqlaOrCashflowType)
 *   F: Asset/Liability
 */

import { useState, useEffect } from 'react';
import { fetchAccountMappings, AccountMappingRow } from '../services/api';

export function AccountMappingView() {
  const [rows, setRows]           = useState<AccountMappingRow[]>([]);
  const [page, setPage]           = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const PAGE_SIZE = 50;

  async function loadPage(p: number) {
    setLoading(true);
    try {
      const res = await fetchAccountMappings(p, PAGE_SIZE);
      setRows(res.rows);
      setPage(res.page);
      setTotalPages(res.totalPages);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPage(1); }, []);

  return (
    <div className="verify-view">
      {/* N Column Override Reference (BS_RE33 H4:H6, I4) */}
      <div className="card">
        <div className="verify-step-header">
          <h2 className="verify-step-title">N Column Override Reference</h2>
        </div>
        <p className="verify-hint" style={{ marginBottom: '0.75rem' }}>
          These are the override values used by BS_RE33 column N.
          If a row's ref_no (column C) matches any value in the list below,
          N is forced to the override value instead of the Account Mapping lookup.
        </p>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cell</th>
                <th>Override Ref No (H column)</th>
                <th>Override N Value (I column)</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="mono">H4</td><td className="mono">RCH3001AUD</td><td style={{ fontWeight: 600 }}>Non Cash Flow</td></tr>
              <tr><td className="mono">H5</td><td className="mono">RCH3002AUD</td><td style={{ fontWeight: 600 }}>Non Cash Flow</td></tr>
              <tr><td className="mono">H6</td><td className="mono">RCH4001USD</td><td style={{ fontWeight: 600 }}>Non Cash Flow</td></tr>
            </tbody>
          </table>
        </div>
        <p className="verify-hint" style={{ marginTop: '0.5rem' }}>
          Source: BS_RE33 cells H4:H6 and I4. Formula: =IF(COUNTIF($H$4:$H$6, C7) &gt; 0, $I$4, VLOOKUP(...))
        </p>
      </div>

      {/* Account Mapping Table */}
      <div className="card">
        <div className="verify-step-header">
          <h2 className="verify-step-title">Account Mapping Table (DB)</h2>
        </div>

        <div className="verify-meta-grid" style={{ marginBottom: '0.75rem' }}>
          <div className="verify-meta-item">
            <span className="verify-meta-label">Total Mappings</span>
            <span className="verify-meta-value">{total.toLocaleString()}</span>
          </div>
        </div>

        <p className="verify-hint" style={{ marginBottom: '0.75rem' }}>
          This is the Account Mapping data stored in the database.
          Compare each row against the original Excel Account Mapping sheet (columns A–F).
        </p>

        {loading && (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div className="spinner" />
          </div>
        )}

        {!loading && (
          <>
            <div className="table-wrapper" style={{ maxHeight: '600px', overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>A: Account Code</th>
                    <th>B: Account Name</th>
                    <th>C: Category</th>
                    <th>D: Middle Category</th>
                    <th>E: LCR Classification</th>
                    <th>F: Asset/Liability</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.acCode}>
                      <td className="mono">{(page - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="mono">{r.acCode}</td>
                      <td>{r.acName}</td>
                      <td style={{ fontWeight: 600 }}>{r.category}</td>
                      <td style={{ fontWeight: 600 }}>{r.middleCategory}</td>
                      <td className="mono" style={{ fontSize: '0.75rem' }}>{r.hqlaOrCashflowType}</td>
                      <td>{r.assetLiabilityType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="pagination" style={{ marginTop: '0.75rem' }}>
                <button
                  className="btn btn--sm btn--ghost"
                  disabled={page <= 1}
                  onClick={() => loadPage(page - 1)}
                >
                  Prev
                </button>
                <span className="pagination__info">
                  Page {page} of {totalPages} ({total.toLocaleString()} rows)
                </span>
                <button
                  className="btn btn--sm btn--ghost"
                  disabled={page >= totalPages}
                  onClick={() => loadPage(page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
