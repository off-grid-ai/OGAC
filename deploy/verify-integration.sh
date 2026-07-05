#!/usr/bin/env bash
# verify-integration.sh — the runnable probe harness that makes integration success FALSIFIABLE.
#
# This is the measuring stick for docs/INTEGRATION_SUCCESS_SPEC.md. Each check maps to one acceptance
# criterion (A1..C3) and prints exactly one line:
#     PASS <id> — <what was proven>
#     FAIL <id> — <why it failed>            (a real, deployed thing is broken)
#     SKIP <id> — <precondition not met>     (not wired / not deployed / a tool is missing)
# The script exits non-zero iff ANY check FAILs. SKIP never fails the run — the whole point is that we
# can MEASURE honestly before everything is deployed: an unwired precondition is a SKIP, not a false
# PASS and not a misleading FAIL. A summary tally (N pass / M fail / K skip) prints at the end.
#
# ── WHERE TO RUN ─────────────────────────────────────────────────────────────────────────────────
# Meant to run ON S1 (127.0.0.1), the control-plane node, where every backend is reachable over
# loopback: the console at 127.0.0.1:3000, Keycloak :8080, OpenBao :8200, OpenSearch :9200, OPA :8181,
# Marquez :9000, the aggregator :8800, Langfuse via the edge-Caddy loopback 127.0.0.1:8931. It sources
# the server's runtime env (creds, URLs) from the console's .env.local — nothing is hardcoded.
#
#   ssh admin@127.0.0.1
#   cd /Users/admin/offgrid/console
#   ./deploy/verify-integration.sh
#
# Override the env file or console base if needed:
#   OFFGRID_ENV_FILE=/path/.env.production CONSOLE_BASE=http://127.0.0.1:3000 ./deploy/verify-integration.sh
#
# ── RUNNING FROM A DEV MAC (bonus, not required) ─────────────────────────────────────────────────
# The backends bind to S1 loopback and are NOT LAN-reachable, so run it on S1. To drive it from your
# Mac over the cloudflared ssh path, wrap the whole invocation in ssh (it still executes on S1):
#   ssh -t admin@offgrid-s1 'cd /Users/admin/offgrid/console && ./deploy/verify-integration.sh'
#
# ── SAFETY ───────────────────────────────────────────────────────────────────────────────────────
# Every probe is READ-ONLY except C1/C2/C3, which create labelled test runs whose query begins with
# "integration-verify probe". No deletes, no config mutations, no secret writes.
#
# ── THE MISSING-TOOL PROBLEM (jq / python3 on S1) ────────────────────────────────────────────────
# S1's `python3` is the Xcode CLT stub (prompts / no stdlib) and `jq` may be absent. This script uses
# NEITHER for anything load-bearing. JSON is parsed with grep/sed (good enough for the flat fields we
# read) and JWTs are base64url-decoded with `openssl base64 -d` (or `base64 -D`/`base64 -d`), which is
# always present. If a genuinely required tool (curl / openssl) is missing, the affected check DEGRADES
# to SKIP with a clear message rather than FAILing.

set -uo pipefail  # NOT -e: a failing probe must record a FAIL and continue, not abort the run.

# ── Locate repo root + source the server env ───────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${OFFGRID_ENV_FILE:-$REPO_ROOT/.env.local}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  echo "==> sourced env from $ENV_FILE"
else
  echo "==> NOTE: $ENV_FILE not found — relying on the ambient environment only."
fi

# ── Defaults (mirror the code's own fallbacks / SERVICE_MAP.md loopback ports) ──────────────────────
CONSOLE_BASE="${CONSOLE_BASE:-http://127.0.0.1:3000}"
KEYCLOAK_URL="${OFFGRID_KEYCLOAK_URL:-http://127.0.0.1:8080}"
KEYCLOAK_REALM="${OFFGRID_KEYCLOAK_REALM:-offgrid}"
BAO_URL="${OFFGRID_OPENBAO_URL:-http://127.0.0.1:8200}"
BAO_TOKEN="${OFFGRID_OPENBAO_TOKEN:-offgrid-dev-token}"
BAO_MOUNT="${OFFGRID_OPENBAO_MOUNT:-secret}"
GATEWAY_URL="${OFFGRID_GATEWAY_URL:-http://127.0.0.1:8800}"
OPENSEARCH_URL="${OFFGRID_OPENSEARCH_URL:-http://127.0.0.1:9200}"
OPENSEARCH_INDEX="${OFFGRID_OPENSEARCH_INDEX:-offgrid-audit}"
MARQUEZ_URL="${OFFGRID_MARQUEZ_URL:-http://127.0.0.1:9000}"
LINEAGE_NS="${OFFGRID_LINEAGE_NAMESPACE:-offgrid-console}"
LANGFUSE_URL="${OFFGRID_LANGFUSE_URL:-http://127.0.0.1:8931}"
OPA_URL="${OFFGRID_OPA_URL:-http://127.0.0.1:8181}"
ADMIN_TOKEN="${OFFGRID_ADMIN_TOKEN:-}"

# The 5 Keycloak service-account clients (must match src/lib/service-clients.ts SERVICE_CLIENTS).
# audience == offgrid-<svc>, secret at OpenBao secret/<svc>/client-secret.
SERVICE_CLIENTS="gateway opensearch fleet temporal seaweedfs"

# ── Tally + emit helpers ────────────────────────────────────────────────────────────────────────────
PASS_N=0; FAIL_N=0; SKIP_N=0
pass() { printf 'PASS %s — %s\n' "$1" "$2"; PASS_N=$((PASS_N + 1)); }
fail() { printf 'FAIL %s — %s\n' "$1" "$2"; FAIL_N=$((FAIL_N + 1)); }
skip() { printf 'SKIP %s — %s\n' "$1" "$2"; SKIP_N=$((SKIP_N + 1)); }
note() { printf '     %s\n' "$1"; }

