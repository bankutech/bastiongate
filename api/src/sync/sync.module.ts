import { Module } from '@nestjs/common';
import { DeviceGuard } from './device.guard';
import { DeviceService } from './device.service';
import { DownstreamService } from './downstream.service';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  controllers: [SyncController],
  providers: [SyncService, DeviceService, DeviceGuard, DownstreamService],
  exports: [DownstreamService, DeviceService],
})
export class SyncModule {}
