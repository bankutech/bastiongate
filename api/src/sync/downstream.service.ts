import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';

export type DownstreamKind = 'LEASE' | 'COMMAND' | 'TICKET_REPLY' | 'PAYMENT_LINK';
export type TerminalCommand = 'USER_ENABLE' | 'USER_DISABLE' | 'USER_SET_EXPIRY' | 'TERMINAL_REBOOT';

@Injectable()
export class DownstreamService {
  constructor(private db: DbService) {}

  async append(c: PoolClient, tenantId: string, kind: DownstreamKind, body: unknown, deviceId: string | null = null) {
    await c.query(
      'INSERT INTO sync_downstream (tenant_id, device_id, kind, body) VALUES ($1, $2, $3, $4)',
      [tenantId, deviceId, kind, JSON.stringify(body)],
    );
  }

  enqueueCommand(tenantId: string, command: TerminalCommand, args: Record<string, unknown>, deviceId: string | null = null, client?: PoolClient) {
    if (client) {
      return this.append(client, tenantId, 'COMMAND', { command, args }, deviceId);
    }
    return this.db.withTenant(tenantId, c => this.append(c, tenantId, 'COMMAND', { command, args }, deviceId));
  }
}
