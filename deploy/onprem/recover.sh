#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Off Grid on-prem fleet — RECOVERY / HEALTH script. Run from the COORDINATOR Mac.
#
# Brings the 5-node fleet back to known-good:
#   • finds each node's CURRENT IP by its stable mDNS name (survives network changes)
#   • regenerates IP-based config (edge Caddyfile, /etc/hosts, console .env)
#   • restarts/repairs every service (Postgres, Keycloak, edge, 2 consoles, 3 gateways)
#   • validates the Caddyfile BEFORE reloading the edge (never leaves it down)
#   • prints a PASS/FAIL health report incl. end-to-end inference
#
# Idempotent. bash 3.2-safe (no associative arrays).
#   ./recover.sh          full recover + health report
#   ./recover.sh health   health report only (no restarts)
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

USER="${OFFGRID_SSH_USER:-admin}"
SSH="ssh -o ConnectTimeout=8 -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
ORB='/Applications/OrbStack.app/Contents/MacOS/bin:/Applications/OrbStack.app/Contents/MacOS/xbin:/usr/local/bin'

# stable mDNS names
S1=offgrid-s1; S2=offgrid-s2; G1=offgrid-g1; G2=offgrid-g2; G3=offgrid-g3

g=$'\033[32m'; r=$'\033[31m'; y=$'\033[33m'; b=$'\033[1m'; x=$'\033[0m'
ok(){   printf "  ${g}OK${x}  %s\n" "$*"; }
bad(){  printf "  ${r}XX${x}  %s\n" "$*"; }
warn(){ printf "  ${y}!!${x}  %s\n" "$*"; }
hd(){   printf "\n${b}== %s ==${x}\n" "$*"; }

rsh(){ local n=$1; shift; $SSH "${USER}@${n}.local" "$@"; }
ip_of(){ ping -c1 -t2 "$1.local" 2>/dev/null | sed -n 's/.*(\([0-9.]*\)).*/\1/p' | head -1; }
code(){ curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-8}" "$1" 2>/dev/null; }

MODE="${1:-recover}"

hd "Discover nodes (mDNS name -> current IP)"
IP_S1=$(ip_of $S1); IP_S2=$(ip_of $S2); IP_G1=$(ip_of $G1); IP_G2=$(ip_of $G2); IP_G3=$(ip_of $G3)
for pair in "$S1 $IP_S1" "$S2 $IP_S2" "$G1 $IP_G1" "$G2 $IP_G2" "$G3 $IP_G3"; do
  set -- $pair; n=$1; nip=${2:-}
  if [ -n "$nip" ] && rsh "$n" true 2>/dev/null; then ok "$n -> $nip"; else bad "$n unreachable (mDNS=${nip:-none})"; fi
done
[ -z "$IP_S1" ] && { bad "S1 unreachable — cannot recover"; exit 1; }

