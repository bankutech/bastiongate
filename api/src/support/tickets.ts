import { PoolClient } from 'pg';
import { config } from '../config';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DIAGNOSTICS_BYTES = 8000;

export async function recordTicketFromEdge(c: PoolClient, tenantId: string, eventId: string, body: any) {
  if (!body || typeof body !== 'object') return;
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 5000) : '';
  if (typeof body.ticket_id !== 'string' || !UUID.test(body.ticket_id) || !message) return;
  if (typeof eventId !== 'string' || !UUID.test(eventId)) return;

  const subject = typeof body.subject === 'string' ? body.subject.slice(0, 200) : null;
  const diag = body.diagnostics && typeof body.diagnostics === 'object' && !Array.isArray(body.diagnostics) ? body.diagnostics : {};
  let diagStr = '{}';
  try { diagStr = JSON.stringify(diag); } catch { diagStr = '{}'; }
  const diagnostics = diagStr.length <= MAX_DIAGNOSTICS_BYTES ? diag : {};

  await c.query(
    `INSERT INTO support_tickets (id, tenant_id, subject, diagnostics, sla_due_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))
     ON CONFLICT (id) DO NOTHING`,
    [body.ticket_id, tenantId, subject, JSON.stringify(diagnostics), config.supportSlaHours],
  );

  const own = await c.query('SELECT 1 FROM support_tickets WHERE id = $1 AND tenant_id = $2', [body.ticket_id, tenantId]);
  if (!own.rowCount) return;

  const added = await c.query(
    `INSERT INTO ticket_replies (id, ticket_id, tenant_id, author, body)
     VALUES ($1, $2, $3, 'GYM', $4)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [eventId, body.ticket_id, tenantId, message],
  );
  if (added.rowCount) {
    await c.query(
      `UPDATE support_tickets SET status = 'OPEN', sla_due_at = now() + make_interval(hours => $2), updated_at = now()
       WHERE id = $1 AND status <> 'OPEN'`,
      [body.ticket_id, config.supportSlaHours],
    );
  }
}