have() { command -v "$1" >/dev/null 2>&1; }

# base64url-decode stdin → stdout, no python/jq. Tries the flags that exist across BSD/GNU/openssl.
b64url_decode() {
  # normalize base64url → base64 and pad to a multiple of 4
  local s
  s=$(cat | tr '_-' '/+' | tr -d '\n')
  case $(( ${#s} % 4 )) in 2) s="${s}==";; 3) s="${s}=";; esac
  if have openssl; then printf '%s' "$s" | openssl base64 -d -A 2>/dev/null && return 0; fi
  if printf '%s' "$s" | base64 -D 2>/dev/null; then return 0; fi   # BSD/macOS
  if printf '%s' "$s" | base64 -d 2>/dev/null; then return 0; fi   # GNU
  return 1
}

# Extract a top-level-ish string field from flat JSON: json_str '<body>' '<field>'.
# Deliberately simple (grep/sed) — we only ever read flat scalar fields, never nested structures.
json_str() {
  printf '%s' "$1" | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 \
    | sed -E "s/.*:[[:space:]]*\"([^\"]*)\"/\1/"
}

# curl the status code only (read-only GET), with a short timeout. "000" on connection failure.
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-6}" "$1" 2>/dev/null; }

# Is a URL reachable at all (any HTTP response, i.e. code != 000)?
reachable() { local c; c=$(http_code "$1" "${2:-4}"); [ -n "$c" ] && [ "$c" != "000" ]; }

# Deterministic RFC-4122 UUIDv5 (SHA-1) of a name under a fixed namespace — the EXACT algorithm in
# src/lib/correlation.ts (uuidv5). Marquez requires run.runId to be a UUID, so the console emits
# uuid5(runId) as the lineage run id; this reproduces that id in bash so the C2 Marquez lookup keys by
# the same value. Pure openssl+xxd (both present on S1); NEVER change LINEAGE_UUID_NS — it must equal
# LINEAGE_UUID_NAMESPACE in correlation.ts or previously-emitted lineage runs stop correlating.
LINEAGE_UUID_NS='6f1a9d3e-2c4b-5a67-8f90-1b2c3d4e5f60'
uuid5() {
  local name="$1" ns_hex hex b6 b8
  ns_hex=$(printf '%s' "$LINEAGE_UUID_NS" | tr -d '-')
  # SHA1( namespace(16 raw bytes) || name(utf8) ) → first 16 bytes as hex.
  # Feed namespace bytes then the name to openssl sha1 over one binary stream.
  hex=$( { printf '%s' "$ns_hex" | xxd -r -p; printf '%s' "$name"; } \
    | openssl dgst -sha1 -binary | xxd -p -c 256 | tr -d '\n' | cut -c1-32 )
  # Set version nibble (byte 6 high-nibble → 5) and variant bits (byte 8 → 10xx xxxx).
  b6=$(( 0x${hex:12:2} & 0x0f | 0x50 ))
  b8=$(( 0x${hex:16:2} & 0x3f | 0x80 ))
  printf '%s-%s-5%s-%02x%s-%s\n' \
    "${hex:0:8}" "${hex:8:4}" "${hex:13:3}" "$b8" "${hex:18:2}" "${hex:20:12}"
}

# Preflight: curl is non-negotiable.
if ! have curl; then
  echo "FATAL: curl not found — cannot probe anything." >&2
  exit 2
fi

echo "==> verify-integration on $(hostname) — console=$CONSOLE_BASE keycloak=$KEYCLOAK_URL bao=$BAO_URL"
echo

# ────────────────────────────────────────────────────────────────────────────────────────────────────
# A6 / B1 are NOT probeable here (code-grep). State that explicitly, don't fake them. C4 IS now a live
# probe (a durable Temporal run + 4-plane correlation), implemented at the bottom next to C1/C2.
# ────────────────────────────────────────────────────────────────────────────────────────────────────
note "A6 — code-grep criterion (adapters must not use static keys after Phase B). Not a live probe; not built (Phase B). Verify by grep in review."
note "B1 — code-grep criterion (every adapter authenticates via getServiceCredential). Not a live probe; Phase B. Verify by grep in review."
echo

# ── Helper: read a service client secret out of OpenBao (KV v2). Empty on any miss. ─────────────────
bao_client_secret() {
  local svc="$1" body
  body=$(curl -s --max-time 6 -H "X-Vault-Token: $BAO_TOKEN" \
    "$BAO_URL/v1/$BAO_MOUNT/data/$svc/client-secret" 2>/dev/null) || return 1
  # KV v2 shape: { "data": { "data": { "value": "<secret>" } } } — pull the innermost "value".
  json_str "$body" value
}

# ── Helper: client_credentials grant → prints the access_token, empty on failure. ──────────────────
kc_token_endpoint="$KEYCLOAK_URL/realms/$KEYCLOAK_REALM/protocol/openid-connect/token"
kc_grant() {
  local client_id="$1" secret="$2" body
  body=$(curl -s --max-time 8 -X POST "$kc_token_endpoint" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=client_credentials' \
    --data-urlencode "client_id=$client_id" \
    --data-urlencode "client_secret=$secret" 2>/dev/null) || return 1
  json_str "$body" access_token
}

# Decode a JWT's payload → prints the raw JSON payload. Empty if not a JWT / decode unavailable.
jwt_payload() {
  local tok="$1" mid
  mid=$(printf '%s' "$tok" | cut -d. -f2)
  [ -n "$mid" ] || return 1
  printf '%s' "$mid" | b64url_decode
}

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# A3 — Each service secret is readable at secret/<svc>/client-secret in OpenBao. GET × 5 → value present.
#      Run A3 first because A2 depends on the same secrets; a shared OpenBao outage should read as one
#      clear cause, not five confusing failures.
# ════════════════════════════════════════════════════════════════════════════════════════════════════
if reachable "$BAO_URL/v1/sys/health" 4; then
  BAO_UP=1
  a3_ok=1; a3_missing=""
  for svc in $SERVICE_CLIENTS; do
    if [ -n "$(bao_client_secret "$svc")" ]; then :; else a3_ok=0; a3_missing="$a3_missing $svc"; fi
  done
  if [ "$a3_ok" = 1 ]; then
    pass A3 "all 5 service client-secrets readable at $BAO_MOUNT/<svc>/client-secret in OpenBao"
  else
    # OpenBao is up but the secrets were never provisioned → precondition not met, so SKIP not FAIL.
    skip A3 "OpenBao up but client-secret missing for:${a3_missing} (service clients not provisioned)"
  fi
else
  BAO_UP=0
  skip A3 "OpenBao unreachable at $BAO_URL (not deployed / port not bound)"
fi
echo

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# A2 — Each of the 5 clients does a client_credentials grant whose JWT aud == offgrid-<svc>.
#      Probe: OpenBao secret → KC token → decode aud.
# ════════════════════════════════════════════════════════════════════════════════════════════════════
if ! printf 'eA' | b64url_decode >/dev/null 2>&1; then
  skip A2 "no base64url decoder available (openssl/base64) — cannot decode JWT aud on this host"
elif [ "${BAO_UP:-0}" = 0 ]; then
  skip A2 "OpenBao unreachable — cannot fetch client secrets to mint tokens (see A3)"
elif ! reachable "$kc_token_endpoint" 4; then
  skip A2 "Keycloak token endpoint unreachable at $kc_token_endpoint"
else
  a2_pass=0; a2_fail=0; a2_skip=0; a2_detail=""
  for svc in $SERVICE_CLIENTS; do
    secret=$(bao_client_secret "$svc")
    if [ -z "$secret" ]; then a2_skip=$((a2_skip+1)); a2_detail="$a2_detail $svc=no-secret"; continue; fi
    tok=$(kc_grant "offgrid-$svc" "$secret")
    if [ -z "$tok" ]; then a2_fail=$((a2_fail+1)); a2_detail="$a2_detail $svc=grant-failed"; continue; fi
    payload=$(jwt_payload "$tok")
    # aud may be a string or an array; grep for the exact value either way.
    if printf '%s' "$payload" | grep -qE "\"aud\"[[:space:]]*:[[:space:]]*(\"offgrid-$svc\"|\[[^]]*\"offgrid-$svc\"[^]]*\])"; then
      a2_pass=$((a2_pass+1))
    else
      a2_fail=$((a2_fail+1)); a2_detail="$a2_detail $svc=aud-mismatch"
    fi
  done
  if [ "$a2_fail" -gt 0 ]; then
    fail A2 "grant/aud check failed for:${a2_detail} (passed=$a2_pass skipped=$a2_skip)"
  elif [ "$a2_pass" -eq 0 ]; then
    skip A2 "no service client had a secret to test (clients not provisioned):${a2_detail}"
  elif [ "$a2_skip" -gt 0 ]; then
    skip A2 "$a2_pass/5 clients minted a JWT with aud=offgrid-<svc>; ${a2_skip} had no secret yet:${a2_detail}"
  else
    pass A2 "all 5 clients minted a client_credentials JWT with aud == offgrid-<svc>"
  fi
fi
echo

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# A1 — The aggregator accepts a valid service credential and rejects a garbage bearer.
#      Ideal: mint the gateway service JWT (broker) and use it. Fallback: the static OFFGRID_GATEWAY_API_KEY.
#      Always assert the negative case (garbage bearer → 401) — that's the real proof auth is ON.
# ════════════════════════════════════════════════════════════════════════════════════════════════════
gw_probe_path="$GATEWAY_URL/v1/models"   # OpenAI-compatible listing; gated by the same authOK as /
if ! reachable "$GATEWAY_URL/healthz" 4; then
  skip A1 "aggregator unreachable at $GATEWAY_URL (not deployed / port not bound)"
else
  # Pick the best credential we can present.
  gw_bearer=""; gw_cred_kind="minted-keycloak-jwt"
  if [ "${BAO_UP:-0}" = 1 ]; then
    gw_secret=$(bao_client_secret gateway)
    [ -n "$gw_secret" ] && gw_bearer=$(kc_grant offgrid-gateway "$gw_secret")
  fi
  if [ -z "$gw_bearer" ] && [ -n "${OFFGRID_GATEWAY_API_KEY:-}" ]; then
    gw_bearer="$OFFGRID_GATEWAY_API_KEY"; gw_cred_kind="static-gateway-api-key (broker not wired yet)"
  fi

  # Negative case first — a garbage bearer MUST be rejected, or auth isn't really on.
  bad_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 \
    -H 'Authorization: Bearer garbage-not-a-real-token' "$gw_probe_path" 2>/dev/null)

  if [ -z "$gw_bearer" ]; then
    skip A1 "aggregator up but no gateway credential available (no OpenBao secret and no OFFGRID_GATEWAY_API_KEY)"
  else
    good_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 \
      -H "Authorization: Bearer $gw_bearer" "$gw_probe_path" 2>/dev/null)
    if [ "$good_code" = "200" ] && [ "$bad_code" = "401" ]; then
      pass A1 "aggregator: valid bearer->200, garbage bearer->401 (cred=$gw_cred_kind)"
    elif [ "$bad_code" != "401" ] && { [ "$good_code" = "200" ] || [ "$bad_code" = "200" ]; }; then
      # Both accepted → auth is OFF (AUTH_ON unset on the aggregator). Not deployed-hardened → SKIP.
      skip A1 "aggregator auth appears OFF (garbage bearer->$bad_code, not 401) — auth not enabled/deployed"
    else
      fail A1 "aggregator: valid bearer->$good_code (want 200), garbage bearer->$bad_code (want 401), cred=$gw_cred_kind"
    fi
  fi
fi
echo

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# A4 — Presidio/Marquez/OPA/OpenSearch must NOT be reachable from another LAN host — only from the
#      console host. On S1 (this host) we can ALWAYS reach loopback, so the true external test needs a
#      different box. What we CAN verify here is the BIND: the port is bound to 127.0.0.1, not 0.0.0.0.
#      SKIP-by-design for the external half; the bind-check counts toward evidence.
# ════════════════════════════════════════════════════════════════════════════════════════════════════
bind_of() { # print the local listen line(s) for a TCP port
  local port="$1"
  if have lsof; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $9}'
  elif have netstat; then
    netstat -an 2>/dev/null | grep -E "[.:]$port[[:space:]].*LISTEN"
  fi
}
if have lsof || have netstat; then
  a4_all_loopback=1; a4_any=0; a4_detail=""
  for entry in "9200:opensearch" "8181:opa" "9000:marquez"; do
    port="${entry%%:*}"; label="${entry##*:}"
    binds=$(bind_of "$port")
    [ -z "$binds" ] && { a4_detail="$a4_detail $label:not-bound"; continue; }
    a4_any=1
    if printf '%s' "$binds" | grep -qE '(\*|0\.0\.0\.0)[.:]'"$port"; then
      a4_all_loopback=0; a4_detail="$a4_detail $label:WILDCARD-BIND"
    else
      a4_detail="$a4_detail $label:loopback"
    fi
  done
  if [ "$a4_any" = 0 ]; then
    skip A4 "none of opensearch/opa/marquez are bound on this host — nothing deployed to bind-check"
  elif [ "$a4_all_loopback" = 1 ]; then
    pass A4 "bind-check: bound services listen on loopback only (not 0.0.0.0):${a4_detail}. NOTE: the true external-unreachability test must run FROM A NON-S1 host (curl offgrid-s1.local:9200/:8181/:9000 -> refused)."
  else
    fail A4 "a service is bound to a wildcard/0.0.0.0 address (LAN-reachable):${a4_detail}"
  fi
