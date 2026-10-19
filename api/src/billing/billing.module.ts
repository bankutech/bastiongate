import { Module } from '@nestjs/common';
import { LeaseModule } from '../lease/lease.module';
import { SyncModule } from '../sync/sync.module';
import { BillingWorker } from './billing.queue';
import { JobQueue } from './job-queue';
import { BillingService } from './billing.service';
import { RazorpayClient } from './razorpay.client';
import { RouteService } from './route.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [LeaseModule, SyncModule],
  controllers: [WebhookController],
  providers: [BillingService, JobQueue, BillingWorker, RazorpayClient, RouteService],
  exports: [BillingService, RouteService],
})
export class BillingModule {}
