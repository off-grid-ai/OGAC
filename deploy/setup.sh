#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Off Grid — office fleet bootstrap (MacBooks on a normal LAN)
#
# Run this on ONE Mac (the "core"). It asks for the OTHER Macs' IPs, reaches them
# over SSH, brings the stack up across the fleet, and hands you ONE URL.
#
# Topology it builds:
#   • THIS Mac (core)      → Postgres (docker) + Console (host) + Caddy edge (docker)
#   • Gateway Mac(s)       → Off Grid Desktop headless, run NATIVELY (Metal inference;
#                             cannot be containerized on macOS) — started over SSH.
#   • Everyone's browser   → http://<core-ip>:<public-port>   (one IP, via Caddy)
#
# Why not pure `docker compose up` across the fleet:
#   - macOS containers get no GPU/Metal, so the gateway must run native on its Mac.
#   - the Console currently runs as a host process (no Dockerfile yet).
#   Everything else is containerized and driven remotely via `docker context` + SSH.
#
# Re-runnable. Non-interactive: pre-set the CORE_IP / GATEWAY / SSH_USER / etc. env
# vars and answers are taken from them (used by CI / piped runs).
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONSOLE_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"

c_b=$'\033[1m'; c_g=$'\033[32m'; c_y=$'\033[33m'; c_r=$'\033[31m'; c_0=$'\033[0m'
say()  { printf '%s\n' "$*"; }
hd()   { printf '\n%s── %s ──%s\n' "$c_b" "$*" "$c_0"; }
ok()   { printf '%s✓%s %s\n' "$c_g" "$c_0" "$*"; }
warn() { printf '%s!%s %s\n' "$c_y" "$c_0" "$*"; }
die()  { printf '%s✗ %s%s\n' "$c_r" "$*" "$c_0" >&2; exit 1; }

ask() { # ask VAR "prompt" "default"  — honors a pre-set env var of the same name
  local __v=$1 __p=$2 __d=${3:-} __cur=${!1:-} __in
  if [ -n "$__cur" ]; then printf -v "$__v" '%s' "$__cur"; say "$__p ${c_g}$__cur${c_0} (from env)"; return; fi
  if [ -t 0 ]; then read -rp "$__p${__d:+ [$__d]}: " __in || true; else __in=""; fi
  printf -v "$__v" '%s' "${__in:-$__d}"
}

guess_ip() { ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname; }

hd "Off Grid office setup"
command -v docker >/dev/null || die "Docker not found. Install Docker Desktop on this Mac first."
docker info >/dev/null 2>&1 || die "Docker daemon not running. Start Docker Desktop."
command -v node   >/dev/null || die "Node not found (need >=20 for the Console)."

# ── 1. core identity ─────────────────────────────────────────────────────────
ask CORE_IP       "This Mac's LAN IP"                 "$(guess_ip)"
ask PUBLIC_PORT   "Public port for the one URL"       "80"
ask AUTH_MODE     "Auth (dev = open on LAN / keycloak)" "dev"

# ── 2. the OTHER Macs (gateways) ─────────────────────────────────────────────
hd "Gateway machine(s) — where inference runs (native Off Grid Desktop)"
say "Enter the IP of each gateway Mac. Blank line when done. Leave empty to run the"
say "gateway on THIS Mac (all-in-one)."
ask SSH_USER      "SSH username for the other Macs"   "$(whoami)"

GATEWAYS=()
if [ -n "${GATEWAY:-}" ]; then
  # non-interactive: GATEWAY may be a comma/space list
  IFS=', ' read -r -a GATEWAYS <<< "$GATEWAY"
elif [ -t 0 ]; then
  while true; do read -rp "  gateway Mac IP (enter to stop): " g || break; [ -z "$g" ] && break; GATEWAYS+=("$g"); done
