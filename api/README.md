# bastiongate-api

The **BastionGate** platform API, powered by the Latchkey core cryptographic access lease engine. Built with NestJS 11 + Fastify 5, Postgres 16 with row-level security, Redis 7 + BullMQ, and Ed25519 cryptographic leases (AWS KMS in prod, local key in dev).

## Run it

```
See the top-level README for the Docker and no-Docker setup.
```

Migrations need an owner role. The app connects as a separate non-superuser role (`latchkey_app`), created with its grants by `scripts/init-db.sql`. Superusers bypass row-level security, so never point `DATABASE_URL` at one.

## Env

| var | what |
| --- | --- |
| DATABASE_URL | app role connection string |
| REDIS_URL | BullMQ |
| MIGRATE_DATABASE_URL | owner role, used by migrate and create-admin only |
| CORS_ORIGINS | comma-separated website origins allowed to call the API |
| TRUST_PROXY | `true` behind a load balancer so rate limits see real IPs |
| JWT_SECRET | 32+ characters, signs admin tokens |
| KMS_KEY_ID | AWS KMS key (ECC_NIST_EDWARDS25519). Empty means an ephemeral dev key |
| RAZORPAY_WEBHOOK_SECRET | webhook HMAC secret |
| RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET | API keys for payment links and Route |
| RAZORPAY_BASE_URL | defaults to https://api.razorpay.com, point at the mock to test |

## Edge API (device bearer token)

- `POST /v1/sync/push` 1 to 100 events, idempotent on `event_id`. `SUPPORT_TICKET` events create or answer tickets.
- `GET  /v1/sync/pull?cursor=N` leases, terminal commands, ticket replies, payment links
- `POST /v1/sync/heartbeat` backlog, version, clock skew, tamper flags
- `GET  /v1/leases/public-key` public half to bundle in the Windows service

A `SUPPORT_TICKET` body is `{ticket_id (uuid), subject?, message, diagnostics?}`. Reuse the `ticket_id` to reply.

## Admin API (JWT)

`POST /v1/auth/login` returns an 8-hour token. Five failed attempts per email locks that email for 15 minutes (in memory, per instance). Disabling an admin row kills their token on the next request.

| role | can do |
| --- | --- |
| SUPPORT | read fleet, work tickets |
| OWNER | everything, including tenants, suspend, commands, Route onboarding |

- `POST /v1/leads` public demo-request form, honeypot plus 5 per hour per IP
- `GET /v1/admin/leads`
- `GET /v1/admin/fleet`
- `GET /v1/admin/tickets?status=OPEN`, `GET /v1/admin/tickets/:id`, `POST /v1/admin/tickets/:id/reply {body, resolve?}`
- `POST /v1/admin/tenants`, `.../devices`, `.../suspend`, `.../reinstate`, `.../commands`
- `GET|POST /v1/admin/tenants/:id/route-account`

Tickets get an 8-hour SLA clock. A gym reply reopens a ticket and restarts it. Admin replies reach the gym desk through the next pull as `TICKET_REPLY`.

## Razorpay

`POST /v1/webhooks/razorpay` verifies the signature over the raw body, stores the event, and queues it. Every subscription, payment and payment link must carry these `notes`:

`tenant_id`, `subject_type` (MEMBER or GYM), `subject_id`, `device_user_id` (members)

| event | MEMBER | GYM |
| --- | --- | --- |
| subscription.charged | new lease to `current_end`, terminal expiry command | renew 7-day master lease |
| payment.failed | 48-hour GRACE lease, payment link sent by SMS, link pushed to the desk | nothing |
| payment_link.paid | ACTIVE lease for 30 days, terminal expiry command | nothing |
| subscription.paused / cancelled / halted | revoke lease, disable user | suspend gym, revoke master lease, disable all |

One link per failed payment id. A repeatable job renews master leases for ACTIVE gyms every 6 hours.

## Test without Razorpay

```
RAZORPAY_KEY_ID=rzp_key RAZORPAY_KEY_SECRET=rzp_secret RAZORPAY_BASE_URL=http://localhost:4010 ...
PORT=4010 npx tsx scripts/mock-razorpay.ts
```

## Read before production

- Razorpay calls (payment links, Route v2 accounts, stakeholders, products) were tested against the mock only. Check request shapes against Razorpay's current docs and a sandbox account first.
- Route onboarding creates and activates the linked account. Splitting a payment to it needs `transfers` on the order or payment, which the POS flow doesn't create yet.
- Payment links go to the member by SMS and to the front desk. They don't carry a Route transfer.
- Login lockout lives in process memory. Move it to Redis if you run more than one instance.
