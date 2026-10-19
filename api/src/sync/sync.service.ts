import { BadRequestException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { recordTicketFromEdge } from '../support/tickets';
import { DeviceIdentity } from './device.service';

const KINDS = new Set(['CHECK_IN', 'CHECK_OUT', 'MEMBER_ENROLLED', 'POS_TRANSACTION', 'SUPPORT_TICKET', 'TAMPER_ALERT', 'CONFIG_UPDATE']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BATCH = 100;
const MAX_PULL = 200;
const DAY_MS = 86_400_000;

@Injectable()
export class SyncService {
  constructor(private db: DbService) {}

  async push(dev: DeviceIdentity, events: unknown) {
    if (!Array.isArray(events) || events.length === 0 || events.length > MAX_BATCH) {
      throw new BadRequestException(`events must hold 1 to ${MAX_BATCH} items`);
    }
    const acknowledged: string[] = [];
    const rejected: { event_id: unknown; reason: string }[] = [];

    await this.db.withTenant(dev.tenantId, async c => {
      for (const e of events as any[]) {
        const reason = this.reject(e);
        if (reason) {
          rejected.push({ event_id: e?.event_id ?? null, reason });
          continue;
        }
        await c.query(
          `INSERT INTO sync_events (event_id, tenant_id, device_id, kind, occurred_at, body)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (event_id) DO NOTHING`,
          [e.event_id, dev.tenantId, dev.deviceId, e.kind, e.occurred_at, JSON.stringify(e.body)],
        );
        if (e.kind === 'MEMBER_ENROLLED') await this.enrollMember(c, dev.tenantId, e.body);
        if (e.kind === 'SUPPORT_TICKET') await recordTicketFromEdge(c, dev.tenantId, e.event_id, e.body);
        acknowledged.push(e.event_id);
      }
      await c.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [dev.deviceId]);
    });

    return { acknowledged, rejected };
  }

  async pull(dev: DeviceIdentity, rawCursor?: string, rawLimit?: string) {
    const cursor = rawCursor ? Number(rawCursor) : 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new BadRequestException('cursor must be a non-negative integer');
    const limit = Math.min(Math.max(Number(rawLimit) || 100, 1), MAX_PULL);

    const rows = await this.db.withTenant(dev.tenantId, async c => {
      const res = await c.query<{ seq: string; kind: string; body: unknown }>(
        `SELECT seq, kind, body FROM sync_downstream
         WHERE tenant_id = $1 AND seq > $2 AND (device_id IS NULL OR device_id = $3)
         ORDER BY seq LIMIT $4`,
        [dev.tenantId, cursor, dev.deviceId, limit + 1],
      );
      return res.rows;
    });

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(r => ({ seq: Number(r.seq), kind: r.kind, body: r.body }));
    return { items, next_cursor: items.length ? items[items.length - 1].seq : cursor, has_more: hasMore };
  }

  async heartbeat(dev: DeviceIdentity, b: any) {
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const clean = {
      app_version: typeof b?.app_version === 'string' ? b.app_version.slice(0, 32) : null,
      outbox_backlog: num(b?.outbox_backlog),
      clock_skew_seconds: num(b?.clock_skew_seconds),
      tamper_flags: Array.isArray(b?.tamper_flags) ? b.tamper_flags.filter((f: unknown) => typeof f === 'string').slice(0, 20) : [],
    };
    await this.db.withTenant(dev.tenantId, c =>
      c.query('UPDATE devices SET last_heartbeat = $2, last_heartbeat_at = now(), last_seen_at = now() WHERE id = $1', [dev.deviceId, JSON.stringify(clean)]),
    );
    return { ok: true };
  }

  private reject(e: any): string | null {
    if (!e || typeof e !== 'object') return 'malformed event';
    if (typeof e.event_id !== 'string' || !UUID_V4.test(e.event_id)) return 'event_id must be a UUIDv4';
    if (!KINDS.has(e.kind)) return 'unknown kind';
    if (typeof e.occurred_at !== 'string') return 'occurred_at must be an ISO string';
    const at = Date.parse(e.occurred_at);
    if (Number.isNaN(at)) return 'occurred_at is not a date';
    if (at > Date.now() + DAY_MS) return 'occurred_at is in the future';
    if (!e.body || typeof e.body !== 'object' || Array.isArray(e.body)) return 'body must be an object';
    try {
      JSON.stringify(e.body);
    } catch {
      return 'body is not serializable JSON';
    }
    return null;
  }

  private async enrollMember(c: PoolClient, tenantId: string, b: any) {
    if (!b || typeof b !== 'object') return;
    const ok = [b.member_id, b.device_user_id, b.full_name].every(v => typeof v === 'string' && v.length > 0);
    if (!ok) return;
    await c.query(
      `INSERT INTO members (id, tenant_id, device_user_id, full_name, phone)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [b.member_id, tenantId, b.device_user_id, b.full_name, typeof b.phone === 'string' ? b.phone : null],
    );
  }
}
