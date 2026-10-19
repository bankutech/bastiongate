import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { config } from '../config';

@Injectable()
export class DbService implements OnModuleDestroy {
  private pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

  constructor() {
    this.pool.on('error', () => { /* prevent idle client uncaught exceptions */ });
  }

  async withTenant<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    return this.run({ tenant: tenantId, role: '' }, fn);
  }

  async withSuper<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    return this.run({ tenant: '', role: 'super' }, fn);
  }

  private async run<T>(scope: { tenant: string; role: string }, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.role', $2, true)", [scope.tenant, scope.role]);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // preserve original error
      }
      throw err;
    } finally {
      client.release();
    }
  }

  onModuleDestroy() {
    return this.pool.end();
  }
}
