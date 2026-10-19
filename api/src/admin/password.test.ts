import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from './password';

test('password: hash and verify matching password', async () => {
  const hash = await hashPassword('my-secure-password-123');
  assert.ok(hash.includes(':'));
  const ok = await verifyPassword('my-secure-password-123', hash);
  assert.equal(ok, true);
});

test('password: wrong password is rejected', async () => {
  const hash = await hashPassword('my-secure-password-123');
  const ok = await verifyPassword('wrong-password', hash);
  assert.equal(ok, false);
});

test('password: handles corrupted and malformed hashes without crashing', async () => {
  assert.equal(await verifyPassword('password', ''), false);
  assert.equal(await verifyPassword('password', 'not-a-hash'), false);
  assert.equal(await verifyPassword('password', ':'), false);
  assert.equal(await verifyPassword('password', 'salt-only:'), false);
  assert.equal(await verifyPassword(null as any, 'valid:hash'), false);
  assert.equal(await verifyPassword('password', null as any), false);
  assert.equal(await verifyPassword('password', '1234:5678'), false); // too short hex
});
