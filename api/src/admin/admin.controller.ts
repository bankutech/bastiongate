import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { BillingService } from '../billing/billing.service';
import { DbService } from '../db/db.service';
import { DeviceService } from '../sync/device.service';
import { DownstreamService, TerminalCommand } from '../sync/downstream.service';
import { AdminGuard, Roles } from './admin.guard';

const COMMANDS: TerminalCommand[] = ['USER_ENABLE', 'USER_DISABLE', 'USER_SET_EXPIRY', 'TERMINAL_REBOOT'];

@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private db: DbService, private billing: BillingService, private devices: DeviceService, private downstream: DownstreamService) {}

  @Get('fleet')
  async fleet() {
    const res = await this.db.withSuper(c => c.query(
      `SELECT t.id, t.name, t.status, t.master_lease_valid_until,
         COALESCE(json_agg(json_build_object(
           'device_id', d.id, 'label', d.label, 'last_seen_at', d.last_seen_at,
           'offline_seconds', EXTRACT(EPOCH FROM now() - d.last_seen_at)::int,
           'heartbeat', d.last_heartbeat) ORDER BY d.label) FILTER (WHERE d.id IS NOT NULL), '[]') AS devices,
         (SELECT count(*)::int FROM sync_events e WHERE e.tenant_id = t.id AND e.kind = 'TAMPER_ALERT' AND e.received_at > now() - interval '24 hours') AS tamper_alerts_24h
       FROM tenants t LEFT JOIN devices d ON d.tenant_id = t.id AND NOT d.revoked
       GROUP BY t.id ORDER BY t.name`,
    ));
    return { tenants: res.rows };
  }

  @Roles('OWNER')
  @Post('tenants')
  async createTenant(@Body() body: { id?: string; name?: string }) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!body?.id || !/^[a-z0-9_]{3,64}$/.test(body.id) || !name) throw new BadRequestException('id must match [a-z0-9_]{3,64} and name is required');
    const made = await this.db.withSuper(c => c.query('INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id', [body.id, name]));
    if (!made.rowCount) throw new ConflictException('tenant already exists');
    await this.billing.renewMaster(body.id);
    return { id: body.id };
  }

  @Roles('OWNER')
  @Post('tenants/:id/devices')
  async provision(@Param('id') id: string, @Body() body: { label?: string }) {
    await this.mustExist(id);
    const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 100) : 'front-desk';
    return this.devices.provision(id, label);
  }

  @Roles('OWNER')
  @Post('tenants/:id/suspend')
  @HttpCode(200)
  async suspend(@Param('id') id: string) {
    await this.mustExist(id);
    await this.billing.suspend(id);
    return { status: 'SUSPENDED' };
  }

  @Roles('OWNER')
  @Post('tenants/:id/reinstate')
  @HttpCode(200)
  async reinstate(@Param('id') id: string) {
    await this.mustExist(id);
    await this.billing.reinstate(id);
    return { status: 'ACTIVE' };
  }

  @Roles('OWNER')
  @Post('tenants/:id/commands')
  async command(@Param('id') id: string, @Body() body: { command?: TerminalCommand; args?: Record<string, unknown>; device_id?: string }) {
    await this.mustExist(id);
    if (!body?.command || !COMMANDS.includes(body.command)) throw new BadRequestException(`command must be one of ${COMMANDS.join(', ')}`);
    const deviceId = typeof body?.device_id === 'string' && body.device_id.trim() ? body.device_id.trim() : null;
    const args = body?.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};
    await this.downstream.enqueueCommand(id, body.command, args, deviceId);
    return { queued: true };
  }

  private async mustExist(id: string) {
    const res = await this.db.withSuper(c => c.query('SELECT 1 FROM tenants WHERE id = $1', [id]));
    if (!res.rowCount) throw new NotFoundException('unknown tenant');
  }
}
