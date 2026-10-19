import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface DeviceIdentity {
  tenantId: string;
  deviceId: string;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class DeviceService {
  constructor(private db: DbService) {}

  async provision(tenantId: string, label: string) {
    const token = randomBytes(32).toString('base64url');
    const deviceId = 'dev_' + randomBytes(6).toString('hex');
    await this.db.withTenant(tenantId, c =>
      c.query('INSERT INTO devices (id, tenant_id, label, token_hash) VALUES ($1, $2, $3, $4)', [deviceId, tenantId, label, hashToken(token)]),
    );
    return { deviceId, token };
  }

  async authenticate(token: string): Promise<DeviceIdentity | null> {
    if (!token || typeof token !== 'string' || !token.trim()) return null;
    const res = await this.db.withSuper(c =>
      c.query<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM devices WHERE token_hash = $1 AND revoked = false', [hashToken(token.trim())]),
    );
    const row = res.rows[0];
    return row ? { tenantId: row.tenant_id, deviceId: row.id } : null;
  }
}
