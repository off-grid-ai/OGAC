#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Off Grid — fleet coordinator for 5 clean-install MacBooks
#
# Runs FROM a coordinating Mac (e.g. yours) and drives the 5 target Macs over SSH.
# The Off Grid "master" runs on one of the 5 — never on the coordinator.
#
# Roles (only the SERVER needs Docker):
#   SERVER   → OrbStack(docker) + Postgres + Console + Caddy edge   ← the ONE IP
#   GATEWAY  → native Off Grid (Desktop/headless) inference on :7878  (no Docker)
#   CLIENTS  → nothing installed; just a browser to the one URL
#
# Bare-metal aware: installs Xcode CLT + Homebrew + Node on the nodes that need them.
#
# PREREQUISITES that a human must do ONCE on each target Mac (cannot be remoted):
#   1. System Settings → General → Sharing → enable "Remote Login" (SSH).
#   2. From this coordinator:  ssh-copy-id <user>@<ip>      (key-based login)
#   3. Passwordless sudo for Homebrew/CLT, OR export SUDO_PASS=... below.
#      (To set NOPASSWD once on a node:  echo "<user> ALL=(ALL) NOPASSWD: ALL" |
#       sudo tee /etc/sudoers.d/offgrid )
#
# USAGE
#   Edit the CONFIG block (or export the vars), then:
#     ./fleet.sh preflight     # check SSH/sudo/arch on every node — do this first
#     ./fleet.sh bootstrap     # install brew/node/orbstack + unpack code per role
#     ./fleet.sh up            # bring up postgres+console+edge, start gateway, tunnel
#     ./fleet.sh all           # preflight → bootstrap → up
#     ./fleet.sh status        # re-check what's running
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── CONFIG ────────────────────────────────────────────────────────────────────
SSH_USER="${SSH_USER:-}"          # admin user on the target Macs (same on all)
SERVER="${SERVER:-}"              # IP of the master/server Mac
GATEWAY="${GATEWAY:-}"            # IP of the inference Mac
CLIENTS="${CLIENTS:-}"           # space-separated IPs of the 3 client Macs (optional)
REMOTE_ROOT="${REMOTE_ROOT:-\$HOME/offgrid}"   # where you unpacked the code zip on each Mac
PUBLIC_PORT="${PUBLIC_PORT:-80}" # the single public port for the one URL
GW_PORT="${GW_PORT:-7878}"
AUTH_MODE="${AUTH_MODE:-dev}"     # dev (open on LAN) | keycloak
SUDO_PASS="${SUDO_PASS:-}"        # admin password for sudo over SSH (optional; NOPASSWD preferred)
# Gateway model/runtime locations on the GATEWAY Mac (from your unpacked zip):
GW_DATA_DIR="${GW_DATA_DIR:-\$HOME/.offgrid}"   # holds the model(s)
GW_BIN_DIR="${GW_BIN_DIR:-/opt/offgrid/bin}"    # llama-server / whisper / ffmpeg
# ──────────────────────────────────────────────────────────────────────────────

c_b=$'\033[1m'; c_g=$'\033[32m'; c_y=$'\033[33m'; c_r=$'\033[31m'; c_d=$'\033[2m'; c_0=$'\033[0m'
hd()   { printf '\n%s━━ %s ━━%s\n' "$c_b" "$*" "$c_0"; }
ok()   { printf '  %s✓%s %s\n' "$c_g" "$c_0" "$*"; }
warn() { printf '  %s!%s %s\n' "$c_y" "$c_0" "$*"; }
err()  { printf '  %s✗%s %s\n' "$c_r" "$c_0" "$*"; }
die()  { printf '%s✗ %s%s\n' "$c_r" "$*" "$c_0" >&2; exit 1; }

SSH_OPTS=(-o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -o BatchMode=yes)
sh_q() { printf '%q' "$1"; }   # shell-quote

# run a command on a remote host, streaming output
rsh() { local host=$1; shift; ssh "${SSH_OPTS[@]}" "${SSH_USER}@${host}" "$@"; }
# run a command that needs sudo on the remote (uses SUDO_PASS if set, else assumes NOPASSWD)
rsudo() {
  local host=$1; shift; local cmd=$*
  if [ -n "$SUDO_PASS" ]; then
    rsh "$host" "echo $(sh_q "$SUDO_PASS") | sudo -S -p '' bash -lc $(sh_q "$cmd")"
  else
    rsh "$host" "sudo -n bash -lc $(sh_q "$cmd")"
  fi
}

require_config() {
  [ -n "$SSH_USER" ] || die "Set SSH_USER (admin user on the Macs)."
  [ -n "$SERVER" ]   || die "Set SERVER (the master Mac IP)."
  [ -n "$GATEWAY" ]  || die "Set GATEWAY (the inference Mac IP)."
}

ALL_HOSTS() { echo "$SERVER $GATEWAY $CLIENTS"; }

