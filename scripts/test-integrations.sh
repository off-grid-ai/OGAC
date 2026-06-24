#!/usr/bin/env bash
# Integration API tests — prove the wired adapters actually work, end to end, over HTTP.
#
# Two layers:
#   1. CONSOLE API   — the admin routes that drive each capability (QA, adapters, retrieval),
#                      authenticated with the service bearer ($OFFGRID_ADMIN_TOKEN).
#   2. OSS SERVICES  — the underlying systems' own APIs (Redis, Qdrant, Unleash, Langfuse),
#                      so we know the integration target is real, not just reachable from a list.
#
# A service that is down is reported SKIP (not FAIL) — bring up its compose profile to exercise it.
# Usage:  OFFGRID_ADMIN_TOKEN=... BASE=http://127.0.0.1:3000 ./scripts/test-integrations.sh
set -u

BASE="${BASE:-http://127.0.0.1:3000}"
TOKEN="${OFFGRID_ADMIN_TOKEN:-}"
REDIS_URL="${OFFGRID_REDIS_URL:-redis://127.0.0.1:6379}"
QDRANT_URL="${OFFGRID_QDRANT_URL:-http://127.0.0.1:6333}"
UNLEASH_URL="${OFFGRID_UNLEASH_URL:-http://127.0.0.1:4242}"
LANGFUSE_URL="${OFFGRID_LANGFUSE_URL:-http://127.0.0.1:3030}"
EVIDENTLY_URL="${OFFGRID_EVIDENTLY_URL:-http://127.0.0.1:8001}"
RAGAS_URL="${OFFGRID_RAGAS_URL:-http://127.0.0.1:8002}"

PASS=0 FAIL=0 SKIP=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n    %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }
skip() { printf '  \033[33mSKIP\033[0m  %s (%s)\n' "$1" "${2:-unreachable}"; SKIP=$((SKIP+1)); }
hdr()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

# api METHOD PATH [BODY] -> sets $STATUS and $BODY. Generous max-time: in dev, the first hit to a
# route compiles it (can take tens of seconds).
api() {
  local method="$1" path="$2" body="${3:-}"
  local tmp; tmp="$(mktemp)"
  local args=(-s -o "$tmp" -w '%{http_code}' --max-time 90 -X "$method" -H "authorization: Bearer ${TOKEN}")
  [ -n "$body" ] && args+=(-H 'content-type: application/json' -d "$body")
  STATUS="$(curl "${args[@]}" "${BASE}${path}" 2>/dev/null)"
  BODY="$(cat "$tmp")"; rm -f "$tmp"
}

up() { curl -s -o /dev/null --max-time 5 "$1" 2>/dev/null; }

# ── 1. CONSOLE API ────────────────────────────────────────────────────────────
hdr "Console admin API  ($BASE)"
if [ -z "$TOKEN" ]; then
  echo "  OFFGRID_ADMIN_TOKEN unset — set it (and restart the console with it) to test admin routes."
  SKIP=$((SKIP+6))
