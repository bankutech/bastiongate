import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signJwt, verifyJwt } from './jwt';
import { config } from '../config';

test('jwt: sign and verify claims with valid secret', () => {
  const orig = config.jwtSecret;
  config.jwtSecret = 'a-very-long-secret-key-at-least-32-chars-long';
  try {
    const claims = { sub: 'admin-1', email: 'owner@test.com', role: 'OWNER' as const };
    const token = signJwt(claims, 3600);
    assert.ok(typeof token === 'string' && token.split('.').length === 3);

    const verified = verifyJwt(token);
    assert.ok(verified);
    assert.equal(verified?.sub, 'admin-1');
    assert.equal(verified?.email, 'owner@test.com');
    assert.equal(verified?.role, 'OWNER');
    assert.ok(verified?.exp && verified.exp > Date.now() / 1000);
  } finally {
    config.jwtSecret = orig;
  }
});

test('jwt: rejects tampered signature', () => {
  const orig = config.jwtSecret;
  config.jwtSecret = 'a-very-long-secret-key-at-least-32-chars-long';
  try {
    const token = signJwt({ sub: 'admin-1', email: 'owner@test.com', role: 'OWNER' }, 3600);
    const parts = token.split('.');
    parts[2] = 'tampered-signature';
    assert.equal(verifyJwt(parts.join('.')), null);
  } finally {
    config.jwtSecret = orig;
  }
});

test('jwt: rejects expired tokens', () => {
  const orig = config.jwtSecret;
  config.jwtSecret = 'a-very-long-secret-key-at-least-32-chars-long';
  try {
    const token = signJwt({ sub: 'admin-1', email: 'owner@test.com', role: 'OWNER' }, -10);
    assert.equal(verifyJwt(token), null);
  } finally {
    config.jwtSecret = orig;
  }
});

test('jwt: refuses to operate when secret is too short or missing', () => {
  const orig = config.jwtSecret;
  config.jwtSecret = 'short-secret';
  try {
    assert.throws(() => signJwt({ sub: 'admin-1', email: 'owner@test.com', role: 'OWNER' }, 3600));
    assert.equal(verifyJwt('header.payload.sig'), null);
  } finally {
    config.jwtSecret = orig;
  }
});

test('jwt: rejects tokens with invalid role, empty sub, or non-numeric exp', () => {
  const orig = config.jwtSecret;
  config.jwtSecret = 'a-very-long-secret-key-at-least-32-chars-long';
  try {
    const enc = (v: string) => Buffer.from(v).toString('base64url');
    const { createHmac } = require('node:crypto');
    const mac = (data: string) => createHmac('sha256', config.jwtSecret).update(data).digest();
    const makeToken = (claims: any) => {
      const h = enc(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const b = enc(JSON.stringify(claims));
      return `${h}.${b}.${mac(`${h}.${b}`).toString('base64url')}`;
    };

    assert.equal(verifyJwt(makeToken({ sub: '', role: 'OWNER', exp: Math.floor(Date.now() / 1000) + 100 })), null);
    assert.equal(verifyJwt(makeToken({ sub: 'admin-1', role: 'SUPERUSER', exp: Math.floor(Date.now() / 1000) + 100 })), null);
    assert.equal(verifyJwt(makeToken({ sub: 'admin-1', role: 'OWNER', exp: 'tomorrow' })), null);
  } finally {
    config.jwtSecret = orig;
  }
});
