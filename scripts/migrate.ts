import 'dotenv/config';
import { pool } from '../src/db/client';
import fs from 'fs';
import path from 'path';

async function run() {
  const migrationsDir = path.join(__dirname, '..', 'src', 'db', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    console.log('Running migration', f);
    await pool.query(sql);
  }
  console.log('Migrations applied');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
