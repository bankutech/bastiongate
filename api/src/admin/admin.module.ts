import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { SyncModule } from '../sync/sync.module';
import { AdminController } from './admin.controller';
import { AuthController } from './auth.controller';
import { RouteController } from './route.controller';
import { TicketsController } from './tickets.controller';

@Module({ imports: [BillingModule, SyncModule], controllers: [AdminController, AuthController, TicketsController, RouteController] })
export class AdminModule {}
