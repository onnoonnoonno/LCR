/**
 * User Reset Script
 *
 * Deletes all existing users (safely nulling FK references first),
 * then creates fresh demo accounts.
 *
 * Usage:
 *   npx ts-node scripts/resetUsers.ts
 */

import 'dotenv/config';
import bcrypt from 'bcrypt';
import { getDb } from '../src/db/client';

const DEFAULT_PASSWORD = 'Welcome1';
const SALT_ROUNDS = 12;

const ADMIN = { employee_id: '24614315', role: 'admin', must_change_password: 0 };
const USER  = { employee_id: '12345678', role: 'user',  must_change_password: 1 };

try {
  const db = getDb();

  // 1. Null out report_runs.user_id to avoid FK violation when deleting users
  const nulled = db.prepare(`UPDATE report_runs SET user_id = NULL WHERE user_id IS NOT NULL`).run();
  console.log(`Cleared user_id on ${nulled.changes} report run(s).`);

  // 2. Delete all users
  const deleted = db.prepare(`DELETE FROM users`).run();
  console.log(`Deleted ${deleted.changes} existing user(s).`);

  // 3. Reset autoincrement counter
  db.exec(`DELETE FROM sqlite_sequence WHERE name = 'users'`);

  // 4. Create admin account (no forced password change)
  const adminHash = bcrypt.hashSync(DEFAULT_PASSWORD, SALT_ROUNDS);
  const adminResult = db.prepare(
    `INSERT INTO users (employee_id, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?)`
  ).run(ADMIN.employee_id, adminHash, ADMIN.role, ADMIN.must_change_password);
  console.log(`Created admin: employee_id="${ADMIN.employee_id}" id=${adminResult.lastInsertRowid}`);

  // 5. Create regular user (must change password on first login)
  const userHash = bcrypt.hashSync(DEFAULT_PASSWORD, SALT_ROUNDS);
  const userResult = db.prepare(
    `INSERT INTO users (employee_id, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?)`
  ).run(USER.employee_id, userHash, USER.role, USER.must_change_password);
  console.log(`Created user:  employee_id="${USER.employee_id}" id=${userResult.lastInsertRowid}`);

  // 6. Show final user list
  const users = db.prepare(
    `SELECT id, employee_id, role, must_change_password, created_at FROM users ORDER BY id`
  ).all();

  console.log('\n--- Final User List ---');
  console.table(users);
  console.log(`Default password for both accounts: "${DEFAULT_PASSWORD}"`);
  console.log('Admin: must_change_password=0 (no forced change)');
  console.log('User:  must_change_password=1 (must change on first login)');

} catch (err) {
  console.error('Reset failed:', err);
  process.exit(1);
}
