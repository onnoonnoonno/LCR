/**
 * PasswordModal — reusable password confirmation dialog.
 *
 * Usage:
 *   <PasswordModal
 *     title="Confirm Delete"
 *     description="Enter the admin password to delete this record."
 *     onConfirm={(pw) => doAction(pw)}
 *     onCancel={() => setPromptOpen(false)}
 *     submitting={deleting}
 *     error={authError}
 *   />
 */

import { useState, useRef, useEffect } from 'react';

interface Props {
  title:        string;
  description?: string;
  confirmLabel?: string;
  onConfirm:   (password: string) => void;
  onCancel:    () => void;
  submitting?: boolean;
  error?:      string | null;
}

export function PasswordModal({
  title,
  description,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
  submitting = false,
  error = null,
}: Props) {
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Small delay so the overlay animation finishes before focus
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  function handleConfirm() {
    if (!password || submitting) return;
    onConfirm(password);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '380px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn btn--sm btn--ghost" onClick={onCancel} aria-label="Close" disabled={submitting}>✕</button>
        </div>

        {description && (
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', color: 'var(--color-text-muted)' }}>
            {description}
          </p>
        )}

        {error && (
          <div style={{
            padding: '0.5rem 0.75rem',
            marginBottom: '0.75rem',
            background: 'var(--color-error-bg, #fef2f2)',
            color: 'var(--color-error)',
            borderRadius: 'var(--radius, 6px)',
            fontSize: '0.85rem',
          }}>
            {error}
          </div>
        )}

        <label className="form-label" style={{ display: 'block', marginBottom: '1.25rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Admin Password</span>
          <input
            ref={inputRef}
            className="form-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
            placeholder="Enter password…"
            autoComplete="current-password"
            style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
            disabled={submitting}
          />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button className="btn btn--ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            onClick={handleConfirm}
            disabled={!password || submitting}
          >
            {submitting ? 'Confirming…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
