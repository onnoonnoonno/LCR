/**
 * ChangePasswordView — First-login forced password change with live policy validation.
 */

import { useState, useMemo } from 'react';
import { changePassword } from '../services/api';

interface Props {
  employeeId: string;
  onChanged: () => void;
  onLogout: () => void;
}

interface PolicyRule {
  label: string;
  test: (pw: string) => boolean;
}

const POLICY_RULES: PolicyRule[] = [
  { label: 'At least 8 characters',    test: (pw) => pw.length >= 8 },
  { label: 'Contains uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { label: 'Contains lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { label: 'Contains a number',         test: (pw) => /[0-9]/.test(pw) },
  { label: 'Contains special character', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

export function ChangePasswordView({ employeeId, onChanged, onLogout }: Props) {
  const [current, setCurrent]   = useState('');
  const [next, setNext]         = useState('');
  const [confirm, setConfirm]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const policyResults = useMemo(
    () => POLICY_RULES.map((r) => ({ ...r, passed: r.test(next) })),
    [next]
  );
  const allPolicySatisfied = policyResults.every((r) => r.passed);
  const passwordsMatch = next.length > 0 && next === confirm;
  const canSubmit = current.length > 0 && allPolicySatisfied && passwordsMatch && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

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
      <div className="card" style={{ width: '100%', maxWidth: '420px', padding: '2.5rem 2rem' }}>
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

          <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>New Password</span>
            <input
              className="form-input"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
              style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
            />
          </label>

          {/* Live password policy checklist */}
          <div style={{ marginBottom: '1rem', padding: '0.5rem 0.65rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            {policyResults.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', lineHeight: 1.8 }}>
                <span style={{ color: r.passed ? '#16a34a' : '#94a3b8', fontSize: '0.85rem' }}>
                  {r.passed ? '\u2713' : '\u25CB'}
                </span>
                <span style={{ color: r.passed ? '#334155' : '#94a3b8' }}>{r.label}</span>
              </div>
            ))}
          </div>

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
            {confirm.length > 0 && !passwordsMatch && (
              <span style={{ fontSize: '0.75rem', color: 'var(--color-error, #dc2626)', marginTop: '0.25rem', display: 'block' }}>
                Passwords do not match
              </span>
            )}
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
            disabled={!canSubmit}
            style={{ width: '100%', padding: '0.65rem', fontSize: '0.95rem', marginBottom: '0.75rem' }}
          >
            {loading ? 'Saving\u2026' : 'Set New Password'}
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
