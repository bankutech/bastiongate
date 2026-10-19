import { Controller, Get } from '@nestjs/common';
import { DbService } from './db/db.service';

@Controller()
export class HealthController {
  constructor(private db: DbService) {}

  @Get('health')
  async health() {
    await this.db.withSuper(c => c.query('SELECT 1'));
    return { ok: true };
  }
}