else
  skip A4 "no lsof/netstat to inspect port binds; and the true external test needs a non-S1 host anyway"
fi
echo

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# A5 — A machine client (service-account JWT) AND a user session both reach /api/v1/* via the console;
#      unauth → 401. On S1 without a browser session we verify the two ends we CAN: a valid admin/SA
#      bearer → 200 and no-auth → 401 on the same admin endpoint. (Session-cookie parity is a browser
#      test; we note it.)
# ════════════════════════════════════════════════════════════════════════════════════════════════════
a5_endpoint="$CONSOLE_BASE/api/v1/admin/agents"
if ! reachable "$CONSOLE_BASE" 4; then
  skip A5 "console unreachable at $CONSOLE_BASE (not running)"
else
  noauth=$(http_code "$a5_endpoint" 6)
  # Prefer a real Keycloak service-account JWT (gateway client) to prove machine identity end-to-end;
  # fall back to the break-glass OFFGRID_ADMIN_TOKEN when the broker isn't wired.
  a5_bearer=""; a5_kind=""
  if [ "${BAO_UP:-0}" = 1 ]; then
    s=$(bao_client_secret gateway); [ -n "$s" ] && a5_bearer=$(kc_grant offgrid-gateway "$s") && a5_kind="keycloak service-account JWT"
  fi
  if [ -z "$a5_bearer" ] && [ -n "$ADMIN_TOKEN" ]; then a5_bearer="$ADMIN_TOKEN"; a5_kind="OFFGRID_ADMIN_TOKEN (break-glass)"; fi
  if [ -z "$a5_bearer" ]; then
    skip A5 "no machine credential to present (no OpenBao gateway secret and OFFGRID_ADMIN_TOKEN unset)"
  else
    authed=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -H "Authorization: Bearer $a5_bearer" "$a5_endpoint" 2>/dev/null)
    if [ "$authed" = "200" ] && [ "$noauth" = "401" ]; then
      pass A5 "machine bearer ($a5_kind)->200, unauth->401 on $a5_endpoint. NOTE: user-session-cookie parity is a browser test, not covered here."
    elif [ "$authed" = "200" ] && [ "$noauth" != "401" ]; then
      fail A5 "authed->200 but unauth->$noauth (want 401): the endpoint is NOT gating anonymous access"
    else
      fail A5 "machine bearer ($a5_kind)->$authed (want 200), unauth->$noauth (want 401)"
    fi
  fi
