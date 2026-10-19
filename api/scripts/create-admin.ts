import { Client } from 'pg';
import { hashPassword } from '../src/admin/password';

async function main() {
  const [email, password, role] = process.argv.slice(2);
  if (!email || !password || (role !== 'OWNER' && role !== 'SUPPORT')) throw new Error('usage: create-admin <email> <password> <OWNER|SUPPORT>');
  if (password.length < 12) throw new Error('password needs at least 12 characters');
  const db = new Client({ connectionString: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL });
  await db.connect();
  await db.query('BEGIN');
  await db.query("SELECT set_config('app.role', 'super', true)");
  await db.query('INSERT INTO admins (email, password_hash, role) VALUES ($1, $2, $3)', [email.trim().toLowerCase(), await hashPassword(password), role]);
  await db.query('COMMIT');
  console.log('created', role, email);
  await db.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
