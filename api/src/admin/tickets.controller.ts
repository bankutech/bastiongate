import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { DownstreamService } from '../sync/downstream.service';
import { UUID } from '../support/tickets';
import { AdminGuard, CurrentAdmin } from './admin.guard';
import { AdminClaims } from './jwt';

@Controller('v1/admin/tickets')
@UseGuards(AdminGuard)
export class TicketsController {
  constructor(private db: DbService, private downstream: DownstreamService) {}

  @Get()
  async list(@Query('status') status?: string) {
    if (status && !['OPEN', 'PENDING', 'RESOLVED'].includes(status)) throw new BadRequestException('status must be OPEN, PENDING or RESOLVED');
    const res = await this.db.withSuper(c => c.query(
      `SELECT t.id, t.tenant_id, g.name AS tenant_name, t.subject, t.status, t.sla_due_at, t.created_at, t.updated_at,
              (t.status = 'OPEN' AND t.sla_due_at < now()) AS sla_breached
       FROM support_tickets t JOIN tenants g ON g.id = t.tenant_id
       WHERE ($1::text IS NULL OR t.status = $1)
       ORDER BY (t.status = 'RESOLVED'), t.sla_due_at LIMIT 200`,
      [status ?? null],
    ));
    return { tickets: res.rows };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    this.checkId(id);
    const out = await this.db.withSuper(async c => {
      const t = await c.query('SELECT t.*, g.name AS tenant_name FROM support_tickets t JOIN tenants g ON g.id = t.tenant_id WHERE t.id = $1', [id]);
      if (!t.rowCount) return null;
      const r = await c.query('SELECT id, author, author_label, body, created_at FROM ticket_replies WHERE ticket_id = $1 ORDER BY created_at', [id]);
      return { ...t.rows[0], replies: r.rows };
    });
    if (!out) throw new NotFoundException();
    return out;
  }

  @Post(':id/reply')
  async reply(@Param('id') id: string, @Body() body: { body?: string; resolve?: boolean }, @CurrentAdmin() admin: AdminClaims) {
    this.checkId(id);
    const text = typeof body?.body === 'string' ? body.body.trim().slice(0, 5000) : '';
    if (!text) throw new BadRequestException('body is required');
    const status = body.resolve ? 'RESOLVED' : 'PENDING';

    return this.db.withSuper(async c => {
      const t = await c.query<{ tenant_id: string }>('SELECT tenant_id FROM support_tickets WHERE id = $1 FOR UPDATE', [id]);
      if (!t.rowCount) throw new NotFoundException();
      const tenantId = t.rows[0].tenant_id;
      const replyId = randomUUID();
      await c.query(
        `INSERT INTO ticket_replies (id, ticket_id, tenant_id, author, author_label, body) VALUES ($1, $2, $3, 'ADMIN', $4, $5)`,
        [replyId, id, tenantId, admin.email, text],
      );
      await c.query('UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
      await this.downstream.append(c, tenantId, 'TICKET_REPLY', { ticket_id: id, reply_id: replyId, body: text, status });
      return { reply_id: replyId, status };
    });
  }

  private checkId(id: string) {
    if (!UUID.test(id)) throw new BadRequestException('ticket id must be a UUID');
  }
}