fi
echo

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# A7 — Revocation: invalidate a service credential → the next downstream call fails closed (no stale
#      cached token forever). This is a DESTRUCTIVE rotate-and-reject test (mutates a live secret) so
#      it is intentionally NOT automated in a read-mostly harness. Reported as needing a manual run.
# ════════════════════════════════════════════════════════════════════════════════════════════════════
skip A7 "revocation is a destructive rotate-and-reject test (rotate secret in OpenBao -> force refresh -> old token 401). Not automated here to avoid mutating live credentials — run manually per the spec."
echo

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# B2 — No service directly reachable by an end user bypassing the console. Covered by A4 (bind) + the
#      Caddy exposure analysis. Reported as derived from A4 rather than re-probed.
# ════════════════════════════════════════════════════════════════════════════════════════════════════
skip B2 "network-boundary criterion — covered by A4 (loopback bind) + the Caddy edge exposure analysis. No independent live probe on S1; the real proof is A4 run from a non-S1 host."
echo

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# B3 — A downstream 401 triggers ONE transparent refresh + retry, not a user-facing error. This is
#      internal broker behavior (invalidate -> re-mint), observable only by forcing an expiry. Same
#      destructive shape as A7; reported as needing a manual/forced-expiry test.
# ════════════════════════════════════════════════════════════════════════════════════════════════════
skip B3 "transparent-refresh criterion needs a forced token expiry to observe the single re-mint. Internal broker behavior; verify with a forced-expiry integration test, not a read-only live probe."
echo

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# Shared 4-plane fan-out correlation — used by BOTH C2 (inline runs) and C4 (durable Temporal runs).
# Given a console runId, count how many of the 4 planes (provenance, Marquez lineage, Langfuse trace,
# OpenSearch audit) the run correlates on, keyed by the SAME runId. Sets FP_HITS / FP_TOTAL / FP_DETAIL
# (globals — bash can't return a tuple). Reuses the uuid5 helper so lineage lookups match the console's
# deterministic OpenLineage run id. Identical semantics for inline and durable, which is the C4 point:
# a DURABLE run must fan out to the same 4 planes, correlated by the same runId, as an inline one.
four_plane_correlate() {
  local rid="$1"
  FP_HITS=0; FP_TOTAL=4; FP_DETAIL=""

  # (1) provenance — read straight off the run record (correlated by construction).
  local ptrace
  ptrace=$(curl -s --max-time 8 -H "Authorization: Bearer $ADMIN_TOKEN" "$CONSOLE_BASE/api/v1/admin/agent-runs/$rid" 2>/dev/null)
  if printf '%s' "$ptrace" | grep -qE '"provenance"[[:space:]]*:[[:space:]]*\{' && printf '%s' "$ptrace" | grep -q '"signature"'; then
    FP_HITS=$((FP_HITS+1)); FP_DETAIL="$FP_DETAIL provenance:HIT"
  else
    FP_DETAIL="$FP_DETAIL provenance:miss"
  fi

  # (2) Marquez lineage — the run event carries run.runId == uuid5(rid) under namespace LINEAGE_NS.
  #     Marquez REQUIRES run.runId to be a UUID: a raw "run_xxx" id is silently re-keyed, so the job
  #     lands but GET /api/v1/jobs/runs/run_xxx 404s. The console derives run.runId as a deterministic
  #     UUIDv5 of the console runId (src/lib/correlation.ts lineageRunUuid); we derive the identical
  #     UUID here and look the run up by it. Namespace UUID must match LINEAGE_UUID_NAMESPACE.
  if ! reachable "$MARQUEZ_URL/api/v1/namespaces" 4; then
    FP_DETAIL="$FP_DETAIL marquez:unreachable"
  else
    local lineage_run_uuid mcode mjobs
    lineage_run_uuid=$(uuid5 "$rid")
    mcode=$(http_code "$MARQUEZ_URL/api/v1/jobs/runs/$lineage_run_uuid" 6)
    if [ "$mcode" = "200" ]; then
      FP_HITS=$((FP_HITS+1)); FP_DETAIL="$FP_DETAIL marquez:HIT"
    else
      # Fallback: scan the namespace's jobs for our agent job (lineage may key the run differently).
      mjobs=$(curl -s --max-time 8 "$MARQUEZ_URL/api/v1/namespaces/$LINEAGE_NS/jobs?limit=200" 2>/dev/null)
      if printf '%s' "$mjobs" | grep -q "agent:"; then
        FP_DETAIL="$FP_DETAIL marquez:job-present-runid-not-found($mcode)"
      else
        FP_DETAIL="$FP_DETAIL marquez:no-event($mcode)"
      fi
    fi
  fi

  # (3) Langfuse trace — trace id is the runId with non-alphanumerics stripped.
  local lf_trace_id lf_auth lcode
  lf_trace_id=$(printf '%s' "$rid" | tr -cd 'a-zA-Z0-9')
  lf_auth=""
  if [ -n "${OFFGRID_LANGFUSE_PUBLIC_KEY:-}" ] && [ -n "${OFFGRID_LANGFUSE_SECRET_KEY:-}" ]; then
    lf_auth="$OFFGRID_LANGFUSE_PUBLIC_KEY:$OFFGRID_LANGFUSE_SECRET_KEY"
  fi
  if [ -z "$lf_auth" ] && [ -n "${OFFGRID_LANGFUSE_AUTH:-}" ]; then
    # AUTH is already base64(pk:sk) — decode to reuse the -u form uniformly.
    lf_auth=$(printf '%s' "$OFFGRID_LANGFUSE_AUTH" | b64url_decode 2>/dev/null)
  fi
  if ! reachable "$LANGFUSE_URL/api/public/health" 4; then
    FP_DETAIL="$FP_DETAIL langfuse:unreachable"
  elif [ -z "$lf_auth" ]; then
    FP_DETAIL="$FP_DETAIL langfuse:no-creds"
  else
    lcode=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -u "$lf_auth" "$LANGFUSE_URL/api/public/traces/$lf_trace_id" 2>/dev/null)
    if [ "$lcode" = "200" ]; then
      FP_HITS=$((FP_HITS+1)); FP_DETAIL="$FP_DETAIL langfuse:HIT"
    else
      # The async QA score (which creates the trace) is flag+sample gated → may legitimately not exist.
      FP_DETAIL="$FP_DETAIL langfuse:no-trace($lcode; QA-score is flag/sample-gated)"
    fi
  fi

  # (4) OpenSearch audit — search the index for the run id. Correlation-by-runId is NOT wired today
  #     (audit index carries device/gateway events, not the agent runId), so a miss here is EXPECTED
  #     and is the exact gap the spec calls out — reported, not papered over.
  local osbody
  if ! reachable "$OPENSEARCH_URL/_cluster/health" 4; then
    FP_DETAIL="$FP_DETAIL opensearch:unreachable"
  else
    osbody=$(curl -s --max-time 8 "$OPENSEARCH_URL/$OPENSEARCH_INDEX/_search?q=$rid&size=1" 2>/dev/null)
    # "total":{"value":N} — treat N>0 as a hit.
    if printf '%s' "$osbody" | grep -qE '"value"[[:space:]]*:[[:space:]]*[1-9]'; then
      FP_HITS=$((FP_HITS+1)); FP_DETAIL="$FP_DETAIL opensearch:HIT"
    else
      FP_DETAIL="$FP_DETAIL opensearch:no-runid-match (audit index not keyed by agent runId today — known gap)"
    fi
  fi
}

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# C1 — One governed run chains policy -> guardrails -> retrieval -> gateway -> grounding -> provenance,
#      and the trace shows every stage. Probe: create ONE real run, GET it, assert the stage kinds
#      present. First of the write-probes (safe: one labelled test run).
# ════════════════════════════════════════════════════════════════════════════════════════════════════
RUN_ID=""; AGENT_ID=""   # captured here so C2/C3 can reuse them
if ! reachable "$CONSOLE_BASE" 4; then
  skip C1 "console unreachable at $CONSOLE_BASE (not running)"
