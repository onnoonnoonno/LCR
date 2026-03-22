/**
 * User Account Creation Script
 *
 * Usage:
 *   npx ts-node scripts/createUser.ts <employeeId> <initialPassword> [role]
 *
 * Example:
 *   npx ts-node scripts/createUser.ts 20260042 TempPass#1
 *   npx ts-node scripts/createUser.ts 20260042 TempPass#1 admin
 *
 * Creates a user with must_change_password = 1 (user must change on first login).
 * role defaults to 'user'. Pass 'admin' to create an admin.
 */

import 'dotenv/config';
import bcrypt from 'bcrypt';
import { getDb } from '../src/db/client';

const [, , employeeId, password, role = 'user'] = process.argv;

if (!employeeId || !password) {
  console.error('Usage: npx ts-node scripts/createUser.ts <employeeId> <initialPassword> [role]');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

if (!['user', 'admin'].includes(role)) {
  console.error('role must be "user" or "admin".');
  process.exit(1);
}

try {
  const db = getDb();

  const existing = db.prepare('SELECT id FROM users WHERE employee_id = ?').get(employeeId);
  if (existing) {
    console.error(`Employee ID "${employeeId}" already exists.`);
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(
    `INSERT INTO users (employee_id, password_hash, role, must_change_password)
     VALUES (?, ?, ?, 1)`
  ).run(employeeId, hash, role);

  console.log(
    `User created: employeeId="${employeeId}" role="${role}" id=${result.lastInsertRowid}` +
    ` — user must change password on first login.`
  );
} catch (err) {
  console.error('Failed to create user:', err);
  process.exit(1);
}