else
  api POST /api/v1/admin/evals/run
  { [ "$STATUS" = 201 ] && echo "$BODY" | grep -q '"score"'; } \
    && ok "POST /admin/evals/run → scored run (engine: $(echo "$BODY" | grep -o '"engine":"[^"]*"' | head -1))" \
    || bad "POST /admin/evals/run" "status=$STATUS body=$BODY"

  api GET /api/v1/admin/qa/drift
  { [ "$STATUS" = 200 ] && echo "$BODY" | grep -q '"status"' && echo "$BODY" | grep -q '"engine"'; } \
    && ok "GET /admin/qa/drift → $(echo "$BODY" | grep -o '"status":"[^"]*"' | head -1)" \
    || bad "GET /admin/qa/drift" "status=$STATUS body=$BODY"

  api GET /api/v1/admin/qa/status
  { [ "$STATUS" = 200 ] && echo "$BODY" | grep -q '"offline"' && echo "$BODY" | grep -q '"online"'; } \
    && ok "GET /admin/qa/status → offline+drift+online summary" \
    || bad "GET /admin/qa/status" "status=$STATUS body=$BODY"

  api POST /api/v1/admin/qa/score '{"input":"What is the contestability window?","output":"Two years from policy issue.","sources":["Claims SOP: flag for investigation if within two years of issue."]}'
  { [ "$STATUS" = 201 ] && echo "$BODY" | grep -q '"verdict"'; } \
    && ok "POST /admin/qa/score → judged=$(echo "$BODY" | grep -o '"judged":[a-z]*') posted=$(echo "$BODY" | grep -o '"posted":[a-z]*')" \
    || bad "POST /admin/qa/score" "status=$STATUS body=$BODY"

  api GET '/api/v1/admin/adapters?health=1'
  { [ "$STATUS" = 200 ] && for c in evals drift caching flags retrieval; do echo "$BODY" | grep -q "\"$c\"" || exit 1; done; } \
    && ok "GET /admin/adapters → evals+drift+caching+flags+retrieval bound" \
    || bad "GET /admin/adapters" "status=$STATUS body=$BODY"

  api POST /api/v1/admin/retrieve '{"query":"death claim first notice of loss"}'
  [ "$STATUS" = 200 ] \
    && ok "POST /admin/retrieve → routed hits" \
    || bad "POST /admin/retrieve" "status=$STATUS body=$BODY"

  # C2PA — sign a PNG then verify the embedded Content Credentials round-trip.
  PNG='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVR4nGMwuTzzPyWYYdSAUQNGDRguBgAAOF6fH/u2UhwAAAAASUVORK5CYII='
  api POST /api/v1/admin/provenance/c2pa "{\"image\":\"$PNG\",\"mimeType\":\"image/png\",\"title\":\"itest\"}"
  signed="$(echo "$BODY" | grep -o '"image":"[^"]*"' | sed 's/"image":"//;s/"//')"
  if [ "$STATUS" = 201 ] && [ -n "$signed" ]; then
    api POST /api/v1/admin/provenance/c2pa "{\"image\":\"$signed\",\"mimeType\":\"image/png\",\"action\":\"verify\"}"
    echo "$BODY" | grep -q '"valid":true' \
      && ok "C2PA sign→verify image Content Credentials (valid)" \
      || bad "C2PA verify" "status=$STATUS body=$(echo "$BODY" | head -c 120)"
  else
    bad "C2PA sign" "status=$STATUS body=$(echo "$BODY" | head -c 120)"
  fi

  # Report export provenance — fetch the detached manifest, then verify its signature.
  api GET '/api/v1/admin/reports/audit-summary/export?manifest=1'
  if [ "$STATUS" = 200 ] && echo "$BODY" | grep -q '"signature"'; then
    api POST /api/v1/admin/provenance/verify "{\"manifest\":$BODY}"
    echo "$BODY" | grep -q '"signatureValid":true' \
      && ok "Report export → ed25519 manifest signs + verifies" \
      || bad "Report manifest verify" "body=$(echo "$BODY" | head -c 120)"
  else
    bad "Report export manifest" "status=$STATUS body=$(echo "$BODY" | head -c 120)"
  fi

  # Sigstore — verification is standalone; a garbage bundle must be rejected (graceful, not 500).
  api POST /api/v1/admin/provenance/sigstore '{"action":"verify","bundle":{"not":"a bundle"}}'
  echo "$BODY" | grep -q '"valid":false' \
    && ok "Sigstore verify rejects an invalid bundle (graceful)" \
    || bad "Sigstore verify" "status=$STATUS body=$(echo "$BODY" | head -c 120)"

  # Sandbox — the agent-code-exec flag is OFF by default, so execution must be refused (403).
  api POST /api/v1/admin/sandbox/run '{"language":"python","code":"print(1)"}'
  [ "$STATUS" = 403 ] \
    && ok "Sandbox run gated by agent-code-exec flag (403 when off)" \
    || bad "Sandbox gate" "expected 403, status=$STATUS body=$(echo "$BODY" | head -c 120)"
fi

# ── 2. OSS SERVICE APIs ─────────────────────────────────────────────────────────
hdr "Underlying OSS service APIs"

# Redis — PING over RESP via bash /dev/tcp (no client needed).
rhost="$(echo "$REDIS_URL" | sed -E 's#redis://([^:/]+).*#\1#')"
rport="$(echo "$REDIS_URL" | sed -E 's#.*:([0-9]+).*#\1#')"; rport="${rport:-6379}"
if exec 3<>"/dev/tcp/${rhost}/${rport}" 2>/dev/null; then
  printf 'PING\r\n' >&3; read -r -t 3 reply <&3; exec 3>&- 3<&-
  echo "$reply" | grep -q 'PONG' && ok "Redis PING → PONG (caching backend)" || bad "Redis PING" "got: $reply"
else
  skip "Redis PING" "no listener on ${rhost}:${rport}"
fi

# Qdrant — create a throwaway collection, upsert a point, search, then delete.
if up "$QDRANT_URL/healthz" >/dev/null 2>&1 || curl -s --max-time 3 "$QDRANT_URL/healthz" >/dev/null 2>&1; then
  C="offgrid-itest"
  curl -s -X PUT "$QDRANT_URL/collections/$C" -H 'content-type: application/json' \
    -d '{"vectors":{"size":4,"distance":"Cosine"}}' >/dev/null
  curl -s -X PUT "$QDRANT_URL/collections/$C/points" -H 'content-type: application/json' \
    -d '{"points":[{"id":1,"vector":[0.1,0.2,0.3,0.4],"payload":{"t":"x"}}]}' >/dev/null
  sr="$(curl -s -X POST "$QDRANT_URL/collections/$C/points/search" -H 'content-type: application/json' \
    -d '{"vector":[0.1,0.2,0.3,0.4],"limit":1,"with_payload":true}')"
  curl -s -X DELETE "$QDRANT_URL/collections/$C" >/dev/null
  echo "$sr" | grep -q '"id":1' && ok "Qdrant create→upsert→search round-trip" || bad "Qdrant round-trip" "$sr"
else
  skip "Qdrant round-trip" "$QDRANT_URL down"
fi

# Unleash — health endpoint.
uh="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$UNLEASH_URL/health" 2>/dev/null)"
[ "$uh" = 200 ] && ok "Unleash GET /health → 200 (flags backend)" || skip "Unleash /health" "got $uh from $UNLEASH_URL"

# Langfuse — the online-scoring target. With OFFGRID_LANGFUSE_AUTH set we prove the full scoring
# contract scoring.ts uses: ingest a trace + scores, then read them back (async worker → ClickHouse).
LANGFUSE_AUTH="${OFFGRID_LANGFUSE_AUTH:-}"
lh="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$LANGFUSE_URL/api/public/health" 2>/dev/null)"
if [ "$lh" != 200 ]; then
  skip "Langfuse scoring round-trip" "health $lh from $LANGFUSE_URL"
elif [ -z "$LANGFUSE_AUTH" ]; then
  ok "Langfuse GET /api/public/health → 200 (set OFFGRID_LANGFUSE_AUTH to test the score round-trip)"
else
  tid="$(openssl rand -hex 16)"; ts="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  ing="$(curl -s --max-time 12 -X POST "$LANGFUSE_URL/api/public/ingestion" \
    -H "authorization: Basic $LANGFUSE_AUTH" -H 'content-type: application/json' \
    -d "{\"batch\":[{\"id\":\"$(openssl rand -hex 8)\",\"type\":\"trace-create\",\"timestamp\":\"$ts\",\"body\":{\"id\":\"$tid\",\"name\":\"itest-qa\",\"input\":\"q\",\"output\":\"a\"}},{\"id\":\"$(openssl rand -hex 8)\",\"type\":\"score-create\",\"timestamp\":\"$ts\",\"body\":{\"id\":\"$(openssl rand -hex 8)\",\"traceId\":\"$tid\",\"name\":\"quality\",\"value\":0.9,\"dataType\":\"NUMERIC\"}}]}")"
  if echo "$ing" | grep -q '"errors":\[\]'; then
    found=""
    for _ in $(seq 1 30); do
      r="$(curl -s --max-time 8 -H "authorization: Basic $LANGFUSE_AUTH" "$LANGFUSE_URL/api/public/traces/$tid")"
      echo "$r" | grep -q "\"$tid\"" && { found=1; break; }
      sleep 2 # Langfuse v3 ingests asynchronously (worker → ClickHouse) — give it time
    done
    [ -n "$found" ] && ok "Langfuse score round-trip → trace+scores ingested and read back" \
      || bad "Langfuse score round-trip" "ingested (207) but trace not visible after polling"
  else
    bad "Langfuse score round-trip" "ingestion rejected: $ing"
  fi
fi

# Evidently drift sidecar — prove real drift detection: stable window vs a collapsed window.
if up "$EVIDENTLY_URL/" >/dev/null 2>&1 || curl -s --max-time 3 "$EVIDENTLY_URL/" >/dev/null 2>&1; then
  d0="$(curl -s --max-time 20 -X POST "$EVIDENTLY_URL/iterate/itest" -H 'content-type: application/json' \
    -d '{"reference":[100,98,99,97,100,98,99,96],"current":[99,97,98,96,100,95,99,97]}')"
  d1="$(curl -s --max-time 20 -X POST "$EVIDENTLY_URL/iterate/itest" -H 'content-type: application/json' \
    -d '{"reference":[100,98,99,97,100,98,99,96],"current":[40,35,50,30,45,38,42,33]}')"
  { echo "$d0" | grep -q '"drift_detected":false' && echo "$d1" | grep -q '"drift_detected":true'; } \
    && ok "Evidently sidecar → stable=no-drift, collapsed=drift (real DataDriftPreset)" \
    || bad "Evidently drift sidecar" "stable=$d0 collapsed=$d1"
else
  skip "Evidently drift sidecar" "$EVIDENTLY_URL down (make qa)"
fi

# Ragas sidecar — health (a full eval needs a loaded gateway model; covered by /admin/evals/run).
rgh="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$RAGAS_URL/health" 2>/dev/null)"
[ "$rgh" = 200 ] && ok "Ragas sidecar GET /health → 200 (RAG-metrics backend)" || skip "Ragas sidecar" "got $rgh from $RAGAS_URL (make qa)"

# ── summary ──────────────────────────────────────────────────────────────────
hdr "Result"
printf '  %d passed, %d failed, %d skipped\n\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ]
