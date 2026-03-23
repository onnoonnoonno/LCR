/**
 * PostgreSQL client singleton (pg Pool).
 *
 * Connection is configured via the DATABASE_URL environment variable.
 * For local dev:      set DATABASE_URL in .env (e.g. postgres://user:pass@localhost:5432/lcr)
 * For Render/Supabase: set DATABASE_URL in the service environment variables.
 *
 * Schema DDL lives in backend/schema.sql — apply it once in Supabase SQL Editor.
 */

import { Pool } from 'pg';

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL environment variable is not set. ' +
      'Add it to .env for local dev or to Render environment variables for production.'
    );
  }

  _pool = new Pool({
    connectionString,
    // Supabase and Render Postgres require TLS in production
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
    max: 10,
    idleTimeoutMillis:    30_000,
    connectionTimeoutMillis: 5_000,
  });

  _pool.on('error', (err) => {
    console.error('[pg] Unexpected pool error:', err.message);
  });

  console.log('[db] PostgreSQL pool created');
  return _pool;
}
