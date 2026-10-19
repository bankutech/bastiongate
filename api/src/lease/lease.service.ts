import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { DownstreamService } from '../sync/downstream.service';
import { canonicalize } from './canonical';
import { IssueInput, Lease, SignedLease } from './lease.types';
import { buildSigner, LeaseSigner } from './signer';

@Injectable()
export class LeaseService {
  private signer: LeaseSigner = buildSigner();

  constructor(private db: DbService, private downstream: DownstreamService) {}

  publicKey() {
    return this.signer.publicKeyPem();
  }

  async issue(tenantId: string, input: IssueInput, client?: PoolClient): Promise<SignedLease> {
    const run = async (c: PoolClient) => {
      const counter = await c.query<{ nonce: string }>(
        `INSERT INTO lease_counters (tenant_id, subject_type, subject_id, nonce)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (tenant_id, subject_type, subject_id)
         DO UPDATE SET nonce = lease_counters.nonce + 1
         RETURNING nonce`,
        [tenantId, input.subjectType, input.subjectId],
      );

      const lease: Lease = {
        lease_id: randomUUID(),
        tenant_id: tenantId,
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        device_user_id: input.deviceUserId ?? null,
        valid_from: input.validFrom.toISOString(),
        valid_until: input.validUntil.toISOString(),
        grace_period_hours: input.graceHours ?? 48,
        balance_due_paise: input.balanceDuePaise ?? 0,
        balance_due_deadline: input.balanceDueDeadline ? input.balanceDueDeadline.toISOString() : null,
        status: input.status ?? 'ACTIVE',
        monotonic_nonce: Number(counter.rows[0].nonce),
      };

      const sig = await this.signer.sign(Buffer.from(canonicalize(lease)));
      const signature = sig.toString('base64');

      await c.query(
        `INSERT INTO leases (lease_id, tenant_id, subject_type, subject_id, monotonic_nonce, valid_until, payload, signature)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [lease.lease_id, tenantId, lease.subject_type, lease.subject_id, lease.monotonic_nonce, lease.valid_until, lease, signature],
      );
      await this.downstream.append(c, tenantId, 'LEASE', { lease, signature });
      return { lease, signature };
    };

    if (client) return run(client);
    return this.db.withTenant(tenantId, run);
  }

  revoke(tenantId: string, subjectType: 'MEMBER' | 'GYM', subjectId: string, deviceUserId?: string | null, client?: PoolClient) {
    const now = new Date();
    return this.issue(tenantId, { subjectType, subjectId, deviceUserId, validFrom: now, validUntil: now, graceHours: 0, status: 'REVOKED' }, client);
  }

  async getById(leaseId: string): Promise<SignedLease | null> {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!leaseId || !UUID_REGEX.test(leaseId)) return null;
    const res = await this.db.withSuper(c =>
      c.query<{ payload: Lease; signature: string }>(
        'SELECT payload, signature FROM leases WHERE lease_id = $1',
        [leaseId],
      ),
    );
    if (!res.rows[0]) return null;
    return { lease: res.rows[0].payload, signature: res.rows[0].signature };
  }

  async getLatestMemberLease(memberId: string, tenantId?: string): Promise<SignedLease | null> {
    const res = await this.db.withSuper(c => {
      if (tenantId) {
        return c.query<{ payload: Lease; signature: string }>(
          `SELECT payload, signature FROM leases
           WHERE subject_type = 'MEMBER' AND subject_id = $1 AND tenant_id = $2
           ORDER BY monotonic_nonce DESC LIMIT 1`,
          [memberId, tenantId],
        );
      }
      return c.query<{ payload: Lease; signature: string }>(
        `SELECT payload, signature FROM leases
         WHERE subject_type = 'MEMBER' AND subject_id = $1
         ORDER BY monotonic_nonce DESC LIMIT 1`,
        [memberId],
      );
    });
    if (!res.rows[0]) return null;
    return { lease: res.rows[0].payload, signature: res.rows[0].signature };
  }
}