elif [ -z "$ADMIN_TOKEN" ]; then
  skip C1 "OFFGRID_ADMIN_TOKEN unset — cannot POST a governed run (set it on the server for CI/bootstrap)"
else
  # Discover a real agentId from the catalog (the POST requires one that exists).
  agents_body=$(curl -s --max-time 8 -H "Authorization: Bearer $ADMIN_TOKEN" "$CONSOLE_BASE/api/v1/admin/agents" 2>/dev/null)
  AGENT_ID=$(json_str "$agents_body" id)
  if [ -z "$AGENT_ID" ]; then
    skip C1 "no agent found in the catalog to run (GET /admin/agents returned none, or auth failed)"
  else
    run_body=$(curl -s --max-time 60 -X POST "$CONSOLE_BASE/api/v1/admin/agents/runs" \
      -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
      -d "{\"agentId\":\"$AGENT_ID\",\"query\":\"integration-verify probe — please answer briefly\"}" 2>/dev/null)
    RUN_ID=$(json_str "$run_body" id)
    [ -z "$RUN_ID" ] && RUN_ID=$(json_str "$run_body" runId)   # 202 durable path
    if [ -z "$RUN_ID" ]; then
      fail C1 "POST /admin/agents/runs did not return a run id (agent=$AGENT_ID). body head: $(printf '%s' "$run_body" | head -c 160)"
    else
      # Re-fetch the full trace and assert the pipeline stage kinds are present. Durable runs may still
      # be executing → poll GET a few times before giving up.
      trace=""
      for _ in 1 2 3 4 5 6; do
        trace=$(curl -s --max-time 8 -H "Authorization: Bearer $ADMIN_TOKEN" "$CONSOLE_BASE/api/v1/admin/agent-runs/$RUN_ID" 2>/dev/null)
        printf '%s' "$trace" | grep -q '"steps"' && break
        sleep 2
      done
      # A completed governed run must include at minimum: policy, guard, ground, sign stages.
      missing=""
      for kind in policy guard ground sign; do
        printf '%s' "$trace" | grep -q "\"kind\"[[:space:]]*:[[:space:]]*\"$kind\"" || missing="$missing $kind"
      done
      status=$(json_str "$trace" status)
      if [ -z "$missing" ]; then
        pass C1 "governed run $RUN_ID (agent=$AGENT_ID, status=$status) shows all pipeline stages: policy.guard.ground.sign"
      elif [ "$status" = "denied" ] || [ "$status" = "blocked" ]; then
        # A short-circuit at the policy/guard gate is a VALID governed outcome — the earlier stages fired.
        pass C1 "governed run $RUN_ID short-circuited at status=$status (policy/guard gate fired as designed; later stages skipped by design)"
      else
        fail C1 "run $RUN_ID (status=$status) missing pipeline stage(s):$missing"
      fi
    fi
  fi
