/**
 * Reference data seeder.
 *
 * Reads the existing JSON files from reference/data/ and upserts them into
 * the Postgres reference tables. This runs at startup — it is idempotent and
 * safe to call multiple times (uses INSERT ... ON CONFLICT DO UPDATE).
 */

import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';
import { getPool } from './client';

const DATA_DIR = path.join(process.cwd(), 'src', 'reference', 'data');

const SALT_ROUNDS = 12; // bcrypt cost factor — must match authRoutes.ts

// ---------------------------------------------------------------------------
// Helper: load + strip comment entries from a JSON file
// ---------------------------------------------------------------------------
function loadJson<T>(filename: string): T[] {
  const raw = fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8');
  const all: Record<string, unknown>[] = JSON.parse(raw);
  return all.filter((e) => {
    const isComment = ('_comment' in e || '_section' in e || '_note' in e);
    const hasData   = 'acCode' in e || 'counterpartyNo' in e || 'pKey' in e ||
                      'formulaType' in e || 'hqlaOrCashflowType' in e;
    return !isComment || hasData;
  }) as T[];
}

// ---------------------------------------------------------------------------
// Account mappings
// ---------------------------------------------------------------------------
interface AccountMappingJson {
  acCode: string;
  acName?: string;
  category?: string;
  middleCategory?: string;
  hqlaOrCashflowType?: string;
  assetLiabilityType?: string;
  signMultiplier?: number;
  isHqla?: boolean;
  hqlaLevel?: string;
  description?: string;
}

async function seedAccountMappings(): Promise<void> {
  const pool = getPool();
  const entries = loadJson<AccountMappingJson>('accountMapping.json');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of entries) {
      await client.query(
        `INSERT INTO account_mappings
           (ac_code, ac_name, category, middle_category, hqla_or_cashflow_type,
            asset_liability_type, sign_multiplier, is_hqla, hqla_level, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (ac_code) DO UPDATE SET
           ac_name               = EXCLUDED.ac_name,
           category              = EXCLUDED.category,
           middle_category       = EXCLUDED.middle_category,
           hqla_or_cashflow_type = EXCLUDED.hqla_or_cashflow_type,
           asset_liability_type  = EXCLUDED.asset_liability_type,
           sign_multiplier       = EXCLUDED.sign_multiplier,
           is_hqla               = EXCLUDED.is_hqla,
           hqla_level            = EXCLUDED.hqla_level,
           description           = EXCLUDED.description`,
        [
          r.acCode,
          r.acName ?? null,
          r.category ?? null,
          r.middleCategory ?? null,
          r.hqlaOrCashflowType ?? null,
          r.assetLiabilityType ?? null,
          r.signMultiplier ?? 1,
          r.isHqla ? 1 : 0,
          r.hqlaLevel ?? null,
          r.description ?? null,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(`[seed] account_mappings: ${entries.length} rows`);
}

// ---------------------------------------------------------------------------
// Customer types
// ---------------------------------------------------------------------------
interface CustomerTypeJson {
  counterpartyNo: string;
  customerType: string;
  description?: string;
}

async function seedCustomerTypes(): Promise<void> {
  const pool = getPool();
  const entries = loadJson<CustomerTypeJson>('customerTypes.json');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of entries) {
      await client.query(
        `INSERT INTO customer_types (counterparty_no, customer_type, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (counterparty_no) DO UPDATE SET
           customer_type = EXCLUDED.customer_type,
           description   = EXCLUDED.description`,
        [r.counterpartyNo, r.customerType, r.description ?? null]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(`[seed] customer_types: ${entries.length} rows`);
}

// ---------------------------------------------------------------------------
// Assumption rules
// ---------------------------------------------------------------------------
interface AssumptionJson {
  pKey: string;
  assumptionRate: number;
  description?: string;
}

async function seedAssumptionRules(): Promise<void> {
  const pool = getPool();
  const entries = loadJson<AssumptionJson>('assumptions.json');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of entries) {
      await client.query(
        `INSERT INTO assumption_rules (p_key, assumption_rate, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (p_key) DO UPDATE SET
           assumption_rate = EXCLUDED.assumption_rate,
           description     = EXCLUDED.description`,
        [r.pKey, r.assumptionRate, r.description ?? null]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(`[seed] assumption_rules: ${entries.length} rows`);
}

// ---------------------------------------------------------------------------
// Maturity overrides
// ---------------------------------------------------------------------------
interface MaturityOverrideJson {
  acCode?: string | null;
  refNo?: string | null;
  formulaType?: string;
  adjustedMaturityDate?: string;
  formulaParams?: Record<string, unknown>;
  reason?: string;
}

async function seedMaturityOverrides(): Promise<void> {
  const pool = getPool();
  const entries = loadJson<MaturityOverrideJson>('maturityAdjustments.json');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Clear and re-seed (no natural UNIQUE key beyond acCode+refNo combo)
    await client.query('DELETE FROM maturity_overrides');

    for (const r of entries) {
      const formulaType = r.formulaType ?? (r.adjustedMaturityDate ? 'static' : null);
      if (!formulaType) continue;

      const formulaParams = r.formulaType === 'static' || r.adjustedMaturityDate
        ? JSON.stringify({ date: r.adjustedMaturityDate })
        : r.formulaParams
          ? JSON.stringify(r.formulaParams)
          : null;

      await client.query(
        `INSERT INTO maturity_overrides (ac_code, ref_no, formula_type, formula_params, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [r.acCode ?? null, r.refNo ?? null, formulaType, formulaParams, r.reason ?? null]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(`[seed] maturity_overrides: ${entries.length} rows`);
}

// ---------------------------------------------------------------------------
// Demo users — runs at startup, idempotent
// ---------------------------------------------------------------------------

interface DemoUser {
  employee_id: string;
  password: string;
  role: 'admin' | 'user';
  must_change_password: 0 | 1;
}

const DEMO_USERS: DemoUser[] = [
  { employee_id: '24614315', password: 'Welcome1', role: 'admin', must_change_password: 0 },
  { employee_id: '12345678', password: 'Welcome1', role: 'user',  must_change_password: 1 },
];

async function seedDemoUsers(): Promise<void> {
  const pool = getPool();

  for (const u of DEMO_USERS) {
    const hash = bcrypt.hashSync(u.password, SALT_ROUNDS);
    await pool.query(
      `INSERT INTO users (employee_id, password_hash, role, must_change_password)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id) DO UPDATE SET
         password_hash        = EXCLUDED.password_hash,
         must_change_password = EXCLUDED.must_change_password`,
      [u.employee_id, hash, u.role, u.must_change_password]
    );
    console.log(`[seed] demo user upserted: ${u.employee_id} (${u.role})`);
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Safe schema migration — adds new columns if missing (idempotent)
// ---------------------------------------------------------------------------
async function migrateSchema(): Promise<void> {
  const pool = getPool();
  const migrations = [
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_locked INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_at TEXT',
  ];
  for (const sql of migrations) {
    try { await pool.query(sql); } catch (e) { console.warn('[migrate]', sql, e); }
  }
  console.log('[seed] Schema migration check complete.');
}

export async function seedReferenceData(): Promise<void> {
  console.log('[seed] Seeding reference tables from JSON files...');
  await migrateSchema();
  await seedAccountMappings();
  await seedCustomerTypes();
  await seedAssumptionRules();
  await seedMaturityOverrides();
  await seedDemoUsers();
  console.log('[seed] Done.');
}
