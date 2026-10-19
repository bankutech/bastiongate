import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

export interface AdminClaims {
  sub: string;
  email: string;
  role: 'OWNER' | 'SUPPORT';
  exp: number;
}

const enc = (v: string) => Buffer.from(v).toString('base64url');
const mac = (data: string) => createHmac('sha256', config.jwtSecret).update(data).digest();

export function signJwt(claims: Omit<AdminClaims, 'exp'>, ttlSeconds: number) {
  if (!config.jwtSecret || config.jwtSecret.length < 32) throw new Error('JWT_SECRET is not configured or too short');
  const head = enc(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = enc(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${head}.${body}.${mac(`${head}.${body}`).toString('base64url')}`;
}

export function verifyJwt(token: string): AdminClaims | null {
  if (!token || typeof token !== 'string' || !config.jwtSecret || config.jwtSecret.length < 32) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const given = Buffer.from(parts[2], 'base64url');
  const expected = mac(`${parts[0]}.${parts[1]}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as AdminClaims;
    if (head.alg !== 'HS256' || typeof claims?.exp !== 'number' || Number.isNaN(claims.exp) || claims.exp < Date.now() / 1000) return null;
    if (claims.role !== 'OWNER' && claims.role !== 'SUPPORT') return null;
    if (!claims.sub || typeof claims.sub !== 'string') return null;
    return claims;
  } catch {
    return null;
  }
}
