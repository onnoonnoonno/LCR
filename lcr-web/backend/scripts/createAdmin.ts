/**
 * Admin Account Creation Script
 *
 * Usage:
 *   npx ts-node scripts/createAdmin.ts <employeeId> <password>
 *
 * Example:
 *   npx ts-node scripts/createAdmin.ts 20260001 SecurePass#1
 *
 * Creates an admin account with must_change_password = 0.
 * Run this once to bootstrap the system.
 * If the employee_id already exists, the script exits with an error.
 */

import 'dotenv/config';
import bcrypt from 'bcrypt';
import { getDb } from '../src/db/client';

const [, , employeeId, password] = process.argv;

if (!employeeId || !password) {
  console.error('Usage: npx ts-node scripts/createAdmin.ts <employeeId> <password>');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
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
     VALUES (?, ?, 'admin', 0)`
  ).run(employeeId, hash);

  console.log(`Admin account created: employeeId="${employeeId}" id=${result.lastInsertRowid}`);
} catch (err) {
  console.error('Failed to create admin:', err);
  process.exit(1);
}
