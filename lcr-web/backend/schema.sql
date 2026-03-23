-- =============================================================================
-- LCR Web Application — Postgres Schema for Supabase
-- =============================================================================
-- Run this once in the Supabase SQL Editor (Database → SQL Editor).
-- Safe to re-run: all statements use IF NOT EXISTS.
-- Boolean flags are stored as INTEGER (0/1) to match existing application code.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Reference tables (stable, admin-managed, seeded from JSON)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS account_mappings (
  id                    BIGSERIAL PRIMARY KEY,
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
  id               BIGSERIAL PRIMARY KEY,
  counterparty_no  TEXT    NOT NULL UNIQUE,
  customer_type    TEXT    NOT NULL,
  description      TEXT
);

CREATE TABLE IF NOT EXISTS assumption_rules (
  id              BIGSERIAL PRIMARY KEY,
  p_key           TEXT    NOT NULL UNIQUE,
  assumption_rate REAL    NOT NULL,
  description     TEXT
);

CREATE TABLE IF NOT EXISTS maturity_overrides (
  id             BIGSERIAL PRIMARY KEY,
  ac_code        TEXT,
  ref_no         TEXT,
  formula_type   TEXT    NOT NULL,
  formula_params TEXT,               -- JSON string e.g. {"days":21}
  reason         TEXT
);

CREATE INDEX IF NOT EXISTS idx_mo_accode ON maturity_overrides(ac_code);
CREATE INDEX IF NOT EXISTS idx_mo_refno  ON maturity_overrides(ref_no);

-- ---------------------------------------------------------------------------
-- Users (authentication)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id                   BIGSERIAL PRIMARY KEY,
  employee_id          TEXT    NOT NULL UNIQUE,
  password_hash        TEXT    NOT NULL,
  role                 TEXT    NOT NULL DEFAULT 'user',
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT    NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Report runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS report_runs (
  id              TEXT    PRIMARY KEY,   -- UUID string generated in app
  report_date     TEXT    NOT NULL,
  uploaded_at     TEXT    NOT NULL,
  source_filename TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending',
  error_message   TEXT,
  user_id         BIGINT  REFERENCES users(id),
  irrbb_data      TEXT                   -- JSON string
);

CREATE INDEX IF NOT EXISTS idx_rr_date ON report_runs(report_date);

-- ---------------------------------------------------------------------------
-- Raw uploaded rows (stored exactly as parsed from Excel)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_rows (
  id                       BIGSERIAL PRIMARY KEY,
  report_run_id            TEXT    NOT NULL REFERENCES report_runs(id),
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
  next_interest_reset_date TEXT
);

CREATE INDEX IF NOT EXISTS idx_raw_run ON raw_rows(report_run_id);

-- ---------------------------------------------------------------------------
-- Processed rows (classification + row-level calculations)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS processed_rows (
  id                    BIGSERIAL PRIMARY KEY,
  report_run_id         TEXT    NOT NULL REFERENCES report_runs(id),
  raw_row_id            BIGINT  NOT NULL,

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
  detail_json           TEXT
);

CREATE INDEX IF NOT EXISTS idx_pr_run ON processed_rows(report_run_id);

-- ---------------------------------------------------------------------------
-- Summary results (one per report run)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS report_summaries (
  id                TEXT    PRIMARY KEY,   -- UUID string
  report_run_id     TEXT    NOT NULL UNIQUE REFERENCES report_runs(id),
  report_date       TEXT    NOT NULL,
  eligible_hqla     REAL    NOT NULL,
  gross_outflows    REAL    NOT NULL,
  gross_inflows     REAL    NOT NULL,
  capped_inflows    REAL    NOT NULL,
  net_cash_outflows REAL    NOT NULL,
  lcr_ratio         REAL,
  ratio_7d          REAL,
  ratio_1m          REAL,
  ratio_3m          REAL,
  ratio_3m_lr       REAL,
  created_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rs_date ON report_summaries(report_date);
