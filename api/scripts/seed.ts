import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { hashToken } from '../src/sync/device.service';

async function main() {
  const [tenantId, tenantName, label] = process.argv.slice(2);
  if (!tenantId || !tenantName) throw new Error('usage: seed <tenant_id> <tenant_name> [device_label]');
  const db = new Client({ connectionString: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL });
  await db.connect();
  await db.query('BEGIN');
  await db.query("SELECT set_config('app.role', 'super', true)");
  await db.query('INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tenantId, tenantName]);
  const token = randomBytes(32).toString('base64url');
  const deviceId = 'dev_' + randomBytes(6).toString('hex');
  await db.query('INSERT INTO devices (id, tenant_id, label, token_hash) VALUES ($1, $2, $3, $4)', [deviceId, tenantId, label ?? 'front-desk', hashToken(token)]);
  await db.query('COMMIT');
  console.log(JSON.stringify({ tenantId, deviceId, token }, null, 2));
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
