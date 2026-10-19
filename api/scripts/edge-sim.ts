import { SignedLease } from '../src/lease/lease.types';
import { Decision, evaluateAccess } from '../src/lease/verify';

export async function runEdge(base: string, token: string) {
  const headers = { authorization: `Bearer ${token}` };
  const keyRes = await fetch(`${base}/v1/leases/public-key`);
  const { pem } = (await keyRes.json()) as { pem: string };

  const latest = new Map<string, SignedLease>();
  const other: { seq: number; kind: string; body: any }[] = [];
  let cursor = 0;
  for (;;) {
    const res = await fetch(`${base}/v1/sync/pull?cursor=${cursor}&limit=200`, { headers });
    if (!res.ok) throw new Error(`pull failed ${res.status}`);
    const page = (await res.json()) as { items: { seq: number; kind: string; body: any }[]; next_cursor: number; has_more: boolean };
    for (const item of page.items) {
      if (item.kind !== 'LEASE') { other.push(item); continue; }
      const signed = item.body as SignedLease;
      const key = `${signed.lease.subject_type}:${signed.lease.subject_id}`;
      const held = latest.get(key);
      if (!held || signed.lease.monotonic_nonce > held.lease.monotonic_nonce) latest.set(key, signed);
    }
    cursor = page.next_cursor;
    if (!page.has_more) break;
  }

  const gym = [...latest.values()].find(l => l.lease.subject_type === 'GYM');
  const now = new Date();
  const decisions: Record<string, Decision> = {};
  for (const signed of latest.values()) {
    if (signed.lease.subject_type !== 'MEMBER') continue;
    decisions[signed.lease.subject_id] = gym
      ? evaluateAccess({ member: signed, gym, now, highWaterMark: new Date(now.getTime() - 1000), publicKeyPem: pem })
      : { allowed: false, reason: 'GYM_EXPIRED' };
  }
  return { decisions, other, cursor };
}

if (require.main === module) {
  const [base, token] = process.argv.slice(2);
  if (!base || !token) throw new Error('usage: edge-sim <base_url> <device_token>');
  runEdge(base, token).then(r => console.log(JSON.stringify(r.decisions, null, 2)));
}
