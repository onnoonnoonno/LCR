/**
 * AccountMappingView — Full CRUD for Account Mapping reference data.
 *
 * Features:
 *   - Paginated table listing with server-side search
 *   - Dropdown fields populated from existing distinct values
 *   - Add / Edit via modal → password confirmation before save
 *   - Delete with confirmation → password confirmation before delete
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchAccountMappings,
  fetchAccountMappingDistinct,
  createAccountMapping,
  updateAccountMapping,
  deleteAccountMapping,
  AccountMappingRow,
  AccountMappingInput,
  AccountMappingDistinct,
} from '../services/api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

const EMPTY_FORM: AccountMappingInput = {
  acCode: '',
  acName: '',
  category: '',
  middleCategory: '',
  hqlaOrCashflowType: '',
  assetLiabilityType: '',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props { userRole?: string; }

export function AccountMappingView({ userRole }: Props) {
  const isAdmin = userRole === 'admin';
  const [rows, setRows]             = useState<AccountMappingRow[]>([]);
  const [page, setPage]             = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  // Search
  const [search, setSearch]         = useState('');
  const searchTimer                 = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dropdown distinct values
  const [distinct, setDistinct]     = useState<AccountMappingDistinct | null>(null);

  // Add / Edit form modal
  const [modalOpen, setModalOpen]   = useState(false);
  const [editingRow, setEditingRow] = useState<AccountMappingRow | null>(null);
  const [form, setForm]             = useState<AccountMappingInput>(EMPTY_FORM);
  const [formError, setFormError]   = useState<string | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<AccountMappingRow | null>(null);

  // Submitting state for save / delete actions
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError]           = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadPage = useCallback(async (p: number, q = search) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAccountMappings(p, PAGE_SIZE, q);
      setRows(res.rows);
      setPage(res.page);
      setTotalPages(res.totalPages);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadDistinct = useCallback(async () => {
    try {
      const res = await fetchAccountMappingDistinct();
      setDistinct(res);
    } catch {
      // non-critical — dropdowns will just be empty
    }
  }, []);

  useEffect(() => { loadPage(1); }, [loadPage]);
  useEffect(() => { loadDistinct(); }, [loadDistinct]);

  // Debounced search — triggers loadPage after 350ms of inactivity
  function handleSearchChange(value: string) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { loadPage(1, value); }, 350);
  }

  // -------------------------------------------------------------------------
  // Add / Edit form modal
  // -------------------------------------------------------------------------

  function openAddModal() {
    setEditingRow(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEditModal(row: AccountMappingRow) {
    setEditingRow(row);
    setForm({
      acCode:             row.acCode,
      acName:             row.acName,
      category:           row.category,
      middleCategory:     row.middleCategory,
      hqlaOrCashflowType: row.hqlaOrCashflowType,
      assetLiabilityType: row.assetLiabilityType,
    });
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingRow(null);
    setFormError(null);
  }

  function handleFormChange(field: keyof AccountMappingInput, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  /** Called when user clicks "Save" in the form — validates then calls API directly. */
  async function handleSaveRequest() {
    if (!form.acCode.trim()) {
      setFormError('Account Code is required.');
      return;
    }
    setFormError(null);
    setActionSubmitting(true);
    setActionError(null);

    try {
      const editId = editingRow?.id ?? null;
      if (editId !== null) {
        await updateAccountMapping(editId, { ...form });
      } else {
        await createAccountMapping({ ...form });
      }
      closeModal();
      await loadDistinct();
      await loadPage(editId !== null ? page : 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
    } finally {
      setActionSubmitting(false);
    }
  }

  // -------------------------------------------------------------------------
  // Delete helpers
  // -------------------------------------------------------------------------

  /** Called when user confirms delete in the confirmation modal — calls API directly. */
  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setActionSubmitting(true);
    setActionError(null);
    const target = deleteTarget;
    setDeleteTarget(null);

    try {
      await deleteAccountMapping(target.id);
      await loadDistinct();
      await loadPage(page);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
    } finally {
      setActionSubmitting(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="verify-view">
      <div className="card">
        {/* Title row */}
        <div className="verify-step-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
            <h2 className="verify-step-title" style={{ margin: 0 }}>Account Mapping</h2>
            <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted, #6b7280)' }}>
              Total Mappings: {total.toLocaleString()}
            </span>
          </div>
          {isAdmin && (
            <button className="btn btn--primary" onClick={openAddModal}>
              + Add Account
            </button>
          )}
        </div>

        {/* Search bar */}
        <div style={{ margin: '0.75rem 0' }}>
          <input
            className="form-input"
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by Account Code or Account Name"
            style={{ width: '100%', maxWidth: '420px' }}
          />
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            padding: '0.75rem 1rem',
            marginBottom: '0.75rem',
            background: 'var(--color-error-bg, #fef2f2)',
            color: 'var(--color-error)',
            borderRadius: 'var(--radius, 6px)',
            fontSize: '0.85rem',
          }}>
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div className="spinner" />
          </div>
        )}

        {/* Table */}
        {!loading && (
          <>
            <div className="table-wrapper" style={{ maxHeight: '600px', overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Account Code</th>
                    <th>Account Name</th>
                    <th>Category</th>
                    <th>Middle Category</th>
                    <th>LCR Classification</th>
                    <th>Asset/Liability</th>
                    {isAdmin && <th style={{ width: '120px', textAlign: 'center' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
                        No mappings found.
                      </td>
                    </tr>
                  )}
                  {rows.map((r, i) => (
                    <tr key={r.id}>
                      <td className="mono">{(page - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="mono">{r.acCode}</td>
                      <td>{r.acName}</td>
                      <td style={{ fontWeight: 600 }}>{r.category}</td>
                      <td style={{ fontWeight: 600 }}>{r.middleCategory}</td>
                      <td className="mono" style={{ fontSize: '0.75rem' }}>{r.hqlaOrCashflowType}</td>
                      <td>{r.assetLiabilityType}</td>
                      {isAdmin && (
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => openEditModal(r)}
                            style={{ marginRight: '0.25rem' }}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn--sm btn--ghost"
                            style={{ color: 'var(--color-error)' }}
                            onClick={() => setDeleteTarget(r)}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
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

      {/* ----------------------------------------------------------------- */}
      {/* Add / Edit Modal                                                   */}
      {/* ----------------------------------------------------------------- */}
      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>
              {editingRow ? 'Edit Account Mapping' : 'Add Account Mapping'}
            </h3>

            {formError && (
              <div style={{
                padding: '0.5rem 0.75rem',
                marginBottom: '0.75rem',
                background: 'var(--color-error-bg, #fef2f2)',
                color: 'var(--color-error)',
                borderRadius: 'var(--radius, 6px)',
                fontSize: '0.85rem',
              }}>
                {formError}
              </div>
            )}

            <div className="form-grid">
              <label className="form-label">
                Account Code
                <input
                  className="form-input"
                  type="text"
                  value={form.acCode}
                  onChange={(e) => handleFormChange('acCode', e.target.value)}
                  placeholder="e.g. 10101001"
                />
              </label>

              <label className="form-label">
                Account Name
                <input
                  className="form-input"
                  type="text"
                  value={form.acName}
                  onChange={(e) => handleFormChange('acName', e.target.value)}
                  placeholder="e.g. CASH ON HAND"
                />
              </label>

              <label className="form-label">
                Category
                <select
                  className="form-input"
                  value={form.category}
                  onChange={(e) => handleFormChange('category', e.target.value)}
                >
                  <option value="">Select Category</option>
                  {distinct?.category.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>

              <label className="form-label">
                Middle Category
                <select
                  className="form-input"
                  value={form.middleCategory}
                  onChange={(e) => handleFormChange('middleCategory', e.target.value)}
                >
                  <option value="">Select Middle Category</option>
                  {distinct?.middleCategory.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>

              <label className="form-label">
                LCR Classification
                <select
                  className="form-input"
                  value={form.hqlaOrCashflowType}
                  onChange={(e) => handleFormChange('hqlaOrCashflowType', e.target.value)}
                >
                  <option value="">Select LCR Classification</option>
                  {distinct?.hqlaOrCashflowType.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>

              <label className="form-label">
                Asset/Liability
                <select
                  className="form-input"
                  value={form.assetLiabilityType}
                  onChange={(e) => handleFormChange('assetLiabilityType', e.target.value)}
                >
                  <option value="">Select Asset/Liability</option>
                  {distinct?.assetLiabilityType.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>

            {actionError && (
              <div style={{
                padding: '0.5rem 0.75rem',
                marginTop: '0.75rem',
                background: 'var(--color-error-bg, #fef2f2)',
                color: 'var(--color-error)',
                borderRadius: 'var(--radius, 6px)',
                fontSize: '0.85rem',
              }}>
                {actionError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button className="btn btn--ghost" onClick={closeModal} disabled={actionSubmitting}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={handleSaveRequest} disabled={actionSubmitting}>
                {actionSubmitting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Delete Confirmation Modal                                          */}
      {/* ----------------------------------------------------------------- */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Delete Account Mapping</h3>
            <p style={{ margin: '0 0 1rem' }}>
              Are you sure you want to delete <strong>{deleteTarget.acCode}</strong> ({deleteTarget.acName})?
              This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className="btn btn--ghost" onClick={() => setDeleteTarget(null)} disabled={actionSubmitting}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                style={{ background: 'var(--color-error)' }}
                onClick={handleDeleteConfirm}
                disabled={actionSubmitting}
              >
                {actionSubmitting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
