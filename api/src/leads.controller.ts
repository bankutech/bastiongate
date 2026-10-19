import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, Post, Req, UseGuards } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { AdminGuard } from './admin/admin.guard';
import { config } from './config';
import { DbService } from './db/db.service';

const HOUR = 3_600_000;
const MAX_PER_HOUR = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const FALLBACK_SALT = randomBytes(32);

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

@Controller('v1')
export class LeadsController {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private db: DbService) {}

  @Post('leads')
  @HttpCode(201)
  async create(@Req() req: any, @Body() body: Record<string, unknown>) {
    if (typeof body?.website === 'string' && body.website.trim().length > 0) return { received: true };
    const name = clean(body?.name, 100);
    const contact = clean(body?.contact, 120);
    if (!name || !contact) throw new BadRequestException('name and contact are required');
    if (!EMAIL.test(contact) && !PHONE.test(contact)) throw new BadRequestException('contact must be an email address or a phone number');

    const clientIp = req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
    const ipHash = createHmac('sha256', config.jwtSecret || FALLBACK_SALT).update(String(clientIp)).digest('hex');
    this.throttle(ipHash);

    await this.db.withSuper(c =>
      c.query('INSERT INTO leads (name, gym_name, contact, message, ip_hash) VALUES ($1, $2, $3, $4, $5)',
        [name, clean(body?.gym_name, 120) || null, contact, clean(body?.message, 1000) || null, ipHash]),
    );
    return { received: true };
  }

  @Get('admin/leads')
  @UseGuards(AdminGuard)
  async list() {
    const res = await this.db.withSuper(c => c.query('SELECT id, name, gym_name, contact, message, created_at FROM leads ORDER BY created_at DESC LIMIT 200'));
    return { leads: res.rows };
  }

  private throttle(key: string) {
    const now = Date.now();
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.resetAt < now) this.hits.delete(k);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt < now) {
      this.hits.set(key, { count: 1, resetAt: now + HOUR });
      return;
    }
    if (entry.count >= MAX_PER_HOUR) throw new HttpException('too many requests, try later', 429);
    entry.count += 1;
  }
}
