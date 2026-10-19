import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalize } from './canonical';
import { Lease, SignedLease } from './lease.types';
import { evaluateAccess } from './verify';
import { LocalSigner } from './signer';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-20T10:00:00Z');
const at = (h: number) => new Date(NOW.getTime() + h * HOUR).toISOString();

async function setup() {
  const signer = new LocalSigner();
  const publicKeyPem = await signer.publicKeyPem();
  const sign = async (patch: Partial<Lease>): Promise<SignedLease> => {
    const lease: Lease = {
      lease_id: 'l', tenant_id: 'gym_a', subject_type: 'MEMBER', subject_id: 'mem_1', device_user_id: '1', valid_from: at(-720),
      valid_until: at(240), grace_period_hours: 48, balance_due_paise: 0, balance_due_deadline: null, status: 'ACTIVE', monotonic_nonce: 1, ...patch,
    };
    return { lease, signature: (await signer.sign(Buffer.from(canonicalize(lease)))).toString('base64') };
  };
  const gym = await sign({ subject_type: 'GYM', subject_id: 'gym_a', valid_until: at(168), grace_period_hours: 0 });
  const run = (member: SignedLease, over: Partial<Parameters<typeof evaluateAccess>[0]> = {}) =>
    evaluateAccess({ member, gym, now: NOW, highWaterMark: new Date(NOW.getTime() - 60_000), publicKeyPem, ...over });
  return { sign, gym, run, publicKeyPem };
}

test('valid leases open the door', async () => {
  const { sign, run } = await setup();
  assert.deepEqual(run(await sign({})), { allowed: true });
});

test('tampered lease is rejected', async () => {
  const { sign, run } = await setup();
  const m = await sign({});
  m.lease.valid_until = at(9999);
  assert.deepEqual(run(m), { allowed: false, reason: 'BAD_SIGNATURE' });
});

test('member inside grace window still enters, outside does not', async () => {
  const { sign, run } = await setup();
  assert.equal(run(await sign({ valid_until: at(-47) })).allowed, true);
  assert.deepEqual(run(await sign({ valid_until: at(-49) })), { allowed: false, reason: 'MEMBER_EXPIRED' });
});

test('grace lease shaped like billing service emits is allowed at +47h and refused at +49h', async () => {
  const { sign, run } = await setup();
  const lease = await sign({ status: 'GRACE', valid_until: at(48), grace_period_hours: 0, balance_due_paise: 0 });
  assert.equal(run(lease, { now: new Date(NOW.getTime() + 47 * HOUR) }).allowed, true);
  assert.deepEqual(run(lease, { now: new Date(NOW.getTime() + 49 * HOUR) }), { allowed: false, reason: 'MEMBER_EXPIRED' });
});

test('lease not yet valid is refused', async () => {
  const { sign, run } = await setup();
  assert.deepEqual(run(await sign({ valid_from: at(24) })), { allowed: false, reason: 'NOT_YET_VALID' });
  const futureGym = await sign({ subject_type: 'GYM', subject_id: 'gym_a', valid_from: at(24), valid_until: at(168), grace_period_hours: 0 });
  assert.deepEqual(run(await sign({}), { gym: futureGym }), { allowed: false, reason: 'NOT_YET_VALID' });
});

test('clock rolled back below the high-water mark is refused', async () => {
  const { sign, run } = await setup();
  assert.deepEqual(run(await sign({}), { highWaterMark: new Date(NOW.getTime() + 1000) }), { allowed: false, reason: 'CLOCK_ROLLBACK' });
});

test('gym lease lapse locks everyone', async () => {
  const { sign, run } = await setup();
  assert.deepEqual(run(await sign({}), { now: new Date(NOW.getTime() + 200 * HOUR), highWaterMark: NOW }), { allowed: false, reason: 'GYM_EXPIRED' });
});

test('balance due is fine until its deadline, then refused', async () => {
  const { sign, run } = await setup();
  assert.equal(run(await sign({ balance_due_paise: 5000, balance_due_deadline: at(5) })).allowed, true);
  assert.deepEqual(run(await sign({ balance_due_paise: 5000, balance_due_deadline: at(-1) })), { allowed: false, reason: 'BALANCE_OVERDUE' });
  assert.deepEqual(run(await sign({ balance_due_paise: 5000, balance_due_deadline: null })), { allowed: false, reason: 'BALANCE_OVERDUE' });
});

test('revoked member or gym is refused', async () => {
  const { sign, run, gym } = await setup();
  assert.deepEqual(run(await sign({ status: 'REVOKED' })), { allowed: false, reason: 'REVOKED' });
  const dead = await sign({ subject_type: 'GYM', subject_id: 'gym_a', status: 'REVOKED' });
  assert.deepEqual(run(await sign({}), { gym: dead }), { allowed: false, reason: 'REVOKED' });
  assert.ok(gym);
});

test('lease from another gym is refused', async () => {
  const { sign, run } = await setup();
  assert.deepEqual(run(await sign({ tenant_id: 'gym_other' })), { allowed: false, reason: 'WRONG_SUBJECT' });
});