# ── PREFLIGHT ─────────────────────────────────────────────────────────────────
do_preflight() {
  require_config
  hd "Preflight — SSH, sudo, arch on every node"
  local fail=0
  for h in $(ALL_HOSTS); do
    printf '%s%s%s\n' "$c_b" "$h" "$c_0"
    if rsh "$h" 'echo ok' >/dev/null 2>&1; then ok "SSH (key-based) works";
    else err "SSH failed — enable Remote Login on $h and run: ssh-copy-id ${SSH_USER}@$h"; fail=1; continue; fi
    local arch; arch=$(rsh "$h" 'uname -m' 2>/dev/null || echo '?')
    ok "arch: $arch"
    if rsh "$h" 'sudo -n true' >/dev/null 2>&1; then ok "passwordless sudo available";
    elif [ -n "$SUDO_PASS" ]; then
      if rsudo "$h" 'true' >/dev/null 2>&1; then ok "sudo via SUDO_PASS works"; else err "SUDO_PASS rejected on $h"; fail=1; fi
    else warn "no NOPASSWD sudo and no SUDO_PASS — brew/CLT install will stall on $h"; fi
  done
  [ "$fail" = 0 ] && ok "preflight passed" || die "preflight found blockers (fix the ✗ above, re-run)."
}

# ── BARE-METAL BOOTSTRAP (per node) ───────────────────────────────────────────
# Installs Xcode Command Line Tools + Homebrew + Node. Idempotent.
ensure_base() {
  local h=$1
  hd "Bootstrap base toolchain on $h"
  # Xcode Command Line Tools (headless)
  if rsh "$h" 'xcode-select -p' >/dev/null 2>&1; then ok "Xcode CLT present";
  else
    warn "installing Xcode CLT (headless)…"
    rsudo "$h" 'touch /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress' || true
    local label
    label=$(rsh "$h" "softwareupdate -l 2>/dev/null | grep -E 'Command Line Tools' | tail -1 | sed -E 's/^[* ]*Label: //; s/^[* ]*//'") || true
    [ -n "$label" ] && rsudo "$h" "softwareupdate -i $(sh_q "$label")" || warn "could not auto-pick CLT label — run 'xcode-select --install' on $h once"
    rsudo "$h" 'rm -f /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress' || true
    rsh "$h" 'xcode-select -p' >/dev/null 2>&1 && ok "CLT installed" || warn "CLT still missing on $h"
  fi
  # Homebrew (Apple Silicon → /opt/homebrew). Non-interactive.
  if rsh "$h" 'test -x /opt/homebrew/bin/brew || test -x /usr/local/bin/brew'; then ok "Homebrew present";
  else
    warn "installing Homebrew (NONINTERACTIVE)…"
    if [ -n "$SUDO_PASS" ]; then
      rsh "$h" "echo $(sh_q "$SUDO_PASS") | sudo -S -p '' -v; NONINTERACTIVE=1 /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    else
      rsh "$h" 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    fi
    rsh "$h" 'test -x /opt/homebrew/bin/brew || test -x /usr/local/bin/brew' && ok "Homebrew installed" || die "Homebrew install failed on $h"
  fi
  # Node (>=20)
  if rsh "$h" 'eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"; node -v' >/dev/null 2>&1; then
    ok "Node present"
  else
    warn "installing Node…"
    rsh "$h" 'eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"; brew install node'
    ok "Node installed"
  fi
}

ensure_orbstack() {  # server only — the only node that needs Docker
  local h=$1
  hd "OrbStack (Docker) on $h"
  if rsh "$h" 'command -v orb >/dev/null 2>&1 || test -d /Applications/OrbStack.app'; then ok "OrbStack present";
  else
    warn "installing OrbStack…"
    rsh "$h" 'eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"; brew install --cask orbstack'
    ok "OrbStack installed"
  fi
  rsh "$h" 'orb start >/dev/null 2>&1 || open -ga OrbStack' || true
  # wait for docker to answer
  local i; for i in $(seq 1 30); do rsh "$h" 'docker info >/dev/null 2>&1' && { ok "docker daemon up"; return; }; sleep 2; done
  warn "docker daemon didn't come up on $h within 60s — open OrbStack once on that Mac."
}

do_bootstrap() {
  require_config
  # base toolchain where it's needed
  ensure_base "$SERVER"
  ensure_base "$GATEWAY"
  ensure_orbstack "$SERVER"
  hd "Verify code is present (you push the zip; we just check)"
  for h in "$SERVER" "$GATEWAY"; do
    if rsh "$h" "test -f $REMOTE_ROOT/console/deploy/docker-compose.yml || test -f $REMOTE_ROOT/deploy/docker-compose.yml || test -d $REMOTE_ROOT"; then
      ok "$h: code found at $REMOTE_ROOT"
    else
      warn "$h: no code at $REMOTE_ROOT — push & unzip your repo there (set REMOTE_ROOT to match)."
    fi
  done
  ok "bootstrap complete"
}

# ── BRING UP ──────────────────────────────────────────────────────────────────
# locate the console dir inside whatever the user unzipped
console_dir() { echo "$REMOTE_ROOT/console"; }