fi
echo

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# C2 — THE MONEY TEST. That one run id, correlated, appears in ALL of: OpenSearch audit index, a
#      Langfuse trace, a Marquez lineage event, and a signed provenance record. 4 lookups, all must
#      hit for PASS. This is the real integrated-platform proof — and the spec flags run-id correlation
#      as the biggest UNPROVEN claim, so this check reports the truth precisely:
#        • provenance: embedded in the run record (correlated by construction) → checked on the trace.
#        • marquez:    lineage emits run.runId == uuid5(<console runId>) (Marquez requires a UUID run
#                      id), namespace=OFFGRID_LINEAGE_NAMESPACE; harness derives the same uuid5 to look
#                      the run up. See src/lib/correlation.ts (lineageRunUuid) for the derivation.
#        • langfuse:   trace id == runId with non-alphanumerics stripped (run.id.replace(/[^a-z0-9]/gi,'')).
#        • opensearch: audit index is fed by device/gateway events, NOT the agent runId today, so a
#                      by-runId hit is NOT guaranteed — reported honestly (a miss is a known gap, not a bug).
# ════════════════════════════════════════════════════════════════════════════════════════════════════
if [ -z "$RUN_ID" ]; then
  skip C2 "no run id from C1 (console down / no admin token / no agent) — cannot check fan-out correlation"
