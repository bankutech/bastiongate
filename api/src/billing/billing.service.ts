import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { LeaseService } from '../lease/lease.service';
import { DownstreamService } from '../sync/downstream.service';
import { config } from '../config';
import { JobQueue, PaymentLinkJob } from './job-queue';
import { RazorpayClient } from './razorpay.client';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface Notes {
  tenant_id: string;
  subject_type: 'MEMBER' | 'GYM';
  subject_id: string;
  device_user_id?: string;
}

@Injectable()
export class BillingService {
  private log = new Logger('billing');

  constructor(private db: DbService, private leases: LeaseService, private downstream: DownstreamService, private rzp: RazorpayClient, private jobs: JobQueue) {}

  async processWebhook(eventId: string) {
    const res = await this.db.withSuper(c =>
      c.query<{ event: string; payload: any; received_at: Date; processed_at: Date | null }>(
        'SELECT event, payload, received_at, processed_at FROM webhook_events WHERE event_id = $1', [eventId],
      ),
    );
    const row = res.rows[0];
    if (!row || row.processed_at) return;

    const notes = this.extractNotes(row.payload);
    if (!notes) {
      this.log.warn(`${row.event} skipped, notes missing tenant_id/subject_type/subject_id`);
      await this.db.withSuper(c => c.query('UPDATE webhook_events SET processed_at = now() WHERE event_id = $1', [eventId]));
      return;
    }

    const at = typeof row.payload?.created_at === 'number' ? row.payload.created_at * 1000 : row.received_at.getTime();
    const key = `${notes.tenant_id}|${notes.subject_type}|${notes.subject_id}`;
    await this.db.withSuper(async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      const prev = await c.query<{ last_event_at: Date }>(
        'SELECT last_event_at FROM subject_events WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3',
        [notes.tenant_id, notes.subject_type, notes.subject_id],
      );
      const last = prev.rows[0]?.last_event_at.getTime() ?? 0;
      if (at < last) {
        this.log.warn(`${row.event} for ${key} is older than the last applied event, ignored`);
      } else {
        await this.apply(row.event, row.payload, notes, c);
        await c.query(
          `INSERT INTO subject_events (tenant_id, subject_type, subject_id, last_event_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, subject_type, subject_id) DO UPDATE SET last_event_at = GREATEST(subject_events.last_event_at, EXCLUDED.last_event_at)`,
          [notes.tenant_id, notes.subject_type, notes.subject_id, new Date(at)],
        );
      }
      await c.query('UPDATE webhook_events SET processed_at = now() WHERE event_id = $1', [eventId]);
    });
  }

  async renewMaster(tenantId: string, client?: PoolClient) {
    const doRenew = async (c: PoolClient) => {
      const status = await c.query<{ status: string }>('SELECT status FROM tenants WHERE id = $1', [tenantId]);
      if (status.rows[0]?.status !== 'ACTIVE') return null;
      const now = new Date();
      const until = new Date(now.getTime() + config.masterLeaseDays * DAY);
      const signed = await this.leases.issue(tenantId, { subjectType: 'GYM', subjectId: tenantId, validFrom: now, validUntil: until, graceHours: 0 }, c);
      await c.query('UPDATE tenants SET master_lease_valid_until = $2 WHERE id = $1', [tenantId, until]);
      return signed;
    };
    if (client) return doRenew(client);
    return this.db.withTenant(tenantId, doRenew);
  }

  async renewAllMasters() {
    const ids = await this.db.withSuper(c => c.query<{ id: string }>("SELECT id FROM tenants WHERE status = 'ACTIVE'"));
    for (const { id } of ids.rows) {
      try {
        await this.renewMaster(id);
      } catch (err) {
        this.log.error(`master renewal failed for ${id}: ${(err as Error).message}`);
      }
    }
  }

  async suspend(tenantId: string, client?: PoolClient) {
    const doSuspend = async (c: PoolClient) => {
      await c.query("UPDATE tenants SET status = 'SUSPENDED', master_lease_valid_until = now() WHERE id = $1", [tenantId]);
      await this.leases.revoke(tenantId, 'GYM', tenantId, null, c);
      await this.downstream.enqueueCommand(tenantId, 'USER_DISABLE', { all: true }, null, c);
    };
    if (client) return doSuspend(client);
    return this.db.withTenant(tenantId, doSuspend);
  }

  async reinstate(tenantId: string, client?: PoolClient) {
    if (client) {
      await client.query("UPDATE tenants SET status = 'ACTIVE' WHERE id = $1", [tenantId]);
      return this.renewMaster(tenantId, client);
    }
    await this.db.withTenant(tenantId, c => c.query("UPDATE tenants SET status = 'ACTIVE' WHERE id = $1", [tenantId]));
    return this.renewMaster(tenantId);
  }

  private extractNotes(body: any): Notes | null {
    const p = body?.payload;
    return this.notesOf(p?.subscription?.entity) ?? this.notesOf(p?.payment?.entity) ?? this.notesOf(p?.payment_link?.entity);
  }

  private async apply(event: string, body: any, notes: Notes, client?: PoolClient) {
    const sub = body?.payload?.subscription?.entity;
    const pay = body?.payload?.payment?.entity;
    const now = new Date();
    const { tenant_id: tenantId, subject_type: type, subject_id: subjectId, device_user_id: deviceUserId } = notes;

    switch (event) {
      case 'subscription.charged': {
        if (type === 'GYM') {
          if (client) {
            await client.query("UPDATE tenants SET status = 'ACTIVE' WHERE id = $1 AND status <> 'SUSPENDED'", [tenantId]);
          } else {
            await this.db.withTenant(tenantId, c => c.query("UPDATE tenants SET status = 'ACTIVE' WHERE id = $1 AND status <> 'SUSPENDED'", [tenantId]));
          }
          await this.renewMaster(tenantId, client);
          return;
        }
        const until = sub?.current_end
          ? new Date(sub.current_end > 1e11 ? sub.current_end : sub.current_end * 1000)
          : new Date(now.getTime() + 30 * DAY);
        await this.leases.issue(tenantId, { subjectType: 'MEMBER', subjectId, deviceUserId, validFrom: now, validUntil: until }, client);
        if (deviceUserId) await this.downstream.enqueueCommand(tenantId, 'USER_SET_EXPIRY', { device_user_id: deviceUserId, valid_until: until.toISOString() }, null, client);
        return;
      }
      case 'payment.failed': {
        if (type !== 'MEMBER') return;
        const until = new Date(now.getTime() + config.memberGraceHours * HOUR);
        await this.leases.issue(tenantId, {
          subjectType: 'MEMBER', subjectId, deviceUserId, validFrom: now, validUntil: until,
          graceHours: 0, balanceDuePaise: Number(pay?.amount) || 0, balanceDueDeadline: until, status: 'GRACE',
        }, client);
        await this.jobs.enqueuePaymentLink({ tenantId, subjectId, deviceUserId, paymentId: pay?.id, amount: Number(pay?.amount) });
        return;
      }
      case 'payment_link.paid': {
        if (type !== 'MEMBER') return;
        const until = new Date(now.getTime() + config.paymentLinkExtensionDays * DAY);
        await this.leases.issue(tenantId, { subjectType: 'MEMBER', subjectId, deviceUserId, validFrom: now, validUntil: until }, client);
        if (deviceUserId) await this.downstream.enqueueCommand(tenantId, 'USER_SET_EXPIRY', { device_user_id: deviceUserId, valid_until: until.toISOString() }, null, client);
        return;
      }
      case 'subscription.paused':
      case 'subscription.cancelled':
      case 'subscription.halted': {
        if (type === 'GYM') return this.suspend(tenantId, client);
        await this.leases.revoke(tenantId, 'MEMBER', subjectId, deviceUserId, client);
        if (deviceUserId) await this.downstream.enqueueCommand(tenantId, 'USER_DISABLE', { device_user_id: deviceUserId }, null, client);
        return;
      }
      default:
        this.log.debug(`ignored ${event}`);
    }
  }

  async createPaymentLink(job: PaymentLinkJob) {
    const { tenantId, subjectId, deviceUserId } = job;
    const paymentId = job.paymentId ?? '';
    const amount = Number(job.amount);
    if (!this.rzp.configured || !paymentId || !(amount > 0)) {
      this.log.warn('payment link skipped: Razorpay keys, payment id or amount missing');
      return;
    }

    await this.db.withSuper(async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`link|${paymentId}`]);
      const known = await c.query('SELECT 1 FROM payment_links WHERE payment_id = $1', [paymentId]);
      if (known.rowCount) return;

      const member = await c.query<{ full_name: string; phone: string | null }>('SELECT full_name, phone FROM members WHERE id = $1 AND tenant_id = $2', [subjectId, tenantId]);
      const m = member.rows[0];
      const expireBy = Math.floor(Date.now() / 1000) + 3 * 86_400;
      const link = await this.rzp.call<{ id: string; short_url: string }>('POST', '/v1/payment_links', {
        amount, currency: 'INR', accept_partial: false, reference_id: paymentId, description: 'Membership dues',
        ...(m?.phone ? { customer: { name: m.full_name, contact: m.phone } } : {}),
        notify: { sms: Boolean(m?.phone), email: false }, reminder_enable: true, expire_by: expireBy,
        notes: { tenant_id: tenantId, subject_type: 'MEMBER', subject_id: subjectId, ...(deviceUserId ? { device_user_id: deviceUserId } : {}) },
      });
      await c.query('INSERT INTO payment_links (payment_id, tenant_id, subject_id, link_id, short_url, amount_paise) VALUES ($1, $2, $3, $4, $5, $6)',
        [paymentId, tenantId, subjectId, link.id, link.short_url, amount]);
      await this.downstream.append(c, tenantId, 'PAYMENT_LINK', {
        subject_id: subjectId, device_user_id: deviceUserId ?? null, short_url: link.short_url, amount_paise: amount, expires_at: new Date(expireBy * 1000).toISOString(),
      });
    });
  }

  private notesOf(entity: any): Notes | null {
    const n = entity?.notes;
    if (!n || typeof n !== 'object' || Array.isArray(n)) return null;
    if (typeof n.tenant_id !== 'string' || !n.tenant_id.trim() || typeof n.subject_id !== 'string' || !n.subject_id.trim() || (n.subject_type !== 'MEMBER' && n.subject_type !== 'GYM')) return null;
    return {
      tenant_id: n.tenant_id.trim(),
      subject_id: n.subject_id.trim(),
      subject_type: n.subject_type,
      device_user_id: typeof n.device_user_id === 'string' ? n.device_user_id.trim() : undefined,
    };
  }
}
