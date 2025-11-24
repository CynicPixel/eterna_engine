import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/eterna_engine';

export const pool = new Pool({ connectionString });

export async function initDb() {
  // noop: migrations are managed by scripts/migrate.ts
  await pool.query('SELECT 1');
}
