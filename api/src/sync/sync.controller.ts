import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentDevice, DeviceGuard } from './device.guard';
import { DeviceIdentity } from './device.service';
import { SyncService } from './sync.service';

@Controller('v1/sync')
@UseGuards(DeviceGuard)
export class SyncController {
  constructor(private sync: SyncService) {}

  @Post('push')
  @HttpCode(200)
  push(@CurrentDevice() dev: DeviceIdentity, @Body() body: { events?: unknown }) {
    return this.sync.push(dev, body?.events);
  }

  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(@CurrentDevice() dev: DeviceIdentity, @Body() body: unknown) {
    return this.sync.heartbeat(dev, body);
  }

  @Get('pull')
  pull(@CurrentDevice() dev: DeviceIdentity, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.sync.pull(dev, cursor, limit);
  }
}
