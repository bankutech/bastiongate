import { BadRequestException, Controller, Headers, HttpCode, Post, RawBodyRequest, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DbService } from '../db/db.service';
import { config } from '../config';
import { JobQueue } from './job-queue';

@Controller('v1/webhooks')
export class WebhookController {
  constructor(private db: DbService, private queue: JobQueue) {}

  @Post('razorpay')
  @HttpCode(200)
  async razorpay(
    @Req() req: RawBodyRequest<any>,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') headerEventId?: string,
  ) {
    if (!config.razorpayWebhookSecret) throw new ServiceUnavailableException();
    const raw = req.rawBody;
    if (!raw || !signature) throw new UnauthorizedException();

    const expected = createHmac('sha256', config.razorpayWebhookSecret).update(raw).digest();
    const given = Buffer.from(signature, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException();

    const body = req.body;
    if (!body || typeof body.event !== 'string') throw new BadRequestException('missing event');
    const eventId = headerEventId || createHash('sha256').update(raw).digest('hex');

    const inserted = await this.db.withSuper(c =>
      c.query('INSERT INTO webhook_events (event_id, event, payload) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING event_id', [eventId, body.event, JSON.stringify(body)]),
    );
    if (inserted.rowCount) await this.queue.enqueueWebhook(eventId, body.event);
    return { received: true };
  }
}
