import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';

export interface PaymentLinkJob {
  tenantId: string;
  subjectId: string;
  deviceUserId?: string;
  paymentId?: string;
  amount?: number;
}

const RETRY = { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000 } as const;

@Injectable()
export class JobQueue implements OnModuleDestroy {
  readonly conn = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  readonly queue: Queue;

  constructor() {
    this.conn.on('error', () => { /* prevent uncaught exception on connection error */ });
    this.queue = new Queue('billing', { connection: this.conn });
    this.queue.on('error', () => { /* prevent uncaught queue error */ });
  }

  enqueueWebhook(eventId: string, event: string) {
    return this.queue.add(event, { eventId }, { jobId: eventId, ...RETRY });
  }

  enqueuePaymentLink(job: PaymentLinkJob) {
    const jobId = job.paymentId ? `link_${job.paymentId}` : undefined;
    return this.queue.add('send-payment-link', job, { ...(jobId ? { jobId } : {}), ...RETRY });
  }

  async onModuleDestroy() {
    await this.queue.close();
    this.conn.disconnect();
  }
}
