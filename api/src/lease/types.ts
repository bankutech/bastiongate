export type SubjectType = 'MEMBER' | 'GYM';
export type LeaseStatus = 'ACTIVE' | 'GRACE' | 'REVOKED';

export interface Lease {
  lease_id: string;
  tenant_id: string;
  subject_type: SubjectType;
  subject_id: string;
  device_user_id: string | null;
  valid_from: string;
  valid_until: string;
  grace_period_hours: number;
  balance_due_paise: number;
  balance_due_deadline: string | null;
  status: LeaseStatus;
  monotonic_nonce: number;
}

export interface MemberLease extends Lease {
  subject_type: 'MEMBER';
}

export interface GymLease extends Lease {
  subject_type: 'GYM';
}

export interface SignedLease {
  lease: Lease;
  signature: string;
}

export interface IssueInput {
  subjectType: SubjectType;
  subjectId: string;
  deviceUserId?: string | null;
  validFrom: Date;
  validUntil: Date;
  graceHours?: number;
  balanceDuePaise?: number;
  balanceDueDeadline?: Date | null;
  status?: LeaseStatus;
}

export type Denial =
  | 'BAD_SIGNATURE'
  | 'WRONG_SUBJECT'
  | 'REVOKED'
  | 'CLOCK_ROLLBACK'
  | 'NOT_YET_VALID'
  | 'GYM_EXPIRED'
  | 'MEMBER_EXPIRED'
  | 'BALANCE_OVERDUE';

export type Decision = { allowed: true } | { allowed: false; reason: Denial };

export interface AccessInput {
  member: SignedLease;
  gym: SignedLease;
  now: Date;
  highWaterMark: Date;
  publicKeyPem: string;
}