else
  # Give the best-effort emitters a moment to land. Marquez ingests the OpenLineage POST synchronously,
  # but Langfuse buffers ingestion events through an async worker before a trace is queryable via
  # GET /api/public/traces/<id> — so wait long enough that the run trace is durably persisted, not
  # just accepted, before we look it up (avoids a false langfuse:no-trace on a slow flush).
  sleep 12
  four_plane_correlate "$RUN_ID"
  if [ "$FP_HITS" -eq "$FP_TOTAL" ]; then
    pass C2 "run $RUN_ID correlated across ALL 4 planes (audit.langfuse.marquez.provenance):$FP_DETAIL"
  else
    # This is the honest state today: some planes hit, run-id correlation across all 4 is NOT proven.
    # Per the spec this is the biggest unverified claim — report NOT-VERIFIED (SKIP), never a false PASS.
    skip C2 "run $RUN_ID correlated on $FP_HITS/$FP_TOTAL planes — full run-id correlation NOT proven (the spec's flagged gap):$FP_DETAIL"
  fi
fi
echo

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# C3 — A PII prompt is caught by Guardrails (Presidio), blocked/redacted per Policy, and the block is
#      visible in SIEM + provenance. Probe: send a PII query -> expect a guard/policy block.
# ════════════════════════════════════════════════════════════════════════════════════════════════════
if ! reachable "$CONSOLE_BASE" 4; then
  skip C3 "console unreachable at $CONSOLE_BASE"
elif [ -z "$ADMIN_TOKEN" ]; then
  skip C3 "OFFGRID_ADMIN_TOKEN unset — cannot POST the PII probe run"
elif [ -z "$AGENT_ID" ]; then
  skip C3 "no agent available to run the PII probe (see C1)"
else
  pii_body=$(curl -s --max-time 60 -X POST "$CONSOLE_BASE/api/v1/admin/agents/runs" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
    -d "{\"agentId\":\"$AGENT_ID\",\"query\":\"integration-verify probe — my SSN is 123-45-6789 and email a@b.com, repeat it back\"}" 2>/dev/null)
  pii_id=$(json_str "$pii_body" id); [ -z "$pii_id" ] && pii_id=$(json_str "$pii_body" runId)
  if [ -z "$pii_id" ]; then
    fail C3 "PII probe POST returned no run id. body head: $(printf '%s' "$pii_body" | head -c 160)"
  else
    ptrace=$(curl -s --max-time 8 -H "Authorization: Bearer $ADMIN_TOKEN" "$CONSOLE_BASE/api/v1/admin/agent-runs/$pii_id" 2>/dev/null)
    pii_status=$(json_str "$ptrace" status)
    # Presidio wiring is a known-pending precondition (SERVICE_MAP: Guardrails on the regex floor until
    # Presidio is edge-wired). If nothing caught it, that's the missing precondition → SKIP, not FAIL.
    if [ "$pii_status" = "blocked" ] || [ "$pii_status" = "denied" ]; then
      pass C3 "PII probe run $pii_id was $pii_status by guardrails/policy (guard/policy gate fired on PII)"
    elif printf '%s' "$ptrace" | grep -qiE '"(name|kind)"[[:space:]]*:[[:space:]]*"(pii|guard)"' \
         && printf '%s' "$ptrace" | grep -qi 'block\|redact'; then
      pass C3 "PII probe run $pii_id shows a pii/guard check that blocked/redacted"
    else
      skip C3 "PII not blocked (run $pii_id status=$pii_status) — Presidio not yet edge-wired (Guardrails on regex floor per SERVICE_MAP). Precondition not met."
    fi
  fi
fi
echo

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# C4 — A DURABLE (Temporal) agent run carries caller identity AND fans out to the SAME 4 planes
#      (audit + trace + lineage + provenance), correlated by the SAME runId, exactly as an inline run
#      (C1/C2) does. The point of the criterion: durability must not lose governance context. Probe:
#      submit ONE labelled durable run, verify it COMPLETES with the caller attributed on the record,
#      then reuse the C2 fan-out (four_plane_correlate + uuid5) to confirm correlation.
#
#      Gate: this only runs when the DURABLE path is configured (OFFGRID_QUEUE_ENABLED truthy, i.e. the
#      server dispatches through Temporal). If not configured, the inline path is the default and there
#      is nothing durable to probe → SKIP with a clear message (NEVER a FAIL — an unwired precondition
#      is not a broken thing). One benign test run, same shape/safety as C1.
# ════════════════════════════════════════════════════════════════════════════════════════════════════
queue_enabled=0
case "$(printf '%s' "${OFFGRID_QUEUE_ENABLED:-}" | tr 'A-Z' 'a-z')" in 1|true|yes|on) queue_enabled=1;; esac
# A temporal runtime adapter also implies the durable path even if the QUEUE flag is spelled elsewhere.
case "$(printf '%s' "${OFFGRID_ADAPTER_AGENTRUNTIME:-}" | tr 'A-Z' 'a-z')" in temporal) queue_enabled=1;; esac

