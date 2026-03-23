/**
 * Reference data seeder.
 *
 * Reads the existing JSON files from reference/data/ and upserts them into
 * the SQLite reference tables. This runs at startup — it is idempotent and
 * safe to call multiple times (uses INSERT OR REPLACE).
 */

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';

const DATA_DIR = path.join(process.cwd(), 'src', 'reference', 'data');

const SALT_ROUNDS = 12; // bcrypt cost factor — must match authRoutes.ts

// ---------------------------------------------------------------------------
// Helper: load + strip comment entries from a JSON file
// ---------------------------------------------------------------------------
function loadJson<T>(filename: string): T[] {
  const raw = fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8');
  const all: Record<string, unknown>[] = JSON.parse(raw);
  // Filter out pure comment/section entries
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

function seedAccountMappings(db: Database.Database): void {
  const entries = loadJson<AccountMappingJson>('accountMapping.json');
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO account_mappings
      (ac_code, ac_name, category, middle_category, hqla_or_cashflow_type,
       asset_liability_type, sign_multiplier, is_hqla, hqla_level, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertAll = db.transaction((rows: AccountMappingJson[]) => {
    for (const r of rows) {
      stmt.run(
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
      );
    }
  });
  upsertAll(entries);
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

function seedCustomerTypes(db: Database.Database): void {
  const entries = loadJson<CustomerTypeJson>('customerTypes.json');
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO customer_types (counterparty_no, customer_type, description)
    VALUES (?, ?, ?)
  `);
  const upsertAll = db.transaction((rows: CustomerTypeJson[]) => {
    for (const r of rows) {
      stmt.run(r.counterpartyNo, r.customerType, r.description ?? null);
    }
  });
  upsertAll(entries);
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

function seedAssumptionRules(db: Database.Database): void {
  const entries = loadJson<AssumptionJson>('assumptions.json');
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO assumption_rules (p_key, assumption_rate, description)
    VALUES (?, ?, ?)
  `);
  const upsertAll = db.transaction((rows: AssumptionJson[]) => {
    for (const r of rows) {
      stmt.run(r.pKey, r.assumptionRate, r.description ?? null);
    }
  });
  upsertAll(entries);
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

function seedMaturityOverrides(db: Database.Database): void {
  const entries = loadJson<MaturityOverrideJson>('maturityAdjustments.json');

  // Clear and re-seed (maturity overrides have no natural UNIQUE key beyond acCode+refNo combo)
  db.exec('DELETE FROM maturity_overrides');

  const stmt = db.prepare(`
    INSERT INTO maturity_overrides (ac_code, ref_no, formula_type, formula_params, reason)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertAll = db.transaction((rows: MaturityOverrideJson[]) => {
    for (const r of rows) {
      // Normalise: entries with a static date get formulaType='static'
      const formulaType = r.formulaType ?? (r.adjustedMaturityDate ? 'static' : null);
      if (!formulaType) continue; // skip incomplete entries

      const formulaParams = r.formulaType === 'static' || r.adjustedMaturityDate
        ? JSON.stringify({ date: r.adjustedMaturityDate })
        : r.formulaParams
          ? JSON.stringify(r.formulaParams)
          : null;

      stmt.run(
        r.acCode ?? null,
        r.refNo  ?? null,
        formulaType,
        formulaParams,
        r.reason ?? null,
      );
    }
  });
  insertAll(entries);
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

function seedDemoUsers(db: Database.Database): void {
  // Always upsert demo accounts so the known password is enforced on every
  // startup. This prevents the production 401 that occurs when the DB already
  // has these users from a prior boot but with a different password hash.
  const upsert = db.prepare(
    `INSERT INTO users (employee_id, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(employee_id) DO UPDATE SET
       password_hash        = excluded.password_hash,
       must_change_password = excluded.must_change_password`
  );

  for (const u of DEMO_USERS) {
    const hash = bcrypt.hashSync(u.password, SALT_ROUNDS);
    upsert.run(u.employee_id, hash, u.role, u.must_change_password);
    console.log(`[seed] demo user upserted: ${u.employee_id} (${u.role})`);
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export function seedReferenceData(db: Database.Database): void {
  console.log('[seed] Seeding reference tables from JSON files...');
  seedAccountMappings(db);
  seedCustomerTypes(db);
  seedAssumptionRules(db);
  seedMaturityOverrides(db);
  seedDemoUsers(db);
  console.log('[seed] Done.');
}
