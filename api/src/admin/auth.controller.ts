import { BadRequestException, Body, Controller, HttpCode, HttpException, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { signJwt } from './jwt';
import { dummyHash, verifyPassword } from './password';

const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;

@Controller('v1/auth')
export class AuthController {
  private fails = new Map<string, { count: number; resetAt: number }>();

  constructor(private db: DbService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { email?: string; password?: string }) {
    if (config.jwtSecret.length < 32) throw new ServiceUnavailableException();
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body?.password;
    if (!email || typeof password !== 'string') throw new BadRequestException('email and password are required');

    const now = Date.now();
    if (this.fails.size > 5000) {
      for (const [k, v] of this.fails) if (v.resetAt < now) this.fails.delete(k);
    }

    const entry = this.fails.get(email);
    if (entry && entry.resetAt > now && entry.count >= MAX_FAILS) throw new HttpException('too many attempts, try later', 429);

    const res = await this.db.withSuper(c =>
      c.query<{ id: string; password_hash: string; role: 'OWNER' | 'SUPPORT'; disabled: boolean }>(
        'SELECT id, password_hash, role, disabled FROM admins WHERE email = $1', [email],
      ),
    );
    const row = res.rows[0];
    const ok = await verifyPassword(password, row?.password_hash ?? (await dummyHash));
    if (!row || row.disabled || !ok) {
      const fresh = entry && entry.resetAt > Date.now() ? entry : { count: 0, resetAt: Date.now() + WINDOW_MS };
      fresh.count += 1;
      this.fails.set(email, fresh);
      throw new UnauthorizedException('invalid credentials');
    }
    this.fails.delete(email);
    return { token: signJwt({ sub: row.id, email, role: row.role }, config.jwtTtlSeconds), role: row.role, expires_in: config.jwtTtlSeconds };
  }
}
