/**
 * LoginView — Employee ID + password login form.
 */

import { useState } from 'react';
import { login, setToken } from '../services/api';
import nhBankLogo from '../assets/NH_Bank.png';

interface Props {
  onLogin: (user: { id: number; employeeId: string; role: string }, mustChangePassword: boolean) => void;
}

export function LoginView({ onLogin }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword]     = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId.trim() || !password) return;

    setLoading(true);
    setError(null);
    try {
      const res = await login(employeeId.trim(), password);
      setToken(res.token);
      onLogin(res.user, res.mustChangePassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
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
      <div className="card" style={{ width: '100%', maxWidth: '380px', padding: '2.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img src={nhBankLogo} alt="NongHyup Bank" style={{ height: 48, marginBottom: '0.75rem' }} />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Liquidity Management</h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Internal Use Only
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="form-label" style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Employee ID</span>
            <input
              className="form-input"
              type="text"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="e.g. 20260001"
              autoComplete="username"
              autoFocus
              disabled={loading}
              style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
            />
          </label>

          <label className="form-label" style={{ display: 'block', marginBottom: '1.25rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Password</span>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
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
            disabled={loading || !employeeId.trim() || !password}
            style={{ width: '100%', padding: '0.65rem', fontSize: '0.95rem' }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
