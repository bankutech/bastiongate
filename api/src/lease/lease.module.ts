import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { LeaseController } from './lease.controller';
import { LeaseService } from './lease.service';

@Module({ imports: [SyncModule], controllers: [LeaseController], providers: [LeaseService], exports: [LeaseService] })
export class LeaseModule {}
