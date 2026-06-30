#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Off Grid on-prem fleet — RECOVERY / HEALTH script.
#
# Run from the COORDINATOR Mac. Brings the 5-node fleet back to known-good:
#   • finds each node's CURRENT IP by its stable mDNS name (survives network changes)
#   • regenerates the IP-based config (edge Caddyfile, /etc/hosts)
#   • restarts/repairs every service (Postgres, Keycloak, edge, 2 consoles, 3 gateways)
#   • prints a PASS/FAIL health report
#
# Idempotent — safe to run anytime things drift (reboot, network switch, a service died).
#
# Usage:  ./recover.sh            # full recover + health report
#         ./recover.sh health     # health report only (no restarts)
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

USER="${OFFGRID_SSH_USER:-admin}"
SSH=(ssh -o ConnectTimeout=8 -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
ORB='/Applications/OrbStack.app/Contents/MacOS/bin:/Applications/OrbStack.app/Contents/MacOS/xbin:/usr/local/bin'

# stable mDNS names (set once, survive IP changes)
S1=offgrid-s1; S2=offgrid-s2; G1=offgrid-g1; G2=offgrid-g2; G3=offgrid-g3
GATEWAYS=($G1 $G2 $G3); CONSOLES=($S1 $S2)

g=$'\033[32m'; r=$'\033[31m'; y=$'\033[33m'; b=$'\033[1m'; x=$'\033[0m'
ok(){ printf "  ${g}✓${x} %s\n" "$*"; }; bad(){ printf "  ${r}✗${x} %s\n" "$*"; }; warn(){ printf "  ${y}!${x} %s\n" "$*"; }
hd(){ printf "\n${b}━━ %s ━━${x}\n" "$*"; }

ssh_to(){ local n=$1; shift; "${SSH[@]}" "${USER}@${n}.local" "$@"; }
ip_of(){ ping -c1 -t2 "$1.local" 2>/dev/null | sed -n 's/.*(\([0-9.]*\)).*/\1/p' | head -1; }
code(){ curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-8}" "$1" 2>/dev/null; }

MODE="${1:-recover}"

# ── 1. discover current IPs ──────────────────────────────────────────────────
hd "Discover nodes (by mDNS name → current IP)"
declare -A IP
for n in $S1 $S2 $G1 $G2 $G3; do
  IP[$n]=$(ip_of "$n")
  if [ -n "${IP[$n]}" ] && ssh_to "$n" true 2>/dev/null; then ok "$n → ${IP[$n]}"; else bad "$n unreachable (mDNS=${IP[$n]:-none})"; fi
done
SERVER_IP="${IP[$S1]}"
[ -z "$SERVER_IP" ] && { bad "S1 ($S1) unreachable — cannot recover"; exit 1; }

if [ "$MODE" = "recover" ]; then
  # ── 2. regenerate IP-based config (handles a network/IP change) ─────────────
  hd "Regenerate edge config + hosts for current IPs"
  ssh_to "$S1" "cat > ~/offgrid/console/deploy/Caddyfile" <<EOF
{
	auto_https off
	admin off
}
http://onprem-console.getoffgridai.co, http://${IP[$S1]} {
	reverse_proxy ${IP[$S1]}:3000 ${IP[$S2]}:3000 {
		lb_policy cookie offgrid_console
		health_uri /signin
		health_interval 10s
	}
}
:8800 {
	reverse_proxy ${IP[$G1]}:7878 ${IP[$G2]}:7878 ${IP[$G3]}:7878 {
		lb_policy round_robin
		health_uri /health
		health_interval 10s
		health_timeout 3s
	}
}
http://local.getoffgridai.co { reverse_proxy ${IP[$S1]}:3100 }
EOF
  ssh_to "$S1" "/usr/local/bin/caddy validate --adapter caddyfile --config ~/offgrid/console/deploy/Caddyfile >/dev/null 2>&1 && echo ok" >/dev/null && ok "Caddyfile valid" || warn "Caddyfile validate failed"
  # /etc/hosts on every node → onprem-console/local resolve to S1
  for n in $S1 $S2 $G1 $G2 $G3; do
    [ -z "${IP[$n]}" ] && continue
    ssh_to "$n" "sudo sed -i '' '/getoffgridai.co/d' /etc/hosts; echo '${SERVER_IP} onprem-console.getoffgridai.co local.getoffgridai.co' | sudo tee -a /etc/hosts >/dev/null"
  done
  ok "/etc/hosts updated on all nodes → $SERVER_IP"
  # console .env: make sure OFFGRID_GATEWAY_URL + (S2) DATABASE_URL point at current S1 IP
  ssh_to "$S2" "cd ~/offgrid/console; grep -v '^DATABASE_URL=' .env > .env.t; echo 'DATABASE_URL=postgresql://offgrid:offgrid@${SERVER_IP}:5432/offgrid_console' >> .env.t; grep -v '^OFFGRID_GATEWAY_URL=' .env.t > .env; echo 'OFFGRID_GATEWAY_URL=http://${SERVER_IP}:8800' >> .env; rm -f .env.t"
  ssh_to "$S1" "cd ~/offgrid/console; grep -v '^OFFGRID_GATEWAY_URL=' .env > .env.t; echo 'OFFGRID_GATEWAY_URL=http://${SERVER_IP}:8800' >> .env.t; mv .env.t .env"
  ssh_to "$S1" "cd ~/offgrid/console; grep -v '^AUTH_URL=' .env > .env.t; echo 'AUTH_URL=http://${SERVER_IP}' >> .env.t; mv .env.t .env"
  ssh_to "$S2" "cd ~/offgrid/console; grep -v '^AUTH_URL=' .env > .env.t; echo 'AUTH_URL=http://${SERVER_IP}' >> .env.t; mv .env.t .env"
  ok "console .env re-pointed at $SERVER_IP"

  # ── 3. ensure services up ───────────────────────────────────────────────────
  hd "S1 — OrbStack + Postgres + Keycloak + edge + console"
  ssh_to "$S1" "export PATH=$ORB:\$PATH; orb start >/dev/null 2>&1; for i in \$(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 2; done; cd ~/offgrid/console/deploy && docker compose --profile data --profile identity up -d postgres keycloak >/dev/null 2>&1 && echo up" >/dev/null && ok "Postgres + Keycloak up" || warn "compose up issue"
  if ssh_to "$S1" "/usr/local/bin/caddy validate --adapter caddyfile --config ~/offgrid/console/deploy/Caddyfile" >/dev/null 2>&1; then
    ssh_to "$S1" "sudo launchctl kickstart -k system/co.getoffgridai.edge" 2>/dev/null && ok "edge reloaded (config valid)"
  else
    bad "Caddyfile INVALID — edge NOT reloaded (kept last-good config)"
  fi
  ssh_to "$S1" "launchctl kickstart -k gui/\$(id -u)/co.getoffgridai.console" 2>/dev/null && ok "S1 console restarted"

  hd "S2 — console"
  ssh_to "$S2" "launchctl kickstart -k gui/\$(id -u)/co.getoffgridai.console" 2>/dev/null && ok "S2 console restarted"

  hd "Gateways — inference"
  for n in "${GATEWAYS[@]}"; do
    [ -z "${IP[$n]}" ] && { warn "$n unreachable, skipped"; continue; }
    ssh_to "$n" "launchctl kickstart -k gui/\$(id -u)/co.getoffgridai.gateway" 2>/dev/null && ok "$n gateway restarted"
  done
  hd "Waiting 25s for services + model load"; sleep 25
