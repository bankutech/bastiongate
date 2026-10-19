import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { runEdge } from './edge-sim';

const BASE = process.env.BASE ?? 'http://localhost:3999';
const env = (k: string) => process.env[k] ?? (() => { throw new Error(`set ${k}`); })();
const WEBHOOK_SECRET = env('WEBHOOK_SECRET');

type Res = { status: number; json: any; headers: Headers; text: string };
async function http(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}): Promise<Res> {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(opts.body !== undefined || opts.raw !== undefined ? { 'content-type': 'application/json' } : {}), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, headers: res.headers, text };
}

let passed = 0;
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); passed += 1; console.log('  ok  ', name); }
  catch (err) { console.error('  FAIL', name, '\n      ', (err as Error).message); process.exitCode = 1; throw err; }
}
async function waitFor<T>(fn: () => Promise<T | undefined | false>, what: string, ms = 12_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 250)); }
  throw new Error(`timed out waiting for ${what}`);
}
const login = async (email: string, password: string) => (await http('POST', '/v1/auth/login', { body: { email, password } })).json.token as string;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function pullAll(token: string) {
  const items: any[] = [];
  let cursor = 0;
  for (;;) {
    const r = (await http('GET', `/v1/sync/pull?cursor=${cursor}&limit=200`, { token })).json;
    items.push(...r.items);
    cursor = r.next_cursor;
    if (!r.has_more) return items;
  }
}
const hook = (eventId: string, body: unknown, sig?: string) => {
  const raw = JSON.stringify(body);
  return http('POST', '/v1/webhooks/razorpay', { raw, headers: { 'x-razorpay-event-id': eventId, 'x-razorpay-signature': sig ?? createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex') } });
};

async function main() {
  const run = randomUUID().slice(0, 8);
  const A = `gym_a_${run}`, B = `gym_b_${run}`;
  const ev = (kind: string, body: object, id = randomUUID()) => ({ event_id: id, kind, occurred_at: new Date().toISOString(), body });
  let owner = '', support = '', tokA = '', tokB = '';

  console.log('service');
  await step('health, console page and headers', async () => {
    assert.equal((await http('GET', '/health')).json.ok, true);
    const page = await http('GET', '/admin');
    assert.equal(page.status, 200);
    assert.match(page.text, /BastionGate console/);
    assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  });

  console.log('auth');
  await step('login, bad password, lockout, forged token', async () => {
    owner = await login(env('OWNER_EMAIL'), env('OWNER_PASS'));
    support = await login(env('SUPPORT_EMAIL'), env('SUPPORT_PASS'));
    assert.ok(owner && support);
    assert.equal((await http('POST', '/v1/auth/login', { body: { email: env('OWNER_EMAIL'), password: 'wrong-wrong-wrong' } })).status, 401);
    const ghost = `ghost_${run}@x.test`;
    for (let i = 0; i < 5; i++) await http('POST', '/v1/auth/login', { body: { email: ghost, password: 'a' } });
    assert.equal((await http('POST', '/v1/auth/login', { body: { email: ghost, password: 'a' } })).status, 429);
    assert.equal((await http('GET', '/v1/admin/fleet')).status, 401);
    assert.equal((await http('GET', '/v1/admin/fleet', { token: 'aaa.bbb.ccc' })).status, 401);
  });
  await step('roles: support reads, owner writes', async () => {
    assert.equal((await http('GET', '/v1/admin/fleet', { token: support })).status, 200);
    assert.equal((await http('POST', '/v1/admin/tenants', { token: support, body: { id: A, name: 'A' } })).status, 403);
    assert.equal((await http('POST', '/v1/admin/tenants', { token: owner, body: { id: A, name: 'Gym A' } })).status, 201);
    assert.equal((await http('POST', '/v1/admin/tenants', { token: owner, body: { id: B, name: 'Gym B' } })).status, 201);
    assert.equal((await http('POST', '/v1/admin/tenants', { token: owner, body: { id: A, name: 'dup' } })).status, 409);
    tokA = (await http('POST', `/v1/admin/tenants/${A}/devices`, { token: owner, body: { label: 'desk' } })).json.token;
    tokB = (await http('POST', `/v1/admin/tenants/${B}/devices`, { token: owner, body: { label: 'desk' } })).json.token;
    assert.ok(tokA && tokB);
  });

  console.log('leads');
  await step('demo form: validation, honeypot, storage, throttle', async () => {
    assert.equal((await http('POST', '/v1/leads', { body: { name: 'X', contact: 'nope' } })).status, 400);
    assert.equal((await http('POST', '/v1/leads', { body: { contact: 'a@b.co' } })).status, 400);
    assert.equal((await http('POST', '/v1/leads', { body: { name: 'Bot', contact: 'bot@spam.co', website: 'http://spam' } })).status, 201);
    assert.equal((await http('POST', '/v1/leads', { body: { name: `Asha ${run}`, gym_name: 'Iron', contact: '+91 98000 00001', message: 'two gates' } })).status, 201);
    const list = (await http('GET', '/v1/admin/leads', { token: support })).json.leads as any[];
    assert.ok(list.some(l => l.name === `Asha ${run}`));
    assert.ok(!list.some(l => l.name === 'Bot'));
    for (let i = 0; i < 3; i++) assert.equal((await http('POST', '/v1/leads', { body: { name: 'N', contact: 'n@n.co' } })).status, 201);
    assert.equal((await http('POST', '/v1/leads', { body: { name: 'N', contact: 'n@n.co' } })).status, 201);
    assert.equal((await http('POST', '/v1/leads', { body: { name: 'N', contact: 'n@n.co' } })).status, 429);
    assert.equal((await http('GET', '/v1/admin/leads')).status, 401);
  });

  console.log('sync');
  const memId = `mem_${run}`, mem2 = `mem2_${run}`;
  await step('push is idempotent, validated and tenant-scoped', async () => {
    const dup = randomUUID();
    const first = (await http('POST', '/v1/sync/push', { token: tokA, body: { events: [
      ev('CHECK_IN', { member_id: memId }, dup), ev('CHECK_IN', { member_id: memId }, dup),
      ev('MEMBER_ENROLLED', { member_id: memId, device_user_id: '1001', full_name: 'Ravi K', phone: '+919800000007' }),
      { event_id: 'nope', kind: 'CHECK_IN', occurred_at: new Date().toISOString(), body: {} },
    ] } })).json;
    assert.equal(first.acknowledged.length, 3);
    assert.equal(first.rejected.length, 1);
    assert.equal((await http('POST', '/v1/sync/push', { token: tokA, body: { events: [] } })).status, 400);
    assert.equal((await http('GET', '/v1/sync/pull')).status, 401);
    assert.equal((await http('GET', '/v1/sync/pull?cursor=-1', { token: tokA })).status, 400);
    await http('POST', '/v1/sync/push', { token: tokA, body: { events: [ev('MEMBER_ENROLLED', { member_id: mem2, device_user_id: '1002', full_name: 'Meena' })] } });
  });

  console.log('billing and access decisions');
  const notes = (id: string, du: string) => ({ tenant_id: A, subject_type: 'MEMBER', subject_id: id, device_user_id: du });
  const leaseCount = async (id: string, status: string) => (await pullAll(tokA)).filter(i => i.kind === 'LEASE' && i.body.lease.subject_id === id && i.body.lease.status === status).length;
  await step('master lease exists from onboarding', async () => {
    const edge = await runEdge(BASE, tokA);
    assert.deepEqual(edge.decisions, {});
    assert.ok((await pullAll(tokA)).some(i => i.kind === 'LEASE' && i.body.lease.subject_type === 'GYM' && i.body.lease.status === 'ACTIVE'));
  });
  await step('signature check, replay safety, member enters', async () => {
    const charged = { event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_1', current_end: Math.floor(Date.now() / 1000) + 30 * 86400, notes: notes(memId, '1001') } } } };
    assert.equal((await hook(`evt_${run}_1`, charged, 'deadbeef')).status, 401);
    assert.equal((await hook(`evt_${run}_1`, charged)).status, 200);
    assert.equal((await hook(`evt_${run}_1`, charged)).status, 200);
    await waitFor(async () => (await leaseCount(memId, 'ACTIVE')) >= 1, 'member lease');
    await sleep(1500);
    assert.equal(await leaseCount(memId, 'ACTIVE'), 1);
    assert.ok((await pullAll(tokA)).some(i => i.kind === 'COMMAND' && i.body.command === 'USER_SET_EXPIRY'));
    assert.deepEqual((await runEdge(BASE, tokA)).decisions[memId], { allowed: true });
  });
  await step('failed payment: grace lease, one payment link, still inside grace', async () => {
    const failed = { event: 'payment.failed', payload: { payment: { entity: { id: `pay_${run}`, amount: 150000, notes: notes(memId, '1001') } } } };
    await hook(`evt_${run}_2`, failed);
    await hook(`evt_${run}_3`, failed);
    await waitFor(async () => (await leaseCount(memId, 'GRACE')) >= 1, 'grace lease');
    await sleep(1500);
    const items = await pullAll(tokA);
    const grace = items.find(i => i.kind === 'LEASE' && i.body.lease.subject_id === memId && i.body.lease.status === 'GRACE')?.body.lease;
    assert.ok(grace);
    assert.equal(grace.grace_period_hours, 0);
    const hoursUntil = (Date.parse(grace.valid_until) - Date.now()) / (3600 * 1000);
    assert.ok(hoursUntil >= 47 && hoursUntil <= 49);
    assert.equal(items.filter(i => i.kind === 'PAYMENT_LINK').length, 1);
    assert.match(items.find(i => i.kind === 'PAYMENT_LINK').body.short_url, /^https:\/\/rzp\.io\//);
    assert.deepEqual((await runEdge(BASE, tokA)).decisions[memId], { allowed: true });
  });
  await step('payment link paid restores an active lease', async () => {
    const before = await leaseCount(memId, 'ACTIVE');
    await hook(`evt_${run}_4`, { event: 'payment_link.paid', payload: { payment_link: { entity: { id: 'plink_x', notes: notes(memId, '1001') } } } });
    await waitFor(async () => (await leaseCount(memId, 'ACTIVE')) > before, 'restored lease');
    assert.deepEqual((await runEdge(BASE, tokA)).decisions[memId], { allowed: true });
  });
  await step('cancelled subscription is refused at the door', async () => {
    await hook(`evt_${run}_5`, { event: 'subscription.cancelled', payload: { subscription: { entity: { id: 'sub_1', notes: notes(memId, '1001') } } } });
    await waitFor(async () => (await leaseCount(memId, 'REVOKED')) >= 1, 'revocation');
    assert.deepEqual((await runEdge(BASE, tokA)).decisions[memId], { allowed: false, reason: 'REVOKED' });
    assert.ok((await pullAll(tokA)).some(i => i.kind === 'COMMAND' && i.body.command === 'USER_DISABLE'));
  });
  await step('late webhook that arrives out of order is ignored', async () => {
    const mem3 = `mem3_${run}`;
    const T = Math.floor(Date.now() / 1000);
    await hook(`evt_${run}_ooo1`, { event: 'subscription.cancelled', created_at: T + 60, payload: { subscription: { entity: { id: 'sub_3', notes: notes(mem3, '1003') } } } });
    await waitFor(async () => (await leaseCount(mem3, 'REVOKED')) >= 1, 'revocation of third member');
    await hook(`evt_${run}_ooo2`, { event: 'subscription.charged', created_at: T, payload: { subscription: { entity: { id: 'sub_3', current_end: T + 30 * 86400, notes: notes(mem3, '1003') } } } });
    await sleep(2500);
    assert.equal(await leaseCount(mem3, 'ACTIVE'), 0);
    assert.deepEqual((await runEdge(BASE, tokA)).decisions[mem3], { allowed: false, reason: 'REVOKED' });
  });
  await step('suspending the gym locks everyone, reinstating reopens', async () => {
    await hook(`evt_${run}_6`, { event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_2', current_end: Math.floor(Date.now() / 1000) + 30 * 86400, notes: notes(mem2, '1002') } } } });
    await waitFor(async () => (await leaseCount(mem2, 'ACTIVE')) >= 1, 'second member lease');
    assert.deepEqual((await runEdge(BASE, tokA)).decisions[mem2], { allowed: true });
    assert.equal((await http('POST', `/v1/admin/tenants/${A}/suspend`, { token: support })).status, 403);
    assert.equal((await http('POST', `/v1/admin/tenants/${A}/suspend`, { token: owner })).status, 200);
    assert.deepEqual((await runEdge(BASE, tokA)).decisions[mem2], { allowed: false, reason: 'REVOKED' });
    assert.equal((await http('POST', `/v1/admin/tenants/${A}/reinstate`, { token: owner })).status, 200);
    assert.deepEqual((await runEdge(BASE, tokA)).decisions[mem2], { allowed: true });
  });
  await step('gym mandate halted suspends the gym; commands are validated', async () => {
    await hook(`evt_${run}_7`, { event: 'subscription.halted', payload: { subscription: { entity: { id: 'sub_g', notes: { tenant_id: A, subject_type: 'GYM', subject_id: A } } } } });
    await waitFor(async () => (await http('GET', '/v1/admin/fleet', { token: support })).json.tenants.find((t: any) => t.id === A)?.status === 'SUSPENDED', 'suspension');
    assert.equal((await http('POST', `/v1/admin/tenants/${A}/commands`, { token: owner, body: { command: 'FORMAT_C' } })).status, 400);
    assert.equal((await http('POST', `/v1/admin/tenants/${A}/commands`, { token: owner, body: { command: 'TERMINAL_REBOOT' } })).status, 201);
  });
  await step('tenant isolation on pull', async () => {
    assert.equal((await pullAll(tokB)).filter(i => i.kind !== 'LEASE' || i.body.lease.tenant_id !== B).length, 0);
  });

  console.log('support desk');
  await step('ticket lifecycle, SLA, fan-out, injection guard', async () => {
    const tk = randomUUID(), again = randomUUID();
    await http('POST', '/v1/sync/push', { token: tokA, body: { events: [ev('SUPPORT_TICKET', { ticket_id: tk, subject: 'Gate 2 stuck', message: 'Rejects everyone', diagnostics: { outbox_backlog: 12 } })] } });
    await http('POST', '/v1/sync/push', { token: tokA, body: { events: [ev('SUPPORT_TICKET', { ticket_id: tk, message: 'Still broken' }, again)] } });
    await http('POST', '/v1/sync/push', { token: tokA, body: { events: [ev('SUPPORT_TICKET', { ticket_id: tk, message: 'Still broken' }, again)] } });
    const open = (await http('GET', '/v1/admin/tickets?status=OPEN', { token: support })).json.tickets as any[];
    const mine = open.find(t => t.id === tk);
    assert.ok(mine && mine.sla_breached === false);
    assert.equal((await http('POST', `/v1/admin/tickets/${tk}/reply`, { token: support, body: { body: 'Checking the relay' } })).status, 201);
    assert.ok((await pullAll(tokA)).some(i => i.kind === 'TICKET_REPLY' && i.body.ticket_id === tk && i.body.status === 'PENDING'));
    await http('POST', '/v1/sync/push', { token: tokA, body: { events: [ev('SUPPORT_TICKET', { ticket_id: tk, message: 'Rebooted too' })] } });
    let t = (await http('GET', `/v1/admin/tickets/${tk}`, { token: support })).json;
    assert.equal(t.status, 'OPEN');
    assert.deepEqual(t.replies.map((r: any) => r.author), ['GYM', 'GYM', 'ADMIN', 'GYM']);
    await http('POST', `/v1/admin/tickets/${tk}/reply`, { token: support, body: { body: 'Fixed', resolve: true } });
    await http('POST', '/v1/sync/push', { token: tokB, body: { events: [ev('SUPPORT_TICKET', { ticket_id: tk, message: 'intruder' })] } });
    t = (await http('GET', `/v1/admin/tickets/${tk}`, { token: support })).json;
    assert.equal(t.status, 'RESOLVED');
    assert.equal(t.replies.length, 5);
    assert.equal((await http('GET', '/v1/admin/tickets/not-a-uuid', { token: support })).status, 400);
  });

  console.log('telemetry and Route');
  await step('heartbeat and tamper alert reach the fleet view', async () => {
    assert.equal((await http('POST', '/v1/sync/heartbeat', { token: tokB, body: { app_version: '2.0.1', outbox_backlog: 37, clock_skew_seconds: 2, tamper_flags: [] } })).status, 200);
    await http('POST', '/v1/sync/push', { token: tokB, body: { events: [ev('TAMPER_ALERT', { reason: 'clock_rollback' })] } });
    const t = (await http('GET', '/v1/admin/fleet', { token: support })).json.tenants.find((x: any) => x.id === B);
    assert.equal(t.tamper_alerts_24h, 1);
    assert.equal(t.devices[0].heartbeat.outbox_backlog, 37);
  });
  await step('Route onboarding resumes, validates, refuses repeats', async () => {
    const body = { email: 'o@iron.test', phone: '9800000001', legal_business_name: 'Iron LLP', business_type: 'partnership', contact_name: 'S Rao', pan: 'ABCDE1234F', category: 'services', subcategory: 'fitness', street1: '12 100ft Rd', city: 'Bengaluru', state: 'KARNATAKA', postal_code: '560038', bank_account_number: '1234567890', bank_ifsc: 'HDFC0001234', bank_beneficiary_name: 'Iron LLP' };
    assert.equal((await http('POST', `/v1/admin/tenants/${B}/route-account`, { token: support, body })).status, 403);
    assert.equal((await http('POST', `/v1/admin/tenants/${B}/route-account`, { token: owner, body: { email: 'a@b.c' } })).status, 400);
    const done = await http('POST', `/v1/admin/tenants/${B}/route-account`, { token: owner, body });
    assert.equal(done.json.step, 'DONE');
    assert.equal((await http('POST', `/v1/admin/tenants/${B}/route-account`, { token: owner, body })).status, 409);
    assert.equal((await http('GET', `/v1/admin/tenants/${B}/route-account`, { token: owner })).json.step, 'DONE');
  });

  console.log('session control');
  await step('disabling an admin kills their token at once', async () => {
    const db = new Client({ connectionString: env('MIGRATE_DATABASE_URL') });
    await db.connect();
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.role', 'super', true)");
    await db.query('UPDATE admins SET disabled = true WHERE email = $1', [env('SUPPORT_EMAIL')]);
    await db.query('COMMIT');
    await db.end();
    assert.equal((await http('GET', '/v1/admin/fleet', { token: support })).status, 401);
  });
}

main().then(() => console.log(`\nall ${passed} steps passed`), () => process.exit(1));
