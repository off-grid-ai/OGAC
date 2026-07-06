#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# push.sh — deploy the console to the on-prem SERVER over SSH, WITHOUT git.
#
# WHY NOT git: the SERVER Mac has no Xcode Command Line Tools, so `git` is a
# non-functional shim there — every `git pull` fails silently and the code never
# updates. This script rsyncs source straight from the coordinator (your Mac).
#
# It also syncs the file:-linked @offgrid/* packages the console imports, because
# the `shared` monorepo is NOT checked out on the server (only console + gateway).
#
# Run FROM your Mac (the coordinator), NOT on the server:
#     ./deploy/push.sh
#
# Config via env (defaults shown):
#     SERVER=127.0.0.1  SSH_USER=admin  SSH_KEY=~/.ssh/id_ed25519
#     REMOTE=/Users/admin/offgrid   NODE=/usr/local/bin/node
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SERVER="${SERVER:-127.0.0.1}"
SSH_USER="${SSH_USER:-admin}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE="${REMOTE:-/Users/admin/offgrid}"
NODE="${NODE:-/usr/local/bin/node}"
PORT="${PORT:-3000}"

# Local repo roots (this script lives in console/deploy)
CONSOLE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE="$(cd "$CONSOLE_DIR/.." && pwd)"   # holds console, shared, gateway

SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new ${SSH_USER}@${SERVER}"
RSYNC="rsync -az -e \"ssh -i $SSH_KEY\""

# @offgrid/* packages the console file:-links (keep in sync with package.json)
SHARED_PKGS=(analytics finops policy vectordb)

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# ── 1. Sync shared packages (dist + package.json, no node_modules/src churn) ──
say "Syncing @offgrid/* shared packages"
$SSH "mkdir -p $REMOTE/shared/packages"
for p in "${SHARED_PKGS[@]}"; do
  rsync -az -e "ssh -i $SSH_KEY" --exclude node_modules \
    "$WORKSPACE/shared/packages/$p/" \
    "${SSH_USER}@${SERVER}:$REMOTE/shared/packages/$p/"
  echo "  synced shared/$p"
done

# ── 2. Sync the gateway package (build-time dep: provides @offgrid/gateway/queue) ──
say "Syncing @offgrid/gateway (dist + package.json)"
rsync -az -e "ssh -i $SSH_KEY" --exclude node_modules --exclude src \
  "$WORKSPACE/gateway/dist/" "${SSH_USER}@${SERVER}:$REMOTE/gateway/dist/"
rsync -az -e "ssh -i $SSH_KEY" \
  "$WORKSPACE/gateway/package.json" "${SSH_USER}@${SERVER}:$REMOTE/gateway/package.json"

# ── 3. Sync the console source (NEVER clobber server env or build) ──
say "Syncing console source"
rsync -az --delete -e "ssh -i $SSH_KEY" \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude '.env' --exclude '.env.local' --exclude '.env.production' \
  --exclude 'deploy/console.log' --exclude '.claude' \
  "$CONSOLE_DIR/" "${SSH_USER}@${SERVER}:$REMOTE/console/"

# ── 4. Install deps (only if package.json changed), build, restart ──
say "Building on the server"
# ALWAYS clean .next first. Incremental builds leave STALE chunk hashes when routes/chunks change:
# the manifest references chunk files that no longer exist on disk → the browser 400s on
# /_next/static/chunks/* → ChunkLoadError / "Something went wrong here" on navigation. A clean build
# regenerates a self-consistent manifest+chunks. (Cost: ~30s longer build; worth it — this trap has
# broken prod twice.)
$SSH "cd $REMOTE/console && rm -rf .next && $NODE node_modules/.bin/next build" 2>&1 | tail -8

say "Restarting console (no pm2 — plain backgrounded next start)"
$SSH "pkill -f 'next-server' 2>/dev/null; pkill -f 'next start' 2>/dev/null; sleep 2; \
  cd $REMOTE/console && NODE_ENV=production nohup $NODE node_modules/.bin/next start -H 0.0.0.0 -p $PORT >> deploy/console.log 2>&1 & echo started"

sleep 5
say "Health check"
$SSH "curl -s -o /dev/null -w 'signin: %{http_code}\n' http://localhost:$PORT/signin"

cat <<EOF

Deploy complete. If you added a DB table, apply the migration:
    ./deploy/push.sh   # does NOT run migrations
    # then, for schema changes, see deploy/DEPLOY.md § "Database migrations"
EOF
