import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set MIGRATE_DATABASE_URL with an owner role, not the app role');
  const db = new Client({ connectionString: url });
  await db.connect();
  await db.query('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, ran_at timestamptz DEFAULT now())');
  const candidates = [
    join(process.cwd(), 'migrations'),
    join(process.cwd(), 'api', 'migrations'),
    join(__dirname, '..', 'migrations'),
    join(__dirname, '..', '..', 'migrations'),
  ];
  const dir = candidates.find(p => existsSync(p));
  if (!dir) throw new Error('migrations directory not found, tried: ' + candidates.join(', '));
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    const done = await db.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (done.rowCount) continue;
    await db.query('BEGIN');
    try {
      await db.query(readFileSync(join(dir, file), 'utf8'));
      await db.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await db.query('COMMIT');
      console.log('applied', file);
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  }
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
