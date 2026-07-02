#!/usr/bin/env bash
# prod.sh — build and start the Off Grid console in production mode.
#
# Usage:
#   ./deploy/prod.sh           # full build + start
#   ./deploy/prod.sh start     # skip build, start only (after a prior build)
#   ./deploy/prod.sh verify    # run post-start header + rate-limit smoke tests
#
# Prerequisites:
#   - .env.production exists and AUTH_URL / DATABASE_URL are filled in
#   - Cloudflare Tunnel is running (cloudflared tunnel run)
#   - Postgres is up (make up or make data from deploy/)

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.production"

check_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE not found. Copy .env.local and harden it first." >&2
    exit 1
  fi
  if grep -q "CHANGE_ME" "$ENV_FILE"; then
    echo "ERROR: $ENV_FILE still has CHANGE_ME placeholders. Fill them in first." >&2
    exit 1
  fi
  if grep -q "yourdomain.com" "$ENV_FILE"; then
    echo "WARNING: AUTH_URL in $ENV_FILE still points to yourdomain.com — update before going live."
  fi
}

build() {
  echo "==> Building..."
  NODE_ENV=production npm run build
}

start() {
  echo "==> Starting..."
  # Kill any existing next-server process
  pkill -f 'next-server\|next start' 2>/dev/null || true
  sleep 1
  # next start reads .env.production automatically when NODE_ENV=production.
  # Use full node path for non-interactive SSH sessions where PATH may be minimal.
  NODE_BIN="$(command -v node 2>/dev/null || echo /usr/local/bin/node)"
  NEXT_BIN="$(command -v next 2>/dev/null || echo /usr/local/bin/next)"
  NODE_ENV=production "$NODE_BIN" "$NEXT_BIN" start -H 0.0.0.0 -p 3000 >> "$(dirname "$0")/console.log" 2>&1 &
  echo "Console running (PID $!) — logs at deploy/console.log"
}

verify() {
  BASE="${1:-http://localhost:3000}"
  echo "==> Verifying headers at $BASE ..."
  HEADERS=$(curl -sI "$BASE")
  for h in "x-frame-options" "x-content-type-options" "strict-transport-security" "content-security-policy"; do
    if echo "$HEADERS" | grep -qi "$h"; then
      echo "  [OK] $h"
    else
      echo "  [MISSING] $h" >&2
    fi
  done

  echo "==> Verifying dev login is disabled..."
  SIGNIN=$(curl -s "$BASE/signin")
  if echo "$SIGNIN" | grep -qi "credentials"; then
    echo "  [FAIL] Dev credentials form is visible — AUTH_DEV_LOGIN must be false" >&2
  else
    echo "  [OK] No credentials form"
  fi

  echo "==> Rate limit smoke test (sending 65 requests to /api/v1/chat/models)..."
  COUNT_429=$(for i in $(seq 1 65); do
    curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/v1/chat/models"
  done | grep -c "^429$" || true)
  if [[ "$COUNT_429" -gt 0 ]]; then
    echo "  [OK] Got ${COUNT_429}x 429 after limit"
  else
    echo "  [WARN] No 429s seen — rate limiter may not be firing (check if requests are auth-gated first)"
  fi
}

CMD="${1:-all}"
case "$CMD" in
  all)
    check_env
    build
    start
    ;;
  start)
    check_env
    start
    ;;
  verify)
    verify "${2:-http://localhost:3000}"
    ;;
  *)
    echo "Usage: $0 [all|start|verify [base-url]]"
    exit 1
    ;;
esac
