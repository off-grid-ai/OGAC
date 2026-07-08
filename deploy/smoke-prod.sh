#!/usr/bin/env bash
#
# Prod regression smoke — runs the API smoke against the LIVE console over the
# Cloudflare tunnel. Pulls the admin bearer from the server's .env.local (never
# stored locally), then exercises the real governed paths end-to-end:
# agents CRUD + governed run (durable 202 → polled to completion), provenance
# sign/verify, grounding, PII scan (Indian-BFSI recognizers), sandbox exec,
# ABAC, cache, MDM, QA status.
#
#   ./deploy/smoke-prod.sh                    # default host + tunnel ssh alias
#   BASE=https://onprem-console.getoffgridai.co SSH=offgrid-tunnel ./deploy/smoke-prod.sh
#
# Exit code is the smoke's own (non-zero if any check fails), so this gates CI/deploys.
set -euo pipefail

BASE="${BASE:-https://onprem-console.getoffgridai.co}"
SSH_ALIAS="${SSH:-offgrid-tunnel}"
REMOTE_ENV="${REMOTE_ENV:-/Users/admin/offgrid/console/.env.local}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Pulling admin token from ${SSH_ALIAS}:${REMOTE_ENV}"
TOK="$(ssh -o ConnectTimeout=25 "$SSH_ALIAS" \
  "awk -F= '/^OFFGRID_ADMIN_TOKEN=/{sub(/^OFFGRID_ADMIN_TOKEN=/,\"\");gsub(/[\"'\'' ]/,\"\");print;exit}' $REMOTE_ENV")"
[ -n "$TOK" ] || { echo "FATAL: could not read OFFGRID_ADMIN_TOKEN from $REMOTE_ENV"; exit 2; }
echo "==> Token OK (len ${#TOK}); smoking $BASE"

BASE="$BASE" OFFGRID_ADMIN_TOKEN="$TOK" node "$ROOT/scripts/smoke.mjs" --api