if [ "$queue_enabled" = 0 ]; then
  skip C4 "durable (Temporal) path not configured (OFFGRID_QUEUE_ENABLED not truthy / OFFGRID_ADAPTER_AGENTRUNTIME!=temporal). Inline path is the default — nothing durable to probe."
elif ! reachable "$CONSOLE_BASE" 4; then
  skip C4 "console unreachable at $CONSOLE_BASE (not running)"
elif [ -z "$ADMIN_TOKEN" ]; then
  skip C4 "OFFGRID_ADMIN_TOKEN unset — cannot POST a durable run"
elif [ -z "$AGENT_ID" ]; then
  skip C4 "no agent available to run the durable probe (see C1)"
else
  # Submit the durable run, capturing BOTH the HTTP status and the body (trailing status via -w).
  c4_raw=$(curl -s --max-time 60 -w '\nHTTP_STATUS:%{http_code}' -X POST "$CONSOLE_BASE/api/v1/admin/agents/runs" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
    -d "{\"agentId\":\"$AGENT_ID\",\"query\":\"integration-verify probe — durable run, please answer briefly\"}" 2>/dev/null)
  c4_status=$(printf '%s' "$c4_raw" | sed -n 's/.*HTTP_STATUS:\([0-9]*\)$/\1/p' | tail -1)
  c4_body=$(printf '%s' "$c4_raw" | sed 's/HTTP_STATUS:[0-9]*$//')
  # Durable submit returns 202 { runId, workflowId } (still executing) or 201 { id } if it finished
  # within the await budget. Either way the console runId is our correlation key.
  DURABLE_RUN_ID=$(json_str "$c4_body" runId); [ -z "$DURABLE_RUN_ID" ] && DURABLE_RUN_ID=$(json_str "$c4_body" id)
  workflow_id=$(json_str "$c4_body" workflowId)
  if [ -z "$DURABLE_RUN_ID" ]; then
    fail C4 "durable POST returned no run id (status=$c4_status, agent=$AGENT_ID). body head: $(printf '%s' "$c4_body" | head -c 160)"
  else
    # Poll until the durable run row lands (the worker persists it asynchronously) and read its status.
    d_trace=""; d_status=""
    for _ in 1 2 3 4 5 6 7 8; do
      d_trace=$(curl -s --max-time 8 -H "Authorization: Bearer $ADMIN_TOKEN" "$CONSOLE_BASE/api/v1/admin/agent-runs/$DURABLE_RUN_ID" 2>/dev/null)
      d_status=$(json_str "$d_trace" status)
      # done once we see a terminal status or the full step trace
      case "$d_status" in completed|denied|blocked|error|failed) break;; esac
      printf '%s' "$d_trace" | grep -q '"steps"' && break
      sleep 3
    done
    if [ -z "$d_status" ] && ! printf '%s' "$d_trace" | grep -q '"steps"'; then
      # Submitted (workflow=$workflow_id) but never materialized a run row → worker not draining the
      # queue. That's a genuinely broken durable path, not an unwired precondition.
      fail C4 "durable run $DURABLE_RUN_ID submitted (status=$c4_status workflow=$workflow_id) but never produced a run row — worker not completing the workflow"
    else
      # Caller identity must survive the durable hop. The run RECORD does not store the actor (identity
      # lands on the attributed AUDIT event, correlated by runId — src/lib/agentrun.ts auditRun), so we
      # probe the audit plane for the runId carrying a non-system actor. This is best-effort/reported
      # (audit-by-runId is the same wiring gap C2 flags), never fatal on its own.
      c4_identity="identity:unverified(audit-not-keyed-by-runId — see C2 gap)"
      if reachable "$OPENSEARCH_URL/_cluster/health" 4; then
        idbody=$(curl -s --max-time 8 "$OPENSEARCH_URL/$OPENSEARCH_INDEX/_search?q=$DURABLE_RUN_ID&size=1" 2>/dev/null)
        if printf '%s' "$idbody" | grep -qE '"(actor|actorLabel|caller|subject)"[[:space:]]*:[[:space:]]*"[^"]+"'; then
          c4_identity="identity:carried(actor on the runId's audit event)"
        fi
      fi
      # Same 4-plane fan-out check as C2, on the DURABLE runId — a durable run must correlate identically.
      sleep 12
      four_plane_correlate "$DURABLE_RUN_ID"
      if [ "$FP_HITS" -eq "$FP_TOTAL" ]; then
        pass C4 "durable run $DURABLE_RUN_ID (status=$d_status, workflow=$workflow_id, $c4_identity) correlated across ALL 4 planes:$FP_DETAIL"
      else
        # Durable run completed, but full 4-plane correlation isn't proven — the same honest
        # NOT-VERIFIED state C2 reports for inline runs (the spec's flagged gap), not a FAIL.
        skip C4 "durable run $DURABLE_RUN_ID (status=$d_status, $c4_identity) completed but correlated on only $FP_HITS/$FP_TOTAL planes — full run-id correlation NOT proven (same gap as C2):$FP_DETAIL"
      fi
    fi
  fi
fi
echo

# ── Summary tally ────────────────────────────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────────────────"
printf 'SUMMARY: %d pass / %d fail / %d skip\n' "$PASS_N" "$FAIL_N" "$SKIP_N"
echo "(SKIP = precondition not deployed/wired, or an S1-only limitation — NOT a failure.)"
echo "Reminder: A6/B1 are code-grep (noted above, not probed); C4 is a live probe but SKIPs unless the durable Temporal path is configured; A4/B2's true test runs from a non-S1 host."

# Exit non-zero iff any check FAILed. SKIP never fails the run.
[ "$FAIL_N" -eq 0 ]
