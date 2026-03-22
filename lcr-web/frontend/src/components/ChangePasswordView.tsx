/**
 * ChangePasswordView — First-login forced password change.
 */

import { useState } from 'react';
import { changePassword } from '../services/api';

interface Props {
  employeeId: string;
  onChanged: () => void;
  onLogout: () => void;
}

export function ChangePasswordView({ employeeId, onChanged, onLogout }: Props) {
  const [current, setCurrent]   = useState('');
  const [next, setNext]         = useState('');
  const [confirm, setConfirm]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await changePassword(current, next);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg, #f8fafc)',
    }}>
      <div className="card" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem 2rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem', fontWeight: 700 }}>
          Change Password Required
        </h2>
        <p style={{ margin: '0 0 1.5rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          You are logged in as <strong>{employeeId}</strong>. You must set a new password before continuing.
        </p>

        <form onSubmit={handleSubmit}>
          <label className="form-label" style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Current Password</span>
            <input
              className="form-input"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              autoFocus
              disabled={loading}
              style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
            />
          </label>

          <label className="form-label" style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>New Password</span>
            <input
              className="form-input"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              placeholder="Minimum 8 characters"
              disabled={loading}
              style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
            />
          </label>

          <label className="form-label" style={{ display: 'block', marginBottom: '1.25rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Confirm New Password</span>
            <input
              className="form-input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
              style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
            />
          </label>

          {error && (
            <div style={{
              padding: '0.6rem 0.85rem',
              marginBottom: '1rem',
              background: 'var(--color-error-bg, #fef2f2)',
              color: 'var(--color-error)',
              borderRadius: 'var(--radius, 6px)',
              fontSize: '0.85rem',
            }}>
              {error}
            </div>
          )}

          <button
            className="btn btn--primary"
            type="submit"
            disabled={loading || !current || !next || !confirm}
            style={{ width: '100%', padding: '0.65rem', fontSize: '0.95rem', marginBottom: '0.75rem' }}
          >
            {loading ? 'Saving…' : 'Set New Password'}
          </button>

          <div style={{ textAlign: 'center' }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onLogout}
              disabled={loading}
              style={{ fontSize: '0.82rem' }}
            >
              Sign out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
