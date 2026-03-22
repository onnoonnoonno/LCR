/**
 * SQLite client singleton.
 *
 * All tables are created here on first connection. Reference tables are
 * seeded once (idempotent). The DB file lives at backend/data/lcr.db.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// DB file location
// ---------------------------------------------------------------------------
const DB_DIR  = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'lcr.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  applySchema(_db);
  return _db;
}

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------
function applySchema(db: Database.Database): void {
  db.exec(`
    -- -----------------------------------------------------------------------
    -- Reference tables (stable, admin-managed, seeded from JSON)
    -- -----------------------------------------------------------------------

    CREATE TABLE IF NOT EXISTS account_mappings (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      ac_code               TEXT    NOT NULL UNIQUE,
      ac_name               TEXT,
      category              TEXT,
      middle_category       TEXT,
      hqla_or_cashflow_type TEXT,
      asset_liability_type  TEXT,
      sign_multiplier       INTEGER NOT NULL DEFAULT 1,
      is_hqla               INTEGER NOT NULL DEFAULT 0,
      hqla_level            TEXT,
      description           TEXT
    );

    CREATE TABLE IF NOT EXISTS customer_types (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      counterparty_no  TEXT    NOT NULL UNIQUE,
      customer_type    TEXT    NOT NULL,
      description      TEXT
    );

    CREATE TABLE IF NOT EXISTS assumption_rules (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      p_key           TEXT    NOT NULL UNIQUE,
      assumption_rate REAL    NOT NULL,
      description     TEXT
    );

    CREATE TABLE IF NOT EXISTS maturity_overrides (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      ac_code        TEXT,
      ref_no         TEXT,
      formula_type   TEXT    NOT NULL,
      formula_params TEXT,               -- JSON string e.g. {"days":21}
      reason         TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mo_accode ON maturity_overrides(ac_code);
    CREATE INDEX IF NOT EXISTS idx_mo_refno  ON maturity_overrides(ref_no);

    -- -----------------------------------------------------------------------
    -- Report runs
    -- -----------------------------------------------------------------------

    CREATE TABLE IF NOT EXISTS report_runs (
      id              TEXT    PRIMARY KEY,
      report_date     TEXT    NOT NULL,
      uploaded_at     TEXT    NOT NULL,
      source_filename TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'pending',
      error_message   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_rr_date ON report_runs(report_date);

    -- -----------------------------------------------------------------------
    -- Raw uploaded rows (stored exactly as parsed from the Excel file)
    -- -----------------------------------------------------------------------

    CREATE TABLE IF NOT EXISTS raw_rows (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      report_run_id            TEXT    NOT NULL,
      row_number               INTEGER NOT NULL,
      ac_code                  TEXT,
      ac_name                  TEXT,
      ref_no                   TEXT,
      counterparty_no          TEXT,
      counterparty_name        TEXT,
      ccy                      TEXT,
      balance_amt              REAL,
      base_ccy_amt             REAL,
      approval_contract_date   TEXT,
      maturity_date            TEXT,
      next_interest_reset_date TEXT,
      FOREIGN KEY (report_run_id) REFERENCES report_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_raw_run ON raw_rows(report_run_id);

    -- -----------------------------------------------------------------------
    -- Processed rows (classification + row-level calculations)
    -- -----------------------------------------------------------------------

    CREATE TABLE IF NOT EXISTS processed_rows (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      report_run_id         TEXT    NOT NULL,
      raw_row_id            INTEGER NOT NULL,

      -- Classification / enrichment
      category              TEXT,
      middle_category       TEXT,
      hqla_or_cashflow_type TEXT,
      asset_liability_type  TEXT,
      customer_type         TEXT,
      p_key                 TEXT,
      assumption_rate       REAL,

      -- Row-level derived fields
      sign_multiplier       INTEGER,
      adjusted_amount       REAL,
      weighted_amount       REAL,
      is_hqla               INTEGER NOT NULL DEFAULT 0,
      hqla_level            TEXT,

      -- Maturity
      effective_maturity    TEXT,
      days_to_maturity      INTEGER,
      maturity_bucket       TEXT,
      maturity_source       TEXT,

      -- Window flags
      in_30d_window         INTEGER NOT NULL DEFAULT 0,
      is_cash_inflow        INTEGER NOT NULL DEFAULT 0,
      is_cash_outflow       INTEGER NOT NULL DEFAULT 0,

      -- Warnings
      warning_flag          INTEGER NOT NULL DEFAULT 0,
      warning_reason        TEXT,

      -- Full detail for debug page
      detail_json           TEXT,

      FOREIGN KEY (report_run_id) REFERENCES report_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pr_run ON processed_rows(report_run_id);

    -- -----------------------------------------------------------------------
    -- Summary results (one per report run)
    -- -----------------------------------------------------------------------

    CREATE TABLE IF NOT EXISTS report_summaries (
      id               TEXT    PRIMARY KEY,
      report_run_id    TEXT    NOT NULL UNIQUE,
      report_date      TEXT    NOT NULL,
      eligible_hqla    REAL    NOT NULL,
      gross_outflows   REAL    NOT NULL,
      gross_inflows    REAL    NOT NULL,
      capped_inflows   REAL    NOT NULL,
      net_cash_outflows REAL   NOT NULL,
      lcr_ratio        REAL,
      ratio_7d         REAL,
      ratio_1m         REAL,
      ratio_3m         REAL,
      ratio_3m_lr      REAL,
      created_at       TEXT    NOT NULL,
      FOREIGN KEY (report_run_id) REFERENCES report_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_rs_date ON report_summaries(report_date);
  `);

  // Incremental migrations for columns added after initial schema creation
  try {
    db.exec(`ALTER TABLE report_summaries ADD COLUMN ratio_3m_lr REAL`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE account_mappings ADD COLUMN ac_name TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE report_runs ADD COLUMN irrbb_data TEXT`);
  } catch {
    // Column already exists
  }
}
