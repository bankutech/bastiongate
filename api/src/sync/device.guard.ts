import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { DeviceIdentity, DeviceService } from './device.service';

@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(private devices: DeviceService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers['authorization']?.trim() ?? '');
    if (!match) throw new UnauthorizedException();
    const identity = await this.devices.authenticate(match[1]);
    if (!identity) throw new UnauthorizedException();
    req.device = identity;
    return true;
  }
}

export const CurrentDevice = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): DeviceIdentity => ctx.switchToHttp().getRequest().device,
);
