import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { BillingModule } from './billing/billing.module';
import { ConsoleController } from './console.controller';
import { DbModule } from './db/db.module';
import { HealthController } from './health.controller';
import { LeadsController } from './leads.controller';
import { LeaseModule } from './lease/lease.module';
import { SyncModule } from './sync/sync.module';

@Module({ imports: [DbModule, LeaseModule, SyncModule, BillingModule, AdminModule], controllers: [HealthController, LeadsController, ConsoleController] })
export class AppModule {}
