import 'reflect-metadata';
import { DbService } from '../src/db/db.service';
import { LeaseService } from '../src/lease/lease.service';
import { DownstreamService } from '../src/sync/downstream.service';

async function main() {
  const [tenantId, memberId, deviceUserId, days] = process.argv.slice(2);
  if (!tenantId || !memberId) throw new Error('usage: issue-lease <tenant> <member_id> <device_user_id> [days]');
  const db = new DbService();
  const leases = new LeaseService(db, new DownstreamService(db));
  const now = new Date();
  const signed = await leases.issue(tenantId, {
    subjectType: 'MEMBER', subjectId: memberId, deviceUserId,
    validFrom: now, validUntil: new Date(now.getTime() + Number(days ?? 30) * 86_400_000),
  });
  console.log(JSON.stringify(signed));
  await db.onModuleDestroy();
}

main().catch(err => { console.error(err); process.exit(1); });
