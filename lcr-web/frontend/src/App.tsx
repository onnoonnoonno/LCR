/**
 * LCR Management — Main Application
 *
 * Auth flow:
 *   1. No token → LoginView
 *   2. Token + mustChangePassword → ChangePasswordView
 *   3. Token + password changed → main app
 */

import { useState, useEffect } from 'react';
import { DashboardView, ViewMode } from './components/DashboardView';
import { VerifyView } from './components/VerifyView';
import { CfTableView } from './components/CfTableView';
import { HistoryView } from './components/HistoryView';
import { BsRe33DebugView } from './components/BsRe33DebugView';
import { RawUploadDebugView } from './components/RawUploadDebugView';
import { AccountMappingView } from './components/AccountMappingView';
import { LoginView } from './components/LoginView';
import { ChangePasswordView } from './components/ChangePasswordView';
import { getToken, clearToken } from './services/api';
import nhBankLogo from './assets/NH_Bank.png';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'dashboard' | 'lcr' | '3m_lr' | '12m_ir' | 'gap'
         | 'history' | 'mapping'
         | 'forecast' | 'cftable' | 'rawdebug' | 'bsre33';

const DASHBOARD_GROUP: readonly string[] = ['dashboard', 'lcr', '3m_lr', '12m_ir', 'gap'];

interface AuthUser {
  id: number;
  employeeId: string;
  role: string;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [authUser, setAuthUser]                   = useState<AuthUser | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [tab, setTab]                             = useState<Tab>('dashboard');
  const [selectedRunId, setSelectedRunId]         = useState<string | undefined>(undefined);

  // Restore session from localStorage on mount
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    // Decode JWT payload (non-verifying — server will reject if expired)
    try {
      const payload = JSON.parse(atob(token.split('.')[1])) as {
        userId: number; employeeId: string; role: string; mustChangePassword: boolean; exp: number;
      };
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        clearToken();
        return;
      }
      setAuthUser({ id: payload.userId, employeeId: payload.employeeId, role: payload.role });
      setMustChangePassword(payload.mustChangePassword);
    } catch {
      clearToken();
    }
  }, []);

  function handleLogin(user: AuthUser, mustChange: boolean) {
    setAuthUser(user);
    setMustChangePassword(mustChange);
  }

  function handlePasswordChanged() {
    setMustChangePassword(false);
  }

  function handleLogout() {
    clearToken();
    setAuthUser(null);
    setMustChangePassword(false);
    setTab('dashboard');
    setSelectedRunId(undefined);
  }

  // -- Auth gates --

  if (!authUser) {
    return <LoginView onLogin={handleLogin} />;
  }

  if (mustChangePassword) {
    return (
      <ChangePasswordView
        employeeId={authUser.employeeId}
        onChanged={handlePasswordChanged}
        onLogout={handleLogout}
      />
    );
  }

  // -- Main app --

  function handleSelectFromHistory(runId: string) {
    setSelectedRunId(runId);
    setTab('dashboard');
  }

  function handleNavigateToLcr(runId: string) {
    setSelectedRunId(runId);
    setTab('lcr');
  }

  function handleTabChange(newTab: Tab) {
    if (newTab === 'dashboard') setSelectedRunId(undefined);
    setTab(newTab);
  }

  const isDashboardGroup = DASHBOARD_GROUP.includes(tab);

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-header__inner">
          <div className="app-header__brand">
            <img
              src={nhBankLogo}
              alt="NongHyup Bank"
              className="app-header__logo-img"
            />
            <div className="app-header__title-group">
              <h1 className="app-header__title">Liquidity Management</h1>
            </div>
          </div>

          <nav className="app-header__nav">
            <button
              className={`nav-tab ${tab === 'dashboard' ? 'nav-tab--active' : ''}`}
              onClick={() => handleTabChange('dashboard')}
            >
              Dashboard
            </button>
            <button
              className={`nav-tab ${tab === 'lcr' ? 'nav-tab--active' : ''}`}
              onClick={() => handleTabChange('lcr')}
            >
              LCR
            </button>
            <button
              className={`nav-tab ${tab === 'history' ? 'nav-tab--active' : ''}`}
              onClick={() => handleTabChange('history')}
            >
              History
            </button>
            <button
              className={`nav-tab ${tab === 'mapping' ? 'nav-tab--active' : ''}`}
              onClick={() => handleTabChange('mapping')}
            >
              Account Mapping
            </button>
            <button
              className="nav-tab"
              onClick={handleLogout}
              style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}
              title={`Signed in as ${authUser.employeeId}`}
            >
              {authUser.employeeId} · Sign out
            </button>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="app-main">
        <div className="container">
          {isDashboardGroup && (
            <DashboardView
              view={tab as ViewMode}
              externalRunId={DASHBOARD_GROUP.includes(tab) ? selectedRunId : undefined}
              onNavigate={(t) => handleTabChange(t as Tab)}
            />
          )}
          {tab === 'forecast' && <VerifyView externalRunId={selectedRunId} />}
          {tab === 'history'  && <HistoryView onSelectRun={handleSelectFromHistory} userRole={authUser.role} onNavigateToLcr={handleNavigateToLcr} />}
          {tab === 'mapping'  && <AccountMappingView userRole={authUser.role} />}
          {tab === 'cftable'  && <CfTableView />}
          {tab === 'rawdebug' && <RawUploadDebugView />}
          {tab === 'bsre33'   && <BsRe33DebugView />}
        </div>
      </main>

      <footer className="app-footer">
        <p>Liquidity Management &mdash; Internal Use Only</p>
      </footer>
    </div>
  );
}
