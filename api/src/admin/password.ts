import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, KEYLEN, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  try {
    const [saltHex, hashHex] = stored.split(':');
    if (!saltHex || !hashHex || saltHex.length !== 32 || hashHex.length !== KEYLEN * 2) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const salt = Buffer.from(saltHex, 'hex');
    if (expected.length !== KEYLEN || salt.length !== 16) return false;
    const actual = await derive(password, salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export const dummyHash = hashPassword('not-a-real-password');
