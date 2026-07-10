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
SHARED_PKGS=(analytics finops policy vectordb speech)

# The console is supervised by the admin LaunchAgent `co.getoffgridai.console`
# (start-console.sh → npm start → next start on :3000, KeepAlive). NEVER pkill+nohup
# a fresh `next start` — that fights the supervisor (which respawns its own copy on
# KeepAlive), leaving TWO servers racing for :3000. On 2026-07-10 that produced 684
# EADDRINUSE lines and a 3-day-old ROOT-owned next-server that pkill (run as admin)
# could not kill, serving stale code behind a Cloudflare 502. Restart = kickstart the
# agent; the supervisor owns the one true process. Stale/root listeners are cleared first.
CONSOLE_AGENT="${CONSOLE_AGENT:-co.getoffgridai.console}"

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

# ── 3. Sync the console source (NEVER clobber server env, build, or live data) ──
# CRITICAL: --delete would wipe server-only paths that aren't in the repo. `.lancedb` is the LIVE
# embedded vector store (the Brain's knowledge) and `.env*` is runtime config — excluding them keeps
# --delete from destroying live state on every deploy. NEVER remove these excludes.
say "Syncing console source"
rsync -az --delete -e "ssh -i $SSH_KEY" \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude '.env' --exclude '.env.local' --exclude '.env.production' \
  --exclude '.lancedb' \
  --exclude 'deploy/console.log' --exclude '.claude' \
  "$CONSOLE_DIR/" "${SSH_USER}@${SERVER}:$REMOTE/console/"

# ── 4. Install deps, build, restart ──
# Install deps FIRST — the rsync ships the updated package.json but NOT node_modules, so a newly
# added dependency (e.g. @pdf-lib/fontkit) is absent on the server and the build fails with an
# opaque webpack "can't resolve" error. `npm install` is idempotent + fast when nothing changed, so
# run it every deploy. (This was previously only a comment — the actual install was missing, which
# broke a deploy that added a dep. Now it really runs.)
say "Installing server deps (npm install)"
$SSH "cd $REMOTE/console && export PATH=/usr/local/bin:\$PATH && /usr/local/bin/npm install --no-audit --no-fund" 2>&1 | tail -3

say "Building on the server"
# ALWAYS clean .next first. Incremental builds leave STALE chunk hashes when routes/chunks change:
# the manifest references chunk files that no longer exist on disk → the browser 400s on
# /_next/static/chunks/* → ChunkLoadError / "Something went wrong here" on navigation. A clean build
# regenerates a self-consistent manifest+chunks. (Cost: ~30s longer build; worth it — this trap has
# broken prod twice.)
# Drop a marker the moment the build finishes: any :3000 process whose start-time
# predates it is serving the OLD build and must be cleared (see the restart block).
$SSH "cd $REMOTE/console && rm -rf .next && $NODE node_modules/.bin/next build && touch deploy/.build-done" 2>&1 | tail -8

# ── 5. Restart via the launchd supervisor — clear stale/root listeners, then verify ──
# This whole block runs ON the server as a single remote script so process inspection
# (lsof/ps/kill) and the launchctl call happen in one place. It is idempotent + safe to
# re-run: killing a stale/root process, then kickstarting the agent, converges to exactly
# one fresh listener regardless of the starting state.
say "Restarting console via launchd ($CONSOLE_AGENT) — clearing any stale/root listener on :$PORT"
$SSH "PORT='$PORT' AGENT='$CONSOLE_AGENT' MARKER='$REMOTE/console/deploy/.build-done' bash -s" <<'REMOTE_RESTART'
set -u
fail() { printf 'DEPLOY-FAIL: %s\n' "$*" >&2; exit 1; }

# Build-done epoch — the cutoff. A listener started before this is serving stale code.
BUILD_EPOCH="$(/usr/bin/stat -f %m "$MARKER" 2>/dev/null || echo 0)"

# Start epoch of a pid, in seconds since the epoch. macOS `ps -o lstart=` prints an
# absolute date we convert with `date -j -f`; robust across the DHCP/tz churn on this box.
pid_start_epoch() {
  local pid="$1" lstart
  lstart="$(/bin/ps -o lstart= -p "$pid" 2>/dev/null | /usr/bin/sed 's/^ *//')"
  [ -n "$lstart" ] || { echo 0; return; }
  /bin/date -j -f '%a %b %e %T %Y' "$lstart" +%s 2>/dev/null || echo 0
}

# Clear stale/duplicate/root-owned listeners BEFORE start. Never leave two supervisors bound.
clear_stale() {
  local pids pid owner start
  pids="$(/usr/sbin/lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  for pid in $pids; do
    owner="$(/bin/ps -o user= -p "$pid" 2>/dev/null | /usr/bin/sed 's/^ *//')"
    start="$(pid_start_epoch "$pid")"
    if [ "$owner" = "root" ]; then
      echo "  :$PORT held by ROOT pid $pid (started epoch $start) — sudo kill -9 (today's culprit class)"
      /usr/bin/sudo -n /bin/kill -9 "$pid" 2>/dev/null \
        || fail "root pid $pid on :$PORT could not be killed (sudo -n failed) — clear it by hand"
    elif [ "$start" -lt "$BUILD_EPOCH" ]; then
      echo "  :$PORT held by STALE pid $pid (started $start < build $BUILD_EPOCH) — kill -9"
      /bin/kill -9 "$pid" 2>/dev/null || /usr/bin/sudo -n /bin/kill -9 "$pid" 2>/dev/null \
        || fail "stale pid $pid on :$PORT could not be killed"
    else
      # A current-build process the supervisor already owns — kickstart -k will replace it.
      echo "  :$PORT held by pid $pid (owner $owner, started $start ≥ build) — supervisor will replace"
    fi
  done
}

clear_stale
# Give the kernel a beat to release the socket after any kill.
sleep 2
clear_stale   # idempotent second pass: a KeepAlive supervisor may have respawned a stale child

echo "  kickstart -k gui/$(id -u)/$AGENT"
/bin/launchctl kickstart -k "gui/$(id -u)/$AGENT" \
  || fail "launchctl kickstart of $AGENT failed — is the LaunchAgent installed? (recover.sh reinstalls it)"

# ── Verify: EXACTLY ONE listener on :$PORT, started AFTER the build ──
ok=""
for i in $(seq 1 30); do
  pids="$(/usr/sbin/lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null | /usr/bin/sort -u || true)"
  n="$(printf '%s\n' "$pids" | /usr/bin/grep -c . || true)"
  if [ "$n" -eq 1 ]; then
    start="$(pid_start_epoch "$pids")"
    if [ "$start" -ge "$BUILD_EPOCH" ]; then ok=1; break; fi
  fi
  sleep 2
done
[ -n "$ok" ] || {
  echo "  listeners on :$PORT now:"; /usr/sbin/lsof -i:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  fail "did NOT converge to one fresh listener on :$PORT after 60s (n=${n:-?}, start=${start:-?}, build=$BUILD_EPOCH) — stale build or two supervisors still racing"
}
echo "  VERIFIED: one listener (pid $pids) on :$PORT, started $start ≥ build $BUILD_EPOCH (serving the NEW build)"
REMOTE_RESTART

say "Health check"
$SSH "curl -s -o /dev/null -w 'signin: %{http_code}\n' http://localhost:$PORT/signin"

cat <<EOF

Deploy complete. If you added a DB table, apply the migration:
    ./deploy/push.sh   # does NOT run migrations
    # then, for schema changes, see deploy/DEPLOY.md § "Database migrations"
EOF
