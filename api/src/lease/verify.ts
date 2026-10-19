import { canonicalize } from './canonical';
import { SignedLease } from './lease.types';
import { verifyLease } from './signer';

export type Denial = 'BAD_SIGNATURE' | 'WRONG_SUBJECT' | 'REVOKED' | 'CLOCK_ROLLBACK' | 'NOT_YET_VALID' | 'GYM_EXPIRED' | 'MEMBER_EXPIRED' | 'BALANCE_OVERDUE';
export type Decision = { allowed: true } | { allowed: false; reason: Denial };

export interface AccessInput {
  member: SignedLease;
  gym: SignedLease;
  now: Date;
  highWaterMark: Date;
  publicKeyPem: string;
}

const HOUR = 3_600_000;

function signatureOk(pem: string, s: SignedLease) {
  try {
    return verifyLease(pem, Buffer.from(canonicalize(s.lease)), Buffer.from(s.signature, 'base64'));
  } catch {
    return false;
  }
}

export function evaluateAccess({ member, gym, now, highWaterMark, publicKeyPem }: AccessInput): Decision {
  const deny = (reason: Denial): Decision => ({ allowed: false, reason });
  if (!member?.lease || !gym?.lease || !publicKeyPem) return deny('BAD_SIGNATURE');
  if (!signatureOk(publicKeyPem, member) || !signatureOk(publicKeyPem, gym)) return deny('BAD_SIGNATURE');

  const m = member.lease;
  const g = gym.lease;

  if (!m.tenant_id || !g.tenant_id || m.subject_type !== 'MEMBER' || g.subject_type !== 'GYM' || m.tenant_id !== g.tenant_id) return deny('WRONG_SUBJECT');
  if (m.status !== 'ACTIVE' && m.status !== 'GRACE') return deny('REVOKED');
  if (g.status !== 'ACTIVE' && g.status !== 'GRACE') return deny('REVOKED');

  const t = now ? now.getTime() : NaN;
  const hwm = highWaterMark ? highWaterMark.getTime() : NaN;
  if (Number.isNaN(t) || Number.isNaN(hwm) || t < hwm) return deny('CLOCK_ROLLBACK');

  const gStart = Date.parse(g.valid_from);
  if (Number.isNaN(gStart) || t < gStart) return deny('NOT_YET_VALID');

  const mStart = Date.parse(m.valid_from);
  if (Number.isNaN(mStart) || t < mStart) return deny('NOT_YET_VALID');

  const gExpiry = Date.parse(g.valid_until) + (g.grace_period_hours || 0) * HOUR;
  if (Number.isNaN(gExpiry) || t > gExpiry) return deny('GYM_EXPIRED');

  const mExpiry = Date.parse(m.valid_until) + (m.grace_period_hours || 0) * HOUR;
  if (Number.isNaN(mExpiry) || t > mExpiry) return deny('MEMBER_EXPIRED');

  if (m.balance_due_paise > 0 && !(m.balance_due_deadline && t <= Date.parse(m.balance_due_deadline))) return deny('BALANCE_OVERDUE');
  return { allowed: true };
}

