/**
 * LCR Management — Main Application
 *
 * Tabs:
 *   Forecast — auto-loads latest report; shows KRI + gap ratios
 *   History  — browse previously stored results; select to load in Forecast tab
 */

import { useState } from 'react';
import { VerifyView } from './components/VerifyView';
import { CfTableView } from './components/CfTableView';
import { HistoryView } from './components/HistoryView';
import { BsRe33DebugView } from './components/BsRe33DebugView';
import { RawUploadDebugView } from './components/RawUploadDebugView';
import nhBankLogo from './assets/NH_Bank.png';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Tab = 'forecast' | 'history' | 'cftable' | 'rawdebug' | 'bsre33';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [tab, setTab] = useState<Tab>('forecast');

  // When a run is selected from History, switch to Forecast tab with that runId
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);

  function handleSelectFromHistory(runId: string) {
    setSelectedRunId(runId);
    setTab('forecast');
  }

  function handleTabChange(newTab: Tab) {
    if (newTab === 'forecast' && tab !== 'forecast') {
      setSelectedRunId(undefined);
    }
    setTab(newTab);
  }

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

          {/* Primary navigation — Forecast + History only */}
          <nav className="app-header__nav">
            <button
              className={`nav-tab ${tab === 'forecast' ? 'nav-tab--active' : ''}`}
              onClick={() => handleTabChange('forecast')}
            >
              Forecast
            </button>
            <button
              className={`nav-tab ${tab === 'history' ? 'nav-tab--active' : ''}`}
              onClick={() => handleTabChange('history')}
            >
              History
            </button>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="app-main">
        <div className="container">
          {tab === 'forecast' && <VerifyView externalRunId={selectedRunId} />}
          {tab === 'history'  && <HistoryView onSelectRun={handleSelectFromHistory} />}
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
