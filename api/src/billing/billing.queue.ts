import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { BillingService } from './billing.service';
import { JobQueue, PaymentLinkJob } from './job-queue';

const SIX_HOURS = 6 * 3_600_000;

@Injectable()
export class BillingWorker implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('billing-worker');
  private worker?: Worker;
  private workerConn?: ReturnType<JobQueue['conn']['duplicate']>;

  constructor(private billing: BillingService, private jobs: JobQueue) {}

  async onModuleInit() {
    this.workerConn = this.jobs.conn.duplicate();
    this.workerConn.on('error', () => { /* prevent worker redis connection unhandled error */ });
    this.worker = new Worker('billing', job => this.run(job.name, job.data), { connection: this.workerConn, concurrency: 5 });
    this.worker.on('failed', (job, err) => this.log.error(`${job?.name} ${job?.id} failed: ${err.message}`));
    this.worker.on('error', err => this.log.error(`Worker error: ${err.message}`));
    try {
      await this.jobs.queue.upsertJobScheduler('renew-master-leases', { every: SIX_HOURS }, { name: 'renew-master-leases' });
    } catch (err) {
      this.log.error(`Failed to register renew-master-leases scheduler: ${(err as Error).message}`);
    }
  }

  private run(name: string, data: any) {
    if (name === 'renew-master-leases') return this.billing.renewAllMasters();
    if (name === 'send-payment-link') return this.billing.createPaymentLink(data as PaymentLinkJob);
    return this.billing.processWebhook(data.eventId as string);
  }

  async onModuleDestroy() {
    await this.worker?.close();
    this.workerConn?.disconnect();
  }
}
