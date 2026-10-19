import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { AdminClaims, verifyJwt } from './jwt';

export const Roles = (...roles: AdminClaims['role'][]) => SetMetadata('roles', roles);

export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AdminClaims => ctx.switchToHttp().getRequest().admin,
);

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private db: DbService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    if (config.jwtSecret.length < 32) throw new ServiceUnavailableException();
    const req = ctx.switchToHttp().getRequest();
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers['authorization']?.trim() ?? '');
    const claims = match ? verifyJwt(match[1]) : null;
    if (!claims) throw new UnauthorizedException();

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!claims.sub || !UUID_REGEX.test(claims.sub)) throw new UnauthorizedException();

    const live = await this.db.withSuper(c =>
      c.query<{ role: AdminClaims['role'] }>('SELECT role FROM admins WHERE id = $1 AND NOT disabled', [claims.sub]),
    );
    if (!live.rowCount) throw new UnauthorizedException();

    const allowed = this.reflector.getAllAndOverride<AdminClaims['role'][] | undefined>('roles', [ctx.getHandler(), ctx.getClass()]);
    if (allowed && !allowed.includes(live.rows[0].role)) throw new ForbiddenException();
    req.admin = { ...claims, role: live.rows[0].role };
    return true;
  }
}
