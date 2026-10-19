#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?set DATABASE_URL (app role)}"
: "${MIGRATE_DATABASE_URL:?set MIGRATE_DATABASE_URL (owner role)}"
LOG="${TMPDIR:-/tmp}/bastiongate-e2e-api.log"

npm run build >/dev/null
SUF="$RANDOM$RANDOM"
export JWT_SECRET="${JWT_SECRET:-$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/')}"
export RAZORPAY_WEBHOOK_SECRET=whsec_e2e RAZORPAY_KEY_ID=rzp_key RAZORPAY_KEY_SECRET=rzp_secret RAZORPAY_BASE_URL=http://localhost:4010
export OWNER_EMAIL="owner$SUF@e2e.test" OWNER_PASS="owner-passphrase-$SUF" SUPPORT_EMAIL="support$SUF@e2e.test" SUPPORT_PASS="support-passphrase-$SUF"

npx tsx scripts/create-admin.ts "$OWNER_EMAIL" "$OWNER_PASS" OWNER >/dev/null
npx tsx scripts/create-admin.ts "$SUPPORT_EMAIL" "$SUPPORT_PASS" SUPPORT >/dev/null

PORT=4010 node dist/scripts/mock-razorpay.js & MOCK=$!
(cd .. && PORT=3999 node api/dist/src/main.js >"$LOG" 2>&1) & API=$!
trap 'kill $MOCK $API 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do curl -fs localhost:3999/health >/dev/null 2>&1 && break; sleep 0.5; done
curl -fs localhost:3999/health >/dev/null || { echo "API did not start"; tail -20 "$LOG"; exit 1; }

BASE=http://localhost:3999 WEBHOOK_SECRET=$RAZORPAY_WEBHOOK_SECRET node dist/scripts/e2e.js
if grep -qE '\bERROR\b' "$LOG"; then echo "server logged errors:"; grep -E '\bERROR\b' "$LOG" | head; exit 1; fi
echo "server log clean"