if [ "$MODE" = "recover" ]; then
  hd "Regenerate edge config + hosts + console .env for current IPs"
  rsh "$S1" "cat > ~/offgrid/console/deploy/Caddyfile" <<EOF
{
	auto_https off
	admin off
}
http://onprem-console.getoffgridai.co, http://${IP_S1} {
	# Single console (S1) = reliable auth. Active-active HA across S1+S2 breaks the
	# NextAuth flow (S2's auth-flow fetch is flaky + cross-instance cookie issues);
	# S2 stays a warm standby. To re-enable HA later add "${IP_S2}:3000" + lb_policy.
	reverse_proxy ${IP_S1}:3000
}
:8800 {
	reverse_proxy ${IP_G1}:7878 ${IP_G2}:7878 ${IP_G3}:7878 {
		lb_policy round_robin
		health_uri /health
		health_interval 10s
		health_timeout 3s
	}
}
http://local.getoffgridai.co {
	reverse_proxy ${IP_S1}:3100
}
EOF
  for pair in "$S1 $IP_S1" "$S2 $IP_S2" "$G1 $IP_G1" "$G2 $IP_G2" "$G3 $IP_G3"; do
    set -- $pair; n=$1; nip=${2:-}; [ -z "$nip" ] && continue
    rsh "$n" "sudo sed -i '' '/getoffgridai.co/d' /etc/hosts 2>/dev/null; echo '${IP_S1} onprem-console.getoffgridai.co local.getoffgridai.co' | sudo tee -a /etc/hosts >/dev/null"
  done
  ok "/etc/hosts -> $IP_S1 on all nodes"
  rsh "$S1" "cd ~/offgrid/console; sed -i '' '/^OFFGRID_GATEWAY_URL=/d;/^AUTH_URL=/d' .env; printf 'OFFGRID_GATEWAY_URL=http://${IP_S1}:8800\nAUTH_URL=http://${IP_S1}\n' >> .env"
  rsh "$S2" "cd ~/offgrid/console; sed -i '' '/^OFFGRID_GATEWAY_URL=/d;/^AUTH_URL=/d;/^DATABASE_URL=/d' .env; printf 'DATABASE_URL=postgresql://offgrid:offgrid@${IP_S1}:5432/offgrid_console\nOFFGRID_GATEWAY_URL=http://${IP_S1}:8800\nAUTH_URL=http://${IP_S1}\n' >> .env"
  ok "console .env re-pointed at $IP_S1"

  hd "S1 — OrbStack + Postgres + Keycloak + edge + console"
  rsh "$S1" "export PATH=$ORB:\$PATH; orb start >/dev/null 2>&1; for i in \$(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 2; done; cd ~/offgrid/console/deploy && docker compose --profile data --profile identity up -d postgres keycloak >/dev/null 2>&1" && ok "Postgres + Keycloak up" || warn "compose issue"
  if rsh "$S1" "/usr/local/bin/caddy validate --adapter caddyfile --config ~/offgrid/console/deploy/Caddyfile" >/dev/null 2>&1; then
    rsh "$S1" "sudo launchctl kickstart -k system/co.getoffgridai.edge" 2>/dev/null && ok "edge reloaded (config valid)"
  else bad "Caddyfile INVALID — edge NOT reloaded (kept last-good)"; fi
  rsh "$S1" "launchctl kickstart -k gui/\$(id -u)/co.getoffgridai.console" 2>/dev/null && ok "S1 console restarted"
  rsh "$S2" "launchctl kickstart -k gui/\$(id -u)/co.getoffgridai.console" 2>/dev/null && ok "S2 console restarted"
  hd "Gateways"
  for n in $G1 $G2 $G3; do
    rsh "$n" "launchctl kickstart -k gui/\$(id -u)/co.getoffgridai.gateway" 2>/dev/null && ok "$n gateway restarted" || warn "$n skipped"
  done
  hd "Waiting 25s for services + model load"; sleep 25
fi

hd "HEALTH REPORT"
echo "  One URL: http://${IP_S1}   (users: *@wednesday.is / OffGrid-2026 — use a FRESH window)"
[ "$(code http://${IP_S1}:8080/realms/offgrid/.well-known/openid-configuration)" = 200 ] && ok "Keycloak realm reachable" || bad "Keycloak realm DOWN"
tok=$(curl -s --max-time 8 "http://${IP_S1}:8080/realms/offgrid/protocol/openid-connect/token" -d grant_type=password -d client_id=offgrid-console -d client_secret=offgrid-dev-keycloak-secret -d username=mac@wednesday.is -d password=OffGrid-2026 -d scope=openid 2>/dev/null | grep -c access_token)
[ "$tok" = 1 ] && ok "Keycloak login (mac@) works" || bad "Keycloak login FAILS"
[ "$(code http://${IP_S1}/signin)" = 200 ] && ok "Console edge (:80) up" || bad "Console edge DOWN"
[ "$(rsh "$S1" "/usr/bin/curl -s -o /dev/null -w %{http_code} http://127.0.0.1:3000/signin" 2>/dev/null)" = 200 ] && ok "S1 console serving" || bad "S1 console DOWN"
[ "$(rsh "$S2" "/usr/bin/curl -s -o /dev/null -w %{http_code} http://127.0.0.1:3000/signin" 2>/dev/null)" = 200 ] && ok "S2 console serving" || bad "S2 console DOWN"
[ "$(code http://${IP_S1}:8800/health)" = 200 ] && ok "Gateway LB (:8800) healthy" || bad "Gateway LB DOWN"
up=0
for pair in "$G1 $IP_G1" "$G2 $IP_G2" "$G3 $IP_G3"; do
  set -- $pair; n=$1; nip=${2:-}; [ -z "$nip" ] && continue
  if [ "$(code http://${nip}:7878/health 5)" = 200 ]; then up=$((up+1)); ok "$n inference up"; else warn "$n inference not ready"; fi
done
echo "  gateways healthy: $up/3"
reply=$(curl -s --max-time 60 "http://${IP_S1}:8800/v1/chat/completions" -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"reply: ok"}],"max_tokens":20}' 2>/dev/null | python3 -c 'import sys,json;print((json.load(sys.stdin)["choices"][0]["message"].get("content") or "").strip()[:30])' 2>/dev/null)
[ -n "$reply" ] && ok "End-to-end inference: \"$reply\"" || bad "End-to-end inference returned nothing"
printf "\n${b}Done.${x} Open ${g}http://${IP_S1}${x} in a FRESH/incognito window.\n"