start_server() {
  local h=$SERVER; local cdir; cdir=$(console_dir)
  hd "SERVER $h — Postgres + Console + edge"
  local secret; secret=$(rsh "$h" 'openssl rand -base64 32')
  # .env — console talks to the gateway via a local tunnel (see start_tunnel)
  rsh "$h" "cat > $cdir/.env <<EOF
DATABASE_URL=postgresql://offgrid@localhost:5432/offgrid_console
AUTH_SECRET=$secret
NODE_ENV=production
OFFGRID_GATEWAY_URL=http://127.0.0.1:$GW_PORT
$( [ "$AUTH_MODE" = dev ] && echo 'AUTH_DEV_LOGIN=true' )
EOF"
  ok "wrote .env"
  # generated Caddyfile (one IP: / → console, /v1+/healthz → gateway via tunnel)
  rsh "$h" "cat > $cdir/deploy/Caddyfile <<EOF
:$PUBLIC_PORT {
	handle /v1/* { reverse_proxy 127.0.0.1:$GW_PORT }
	handle /healthz { reverse_proxy 127.0.0.1:$GW_PORT }
	handle { reverse_proxy host.docker.internal:3000 }
}
EOF"
  ok "wrote Caddyfile"
  # postgres
  rsh "$h" "cd $cdir/deploy && docker compose --profile data up -d postgres"
  ok "Postgres up"
  # console (host process)
  rsh "$h" "eval \"\$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)\"; cd $cdir && { [ -d node_modules ] || npm ci; } && npm run db:push && npm run build && pkill -f 'next start -H 0.0.0.0' 2>/dev/null; nohup npx next start -H 0.0.0.0 -p 3000 > $cdir/deploy/console.log 2>&1 & echo started"
  ok "Console starting on :3000"
  # edge
  rsh "$h" "cd $cdir/deploy && OFFGRID_PUBLIC_PORT=$PUBLIC_PORT docker compose -f docker-compose.edge.yml up -d"
  ok "Edge up on :$PUBLIC_PORT"
}

start_gateway() {
  local h=$GATEWAY
  hd "GATEWAY $h — native inference on :$GW_PORT"
  # Prefer full Off Grid Desktop (it actually serves inference today); fall back to headless gateway.
  if rsh "$h" 'test -d /Applications/"Off Grid AI Desktop".app -o -d /Applications/OffGrid.app'; then
    rsh "$h" 'open -ga "Off Grid AI Desktop" 2>/dev/null || open -ga OffGrid' || true
    ok "launched Off Grid Desktop (serves the gateway in-process)"
  else
    warn "Desktop app not found — starting headless @offgrid/gateway (v0.1: /healthz + /v1/models only)."
    rsh "$h" "eval \"\$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)\"; OFFGRID_DATA_DIR=$GW_DATA_DIR OFFGRID_BIN_DIR=$GW_BIN_DIR OFFGRID_GATEWAY_PORT=$GW_PORT nohup npx @offgrid/gateway > \$HOME/offgrid-gw.log 2>&1 & echo started"
    ok "headless gateway starting"
  fi
}

start_tunnel() {
  # The embedded gateway binds 127.0.0.1 on the GATEWAY Mac. Give the SERVER a local
  # 127.0.0.1:GW_PORT that forwards to the gateway, so Console + Caddy reach it cleanly.
  hd "SSH tunnel SERVER → GATEWAY for :$GW_PORT"
  rsh "$SERVER" "pkill -f 'ssh -fNL $GW_PORT:' 2>/dev/null; ssh -o StrictHostKeyChecking=accept-new -fNL $GW_PORT:127.0.0.1:$GW_PORT ${SSH_USER}@${GATEWAY}" \
    && ok "tunnel up on server's 127.0.0.1:$GW_PORT" \
    || warn "tunnel failed — ensure the server Mac has key-based SSH to the gateway Mac ($GATEWAY)."
}

do_up() {
  require_config
  start_gateway
  start_server
  start_tunnel
  do_status
}

do_status() {
  require_config
  hd "Status"
  local url="http://$SERVER:$PUBLIC_PORT"
  rsh "$SERVER" "curl -fsS http://localhost:$PUBLIC_PORT/ >/dev/null 2>&1" && ok "Console reachable via edge" || warn "Console not answering yet (see deploy/console.log on $SERVER)"
  rsh "$SERVER" "curl -fsS http://localhost:$PUBLIC_PORT/healthz >/dev/null 2>&1" && ok "Gateway reachable via edge" || warn "Gateway /healthz not answering yet (model/app on $GATEWAY)"
  for c in $CLIENTS; do ok "client $c → open $url in a browser"; done
  printf '\n%sONE URL for everyone on the WiFi:%s  %s%s%s\n' "$c_b" "$c_0" "$c_g" "$url" "$c_0"
}

# ── dispatch ──────────────────────────────────────────────────────────────────
case "${1:-help}" in
  preflight) do_preflight ;;
  bootstrap) do_bootstrap ;;
  up)        do_up ;;
  status)    do_status ;;
  all)       do_preflight; do_bootstrap; do_up ;;
  *) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; ;;
esac
