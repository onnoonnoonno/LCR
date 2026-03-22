/**
 * Migration: Assign NULL-owned report_runs to the first-created admin account.
 *
 * Safe to re-run: the WHERE clause strictly targets user_id IS NULL rows only.
 * Existing non-NULL user_id values are never touched.
 *
 * Usage:
 *   npx ts-node scripts/migrateNullOwnership.ts
 *
 * Optional — assign to a specific employee ID instead of the first-created admin:
 *   npx ts-node scripts/migrateNullOwnership.ts 20260001
 */

import 'dotenv/config';
import { getDb } from '../src/db/client';

const targetEmployeeId = process.argv[2] ?? null;
const db = getDb();

// -----------------------------------------------------------------------
// Step 1: Find target admin
// -----------------------------------------------------------------------

const adminQuery = targetEmployeeId
  ? db.prepare("SELECT id, employee_id, role FROM users WHERE employee_id = ? AND role = 'admin'")
      .get(targetEmployeeId) as { id: number; employee_id: string; role: string } | undefined
  : db.prepare("SELECT id, employee_id, role FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1")
      .get() as { id: number; employee_id: string; role: string } | undefined;

if (!adminQuery) {
  const msg = targetEmployeeId
    ? `No admin found with employee_id="${targetEmployeeId}".`
    : 'No admin users found in the database. Create one with scripts/createAdmin.ts first.';
  console.error(msg);
  process.exit(1);
}

console.log(`Target admin: id=${adminQuery.id} employee_id="${adminQuery.employee_id}" role=${adminQuery.role}`);

// -----------------------------------------------------------------------
// Step 2: Count rows to be updated
// -----------------------------------------------------------------------

const before = (db.prepare('SELECT COUNT(*) AS cnt FROM report_runs WHERE user_id IS NULL').get() as { cnt: number }).cnt;
console.log(`\nNULL-owned runs before migration: ${before}`);

if (before === 0) {
  console.log('Nothing to migrate — all runs already have an owner.');
  process.exit(0);
}

// -----------------------------------------------------------------------
// Step 3: Perform migration
// -----------------------------------------------------------------------

const result = db.prepare('UPDATE report_runs SET user_id = ? WHERE user_id IS NULL').run(adminQuery.id);
console.log(`Rows updated: ${result.changes}`);

// -----------------------------------------------------------------------
// Step 4: Verify
// -----------------------------------------------------------------------

const after = (db.prepare('SELECT COUNT(*) AS cnt FROM report_runs WHERE user_id IS NULL').get() as { cnt: number }).cnt;
console.log(`\nNULL-owned runs after migration: ${after}`);

if (after !== 0) {
  console.error('WARNING: Some rows still have NULL user_id. Investigate before proceeding.');
  process.exit(1);
}

// -----------------------------------------------------------------------
// Step 5: Sample output
// -----------------------------------------------------------------------

const sample = db.prepare(`
  SELECT id, report_date, source_filename, user_id
  FROM report_runs
  ORDER BY report_date DESC
  LIMIT 10
`).all() as Array<{ id: string; report_date: string; source_filename: string; user_id: number }>;

console.log('\nSample rows after migration:');
console.table(sample);
console.log('\nMigration completed successfully.');
