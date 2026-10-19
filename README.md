# BastionGate

> **Offline-first biometric gym access, attendance, and autonomous billing for commercial facilities.**
> Powered by the high-assurance cryptographic access lease engine.

---

## 1. The Core Problem: The "Trash Can" Turnstile Hack

In traditional fitness facilities, turnstiles check a remote cloud API on every biometric scan or mobile tap. When local broadband or Wi-Fi drops—a frequent reality in commercial basements and high-density metro areas:
- **Operations Stall:** The turnstile halts, crowds accumulate at the front desk, and morning rush-hour check-ins back up into the street.
- **The "Trash Can" Hack:** Front desk staff inevitably prop open the optical barrier or turnstile gate with a trash can.
- **Revenue Leakage:** Unpaid or lapsed members walk straight in for free, while paying members experience frustration.

**BastionGate eliminates cloud turnstile dependencies by shifting access decisions to cryptographic edge verification.**

---

## 2. Core Architecture & Philosophy

```text
                  ┌──────────────────────────────────────────────┐
                  │            BASTIONGATE CLOUD API            │
                  │   NestJS 11 + Fastify 5 + Postgres (RLS)     │
                  │   Ed25519 Hardware Signing (AWS KMS / Local) │
                  └───────────────┬──────────────────────────────┘
                                  │
                 Cloud Issues 7-Day Master Leases & Member Leases
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│     GYM EDGE MASTER UNIT        │       │      MEMBER MOBILE PASS         │
│  Hardened DIN-rail Controller   │       │  P2P Sneakernet Lease Carrier   │
│  Local SQLite Cache + Audit     │       │  Receives Updates via 4G/5G     │
│  Monotonic High-Water Mark      │       │  Hands Leases to Gate via NFC/QR│
└────────────────┬────────────────┘       └────────────────┬────────────────┘
                 │                                         │
                 │   Evaluates 5 Checks in <15ms Locally   │
                 └───────────────────►◄────────────────────┘
                                     │
                             Dry Contact Relay
                                     ▼
                    ┌─────────────────────────────────┐
                    │  OPTICAL TURNSTILE / BARRIER    │
                    │  eSSL / ZKTeco / Hikvision /    │
                    │  Matrix COSEC (<250ms Actuation)│
                    └─────────────────────────────────┘
```

### 1. 7 Days Dark Mode
The turnstile stanchion operates **100% offline for up to 7 consecutive days**. Access decisions evaluate locally via deterministic Canonical JSON and public-key cryptography in under 15 milliseconds.

### 2. P2P "Sneakernet" Lease Carrier (Smart 48-Hour Grace)
*How does an offline turnstile know when an auto-debit fails?*
If a UPI Autopay or card mandate fails via Razorpay, the cloud issues a signed **48-hour grace lease** and payment link to the **member's phone over 4G/5G mobile data**. When the member scans at the gate, their phone transfers the updated cryptographic lease directly to the offline controller via QR or NFC. The gate permits entry at hour 36 and automatically refuses access at hour 49 if unpaid—**no gym internet connection required**.

### 3. Retrofit vs. Rip-and-Replace (Save ₹1.5L / Lane)
Gym owners do **not** discard their existing ₹1.5L optical turnstiles or biometric terminals. The BastionGate DIN-rail Edge Master Unit drops right in front of existing eSSL, ZKTeco, Hikvision, or Matrix COSEC dry-contact relays in 20 minutes.

### 4. Monotonic Clock Rollback Defense
If an attacker rolls the local operating system clock back to extend an expired membership, the system's monotonic **High-Water Mark (HWM)** trips immediately, locking the lane and creating a tamper audit entry.

---

## 3. Repository Layout

```text
latchkey/
├── api/                               # Cloud backend & admin console
│   ├── src/
│   │   ├── lease/                     # Ed25519 signing, verification & canonical JSON
│   │   ├── billing/                   # Razorpay Route & webhook state machine
│   │   ├── leads.controller.ts        # Lead capture with HMAC-SHA256 IP privacy
│   │   └── console.controller.ts      # Multi-candidate static view loader
│   ├── public/admin.html              # Single-page Super-Admin Console
│   └── scripts/                       # E2E test runners, smoke tests, Razorpay mock
└── website/                           # Interactive marketing site & simulator
    ├── index.html                     # 320px-responsive landing page
    └── assets/                        # Photographic hardware assets
```

---

## 4. Six Interactive Live Features on the Website

The marketing platform at `http://localhost:5000` features **6 live interactive demonstrations**:

1. **"Pull the Plug" 8-Day Slider:** Drag through 8 days of broadband disconnection to inspect local outbox accumulation and safety expirations.
2. **Interactive 3D Turnstile Relay Simulator:** Trigger 5 real scenarios (*Paid Member*, *+36h Grace*, *+50h Overdue*, *Clock Rollback Attack*, *Day 5 Offline*) and watch 3D glass barrier wings rotate open with 250ms relay pulses.
3. **Hardware Showcase Gallery:** Architectural photography of Dual-Lane Optical Speed Gates, the DIN-rail Edge Master Unit, and the Cryptographic Mobile Pass.
4. **Sovereign Fleet Telemetry Radar:** Live multi-city fleet health board across Mumbai, Bengaluru, Delhi, Hyderabad, and Pune with interactive round-trip latency pings.
5. **Universal Hardware & Protocol Matrix:** Technical breakdown covering OSDP v2.2, Wiegand 26/34, TCP/IP sockets, and Form-C dry contact relays.
6. **Privacy-Preserving Demo Booking Engine:** Direct lead capture backed by cryptographic HMAC-SHA256 visitor IP anonymization.

---

## 5. Quickstart & Local Execution

### Prerequisites
- Node.js 20+ (Verified on Node v24)
- Docker Desktop (for Postgres 16 and Redis 7 during full multi-tenant E2E runs)

### Run Cloud API
```bash
cd api
npm install
npm run build
npm test             # 13 tests: 9 access-decision unit tests + 4 cryptographic security tests
npm run smoke        # Canonical JSON stability & Ed25519 signature tamper verification
npm start            # Starts BastionGate API on port 3000
```

### Run Static Marketing Site & Simulator
```bash
# Serves website with image asset delivery on port 5000
node -e "const http = require('http'), fs = require('fs'), path = require('path'); const mime = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'application/javascript' }; http.createServer((req, res) => { let reqPath = decodeURI(req.url.split('?')[0]); if (reqPath === '/' || !path.extname(reqPath)) reqPath = '/index.html'; const full = path.join(process.cwd(), 'website', reqPath); if (fs.existsSync(full) && fs.statSync(full).isFile()) { res.writeHead(200, { 'content-type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(full).pipe(res); } else { res.writeHead(404); res.end('Not Found'); } }).listen(5000, '0.0.0.0', () => console.log('Website running at http://localhost:5000'));"
```

### Full Multi-Tenant E2E Run (Docker Available)
```bash
docker compose up -d postgres redis
cd api
export DATABASE_URL="postgres://latchkey_app:app-pass@localhost:5432/latchkey"
export MIGRATE_DATABASE_URL="postgres://latchkey_owner:owner-pass@localhost:5432/latchkey"
npm run migrate
npm run e2e
```