fi
[ ${#GATEWAYS[@]} -eq 0 ] && { GATEWAYS=("$CORE_IP"); warn "No gateway IP given — using this Mac as the gateway too (all-in-one)."; }
GW_PRIMARY="${GATEWAYS[0]}"
GW_PORT="${GW_PORT:-7878}"

say ""
ok "Core (console/db/edge): $CORE_IP   public URL → http://$CORE_IP:$PUBLIC_PORT"
ok "Gateway(s):             ${GATEWAYS[*]}  (port $GW_PORT)"
ok "Auth mode:              $AUTH_MODE"

# ── 3. reach each gateway Mac over SSH, register a docker context ─────────────
hd "Checking the other Macs (SSH)"
SSH_OPTS="-o ConnectTimeout=6 -o StrictHostKeyChecking=accept-new"
for gw in "${GATEWAYS[@]}"; do
  [ "$gw" = "$CORE_IP" ] && { ok "$gw is this Mac — local."; continue; }
  if ssh $SSH_OPTS "${SSH_USER}@${gw}" 'echo ok' >/dev/null 2>&1; then
    ok "SSH to ${SSH_USER}@${gw} works."
    if ssh $SSH_OPTS "${SSH_USER}@${gw}" 'command -v docker >/dev/null && docker info >/dev/null 2>&1'; then
      ok "  Docker is up on $gw."
    else
      warn "  Docker not running on $gw — needed only if you containerize services there."
    fi
    # a docker context lets us drive `docker` on that Mac from here
    docker context rm "offgrid-$gw" >/dev/null 2>&1 || true
    docker context create "offgrid-$gw" --docker "host=ssh://${SSH_USER}@${gw}" >/dev/null
    ok "  docker context 'offgrid-$gw' registered."
  else
    warn "Cannot SSH to ${SSH_USER}@${gw}."
    warn "  On that Mac: System Settings → General → Sharing → enable 'Remote Login',"
    warn "  then from here run:  ssh-copy-id ${SSH_USER}@${gw}"
  fi
done

# ── 4. write Console env ──────────────────────────────────────────────────────
hd "Writing Console config"
SECRET="${AUTH_SECRET:-$(openssl rand -base64 32)}"
{
  echo "DATABASE_URL=postgresql://offgrid@localhost:5432/offgrid_console"
  echo "AUTH_SECRET=$SECRET"
  echo "NODE_ENV=production"
  echo "OFFGRID_GATEWAY_URL=http://$GW_PRIMARY:$GW_PORT"
  [ "$AUTH_MODE" = "dev" ] && echo "AUTH_DEV_LOGIN=true"
} > "$CONSOLE_DIR/.env"
ok "Wrote $CONSOLE_DIR/.env  (gateway → http://$GW_PRIMARY:$GW_PORT)"

# ── 5. generate the one-IP Caddy edge config ─────────────────────────────────
cat > "$DEPLOY_DIR/Caddyfile" <<EOF
# Generated by setup.sh — one address fronts the whole stack.
:$PUBLIC_PORT {
	# OpenAI-compatible gateway API
	handle /v1/* {
		reverse_proxy $GW_PRIMARY:$GW_PORT
	}
	handle /healthz {
		reverse_proxy $GW_PRIMARY:$GW_PORT
	}
	# everything else → the Console (running on the host)
	handle {
		reverse_proxy host.docker.internal:3000
	}
}
EOF
ok "Wrote $DEPLOY_DIR/Caddyfile"

# ── 6. bring up the stack ─────────────────────────────────────────────────────
hd "Bringing up Postgres (docker, this Mac)"
( cd "$DEPLOY_DIR" && docker compose --profile data up -d postgres )
ok "Postgres up on :5432"

hd "Console (host process)"
( cd "$CONSOLE_DIR"
  [ -d node_modules ] || npm ci
  npm run db:push
  npm run build
  # kill any prior instance, then start detached, bound to all interfaces
  pkill -f "next start -H 0.0.0.0 -p 3000" 2>/dev/null || true
  nohup npx next start -H 0.0.0.0 -p 3000 > "$DEPLOY_DIR/console.log" 2>&1 &
)
ok "Console starting on :3000 (logs: $DEPLOY_DIR/console.log)"

hd "Edge proxy (docker) — the one IP"
( cd "$DEPLOY_DIR" && OFFGRID_PUBLIC_PORT="$PUBLIC_PORT" docker compose -f docker-compose.edge.yml up -d )
ok "Edge up on :$PUBLIC_PORT"

# ── 7. start the gateway on each gateway Mac (native) ─────────────────────────
hd "Gateway(s) — native Off Grid Desktop / headless gateway"
for gw in "${GATEWAYS[@]}"; do
  GW_CMD="OFFGRID_DATA_DIR=\$HOME/.offgrid OFFGRID_BIN_DIR=/opt/offgrid/bin OFFGRID_GATEWAY_PORT=$GW_PORT nohup npx @offgrid/gateway > \$HOME/offgrid-gw.log 2>&1 &"
  if [ "$gw" = "$CORE_IP" ]; then
    warn "Gateway is this Mac. Start it natively here (needs models + binaries):"
    say  "    $GW_CMD"
  else
    say "Starting gateway on $gw over SSH…"
    if ssh $SSH_OPTS "${SSH_USER}@${gw}" "bash -lc '$GW_CMD'" 2>/dev/null; then
      ok "  launched on $gw"
    else
      warn "  could not auto-start on $gw — SSH in and run the gateway manually (needs models/binaries)."
    fi
  fi
done

# ── 8. verify + report ────────────────────────────────────────────────────────
hd "Verify"
sleep 2
curl -fsS "http://localhost:$PUBLIC_PORT/healthz" >/dev/null 2>&1 \
  && ok "edge → gateway /healthz reachable" \
  || warn "gateway /healthz not answering yet (start the native gateway; see above)."
curl -fsS "http://localhost:$PUBLIC_PORT/" >/dev/null 2>&1 \
  && ok "edge → console reachable" \
  || warn "console not answering yet (it may still be building/starting; see console.log)."

hd "Done"
say "${c_b}One URL for everyone on the WiFi:${c_0}  ${c_g}http://$CORE_IP:$PUBLIC_PORT${c_0}"
say "Tip: give the Macs stable names/IPs (DHCP reservation or .local) so the URL never moves."
