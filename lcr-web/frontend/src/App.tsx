/**
 * LCR Management — Main Application
 *
 * Tabs:
 *   Dashboard         — KRI summary table (default)
 *   LCR               — LCR detail view
 *   3M Liquidity Ratio— 3M LR detail
 *   12M Interest Rate — placeholder
 *   GAP               — 7D / 1M / 3M combined
 *   History           — browse previously stored results
 *   Account Mapping   — CRUD for account mapping reference
 */

import { useState } from 'react';
import { DashboardView, ViewMode } from './components/DashboardView';
import { VerifyView } from './components/VerifyView';
import { CfTableView } from './components/CfTableView';
import { HistoryView } from './components/HistoryView';
import { BsRe33DebugView } from './components/BsRe33DebugView';
import { RawUploadDebugView } from './components/RawUploadDebugView';
import { AccountMappingView } from './components/AccountMappingView';
import nhBankLogo from './assets/NH_Bank.png';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Tab = 'dashboard' | 'lcr' | '3m_lr' | '12m_ir' | 'gap'
         | 'history' | 'mapping'
         | 'forecast' | 'cftable' | 'rawdebug' | 'bsre33';

const DASHBOARD_GROUP: readonly string[] = ['dashboard', 'lcr', '3m_lr', '12m_ir', 'gap'];

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');

  // When a run is selected from History, switch to Dashboard with that runId
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);

  function handleSelectFromHistory(runId: string) {
    setSelectedRunId(runId);
    setTab('dashboard');
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
              <h1 className="app-header__title">LCR Management</h1>
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
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="app-main">
        <div className="container">
          {isDashboardGroup && (
            <DashboardView
              view={tab as ViewMode}
              externalRunId={tab === 'dashboard' ? selectedRunId : undefined}
              onNavigate={(t) => handleTabChange(t as Tab)}
            />
          )}
          {tab === 'forecast' && <VerifyView externalRunId={selectedRunId} />}
          {tab === 'history'  && <HistoryView onSelectRun={handleSelectFromHistory} />}
          {tab === 'mapping'  && <AccountMappingView />}
          {tab === 'cftable'  && <CfTableView />}
          {tab === 'rawdebug' && <RawUploadDebugView />}
          {tab === 'bsre33'   && <BsRe33DebugView />}
        </div>
      </main>

      <footer className="app-footer">
        <p>LCR Management &mdash; Internal Use Only</p>
      </footer>
    </div>
  );
}