fi

# ── 4. health report ──────────────────────────────────────────────────────────
hd "HEALTH REPORT"
echo "One URL: http://${SERVER_IP}   (users: *@wednesday.is / OffGrid-2026)"
[ "$(code http://${SERVER_IP}:8080/realms/offgrid/.well-known/openid-configuration)" = 200 ] && ok "Keycloak realm reachable" || bad "Keycloak realm DOWN"
tok=$(curl -s --max-time 8 "http://${SERVER_IP}:8080/realms/offgrid/protocol/openid-connect/token" -d grant_type=password -d client_id=offgrid-console -d client_secret=offgrid-dev-keycloak-secret -d username=mac@wednesday.is -d password=OffGrid-2026 -d scope=openid 2>/dev/null | grep -c access_token)
[ "$tok" = 1 ] && ok "Keycloak login (mac@) works" || bad "Keycloak login FAILS"
[ "$(code http://${SERVER_IP}/signin)" = 200 ] && ok "Console (edge :80) up" || bad "Console edge DOWN"
for n in "${CONSOLES[@]}"; do
  [ "$(ssh_to "$n" "/usr/bin/curl -s -o /dev/null -w %{http_code} http://127.0.0.1:3000/signin" 2>/dev/null)" = 200 ] && ok "$n console serving" || bad "$n console DOWN"
done
[ "$(code http://${SERVER_IP}:8800/health)" = 200 ] && ok "Gateway LB (:8800) healthy" || bad "Gateway LB DOWN"
up=0; for n in "${GATEWAYS[@]}"; do
  [ -z "${IP[$n]}" ] && continue
  if [ "$(code http://${IP[$n]}:7878/health 5)" = 200 ]; then up=$((up+1)); ok "$n inference up"; else warn "$n inference not ready"; fi
done
echo "  gateways healthy: $up/${#GATEWAYS[@]}"
# end-to-end chat through the pool
reply=$(curl -s --max-time 60 "http://${SERVER_IP}:8800/v1/chat/completions" -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"reply: ok"}],"max_tokens":20}' 2>/dev/null | python3 -c 'import sys,json;print((json.load(sys.stdin)["choices"][0]["message"].get("content") or "").strip()[:30])' 2>/dev/null)
[ -n "$reply" ] && ok "End-to-end inference: \"$reply\"" || bad "End-to-end inference returned nothing"
printf "\n${b}Recovery complete.${x} Open ${g}http://${SERVER_IP}${x} in a FRESH/incognito window (stale cookies break login after restarts).\n"
