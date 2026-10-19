import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateEd25519KeyPair,
  signEd25519,
  verifyEd25519,
  signLeaseObject,
  signHmacSha256,
  verifyHmacSha256,
  LocalSigner,
} from './crypto';

test('crypto: ed25519 key generation, signing, and verification', () => {
  const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();
  assert.ok(privateKeyPem.includes('BEGIN PRIVATE KEY'));
  assert.ok(publicKeyPem.includes('BEGIN PUBLIC KEY'));

  const msg = Buffer.from('access-lease-payload-123');
  const sig = signEd25519(privateKeyPem, msg);
  assert.equal(sig.length, 64);

  const ok = verifyEd25519(publicKeyPem, msg, sig);
  assert.equal(ok, true);

  const tampered = Buffer.from('access-lease-payload-124');
  assert.equal(verifyEd25519(publicKeyPem, tampered, sig), false);
});

test('crypto: signLeaseObject produces verifiable base64 signature', async () => {
  const signer = new LocalSigner();
  const pubPem = await signer.publicKeyPem();
  const leaseObj = { lease_id: 'test-123', status: 'ACTIVE', monotonic_nonce: 5 };

  const sigBase64 = await signLeaseObject(signer, leaseObj);
  assert.ok(typeof sigBase64 === 'string' && sigBase64.length > 0);

  const { verifyLease } = await import('./signer');
  const { canonicalize } = await import('./canonical');
  const verified = verifyLease(pubPem, Buffer.from(canonicalize(leaseObj)), Buffer.from(sigBase64, 'base64'));
  assert.equal(verified, true);
});

test('crypto: hmac-sha256 sign and constant-time verification', () => {
  const secret = 'super-secret-key-456';
  const data = 'some-event-payload-raw-body';
  const sig = signHmacSha256(secret, data);

  assert.equal(verifyHmacSha256(secret, data, sig), true);
  assert.equal(verifyHmacSha256(secret, data + 'tamper', sig), false);
  assert.equal(verifyHmacSha256('wrong-secret', data, sig), false);
  assert.equal(verifyHmacSha256(secret, data, 'invalid-hex-length'), false);
});

test('access decision engine: handles edge cases defensively without crashing', async () => {
  const signer = new LocalSigner();
  const pubPem = await signer.publicKeyPem();
  const { canonicalize } = await import('./canonical');
  const { evaluateAccess } = await import('./verify');

  const now = new Date();
  const validMemberObj = {
    lease_id: 'l1', tenant_id: 'gym1', subject_type: 'MEMBER' as const, subject_id: 'm1',
    device_user_id: '1', valid_from: now.toISOString(), valid_until: new Date(now.getTime() + 86400000).toISOString(),
    grace_period_hours: 0, balance_due_paise: 0, balance_due_deadline: null, status: 'ACTIVE' as const, monotonic_nonce: 1,
  };
  const validMemberLease = {
    lease: validMemberObj,
    signature: (await signer.sign(Buffer.from(canonicalize(validMemberObj)))).toString('base64'),
  };

  const validGymObj = {
    lease_id: 'g1', tenant_id: 'gym1', subject_type: 'GYM' as const, subject_id: 'gym1',
    device_user_id: null, valid_from: now.toISOString(), valid_until: new Date(now.getTime() + 86400000).toISOString(),
    grace_period_hours: 0, balance_due_paise: 0, balance_due_deadline: null, status: 'ACTIVE' as const, monotonic_nonce: 1,
  };
  const validGymLease = {
    lease: validGymObj,
    signature: (await signer.sign(Buffer.from(canonicalize(validGymObj)))).toString('base64'),
  };

  // 1. null / undefined inputs
  assert.deepEqual(evaluateAccess({ member: null as any, gym: validGymLease, now, highWaterMark: new Date(now.getTime() - 1000), publicKeyPem: pubPem }), { allowed: false, reason: 'BAD_SIGNATURE' });
  assert.deepEqual(evaluateAccess({ member: validMemberLease, gym: null as any, now, highWaterMark: new Date(now.getTime() - 1000), publicKeyPem: pubPem }), { allowed: false, reason: 'BAD_SIGNATURE' });
  assert.deepEqual(evaluateAccess({ member: validMemberLease, gym: validGymLease, now, highWaterMark: new Date(now.getTime() - 1000), publicKeyPem: '' }), { allowed: false, reason: 'BAD_SIGNATURE' });

  // 2. invalid / corrupted dates in member valid_until
  const corruptMemberObj = { ...validMemberObj, valid_until: 'corrupted-date' };
  const corruptMember = {
    lease: corruptMemberObj,
    signature: (await signer.sign(Buffer.from(canonicalize(corruptMemberObj)))).toString('base64'),
  };
  assert.deepEqual(evaluateAccess({ member: corruptMember, gym: validGymLease, now, highWaterMark: new Date(now.getTime() - 1000), publicKeyPem: pubPem }), { allowed: false, reason: 'MEMBER_EXPIRED' });

  // 3. invalid clock / NaN
  assert.deepEqual(evaluateAccess({ member: validMemberLease, gym: validGymLease, now: new Date('invalid'), highWaterMark: now, publicKeyPem: pubPem }), { allowed: false, reason: 'CLOCK_ROLLBACK' });

  // 4. invalid valid_from in member or gym lease returns NOT_YET_VALID
  const corruptStartObj = { ...validMemberObj, valid_from: 'garbage-date' };
  const corruptStartMember = {
    lease: corruptStartObj,
    signature: (await signer.sign(Buffer.from(canonicalize(corruptStartObj)))).toString('base64'),
  };
  assert.deepEqual(evaluateAccess({ member: corruptStartMember, gym: validGymLease, now, highWaterMark: new Date(now.getTime() - 1000), publicKeyPem: pubPem }), { allowed: false, reason: 'NOT_YET_VALID' });

  // 5. non-standard status returns REVOKED
  const suspendedMemberObj = { ...validMemberObj, status: 'UNKNOWN_STATUS' as any };
  const suspendedMember = {
    lease: suspendedMemberObj,
    signature: (await signer.sign(Buffer.from(canonicalize(suspendedMemberObj)))).toString('base64'),
  };
  assert.deepEqual(evaluateAccess({ member: suspendedMember, gym: validGymLease, now, highWaterMark: new Date(now.getTime() - 1000), publicKeyPem: pubPem }), { allowed: false, reason: 'REVOKED' });

  // 6. verifyLease input bounds
  const { verifyLease } = await import('./signer');
  assert.equal(verifyLease('', Buffer.from('msg'), Buffer.alloc(64)), false);
  assert.equal(verifyLease(pubPem, null as any, Buffer.alloc(64)), false);
  assert.equal(verifyLease(pubPem, Buffer.from('msg'), Buffer.alloc(32)), false); // wrong length
});

