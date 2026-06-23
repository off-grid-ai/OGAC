#!/usr/bin/env bash
# Behavior verification for the swappable OSS adapters. Unlike `make smoke` (which only checks a
# service answers a health probe), this exercises the EXACT request/response contract each behavior
# port depends on — so a green run means "selecting this adapter actually changes behavior
# correctly," not just "the container is up." Bring services up first:
#   cd deploy && docker compose --profile policy --profile guardrails --profile lineage up -d
set -u

PRESIDIO="${OFFGRID_PRESIDIO_URL:-http://127.0.0.1:5002}"
OPA="${OFFGRID_OPA_URL:-http://127.0.0.1:8181}"
MARQUEZ="${OFFGRID_MARQUEZ_URL:-http://127.0.0.1:9000}"
NS="${OFFGRID_LINEAGE_NAMESPACE:-offgrid-console}"
LF_OTLP="${OFFGRID_LANGFUSE_OTLP_URL:-http://127.0.0.1:3030/api/public/otel}"
LF_AUTH="${OFFGRID_LANGFUSE_AUTH:-cGstbGYtb2ZmZ3JpZC1jb25zb2xlOnNrLWxmLW9mZmdyaWQtY29uc29sZQ==}"

pass=0
fail=0
check() { # name, condition-already-evaluated ($1=name $2=ok|<empty>)
  if [ -n "$2" ]; then echo "  ✓ $1"; pass=$((pass + 1)); else echo "  ✗ $1"; fail=$((fail + 1)); fi
}

echo "── guardrails: Presidio /analyze (PiiPort) ─────────────────────────────"
body=$(curl -s -X POST "$PRESIDIO/analyze" -H 'content-type: application/json' \
  -d '{"text":"reach me at jane.doe@acme.com","language":"en"}')
echo "$body" | grep -q 'EMAIL_ADDRESS' && check "detects EMAIL_ADDRESS entity" ok || check "detects EMAIL_ADDRESS entity" ""

echo "── policy: OPA decision API (PolicyPort) ───────────────────────────────"
curl -s -X PUT "$OPA/v1/policies/offgrid_verify" -H 'content-type: text/plain' --data-binary \
'package offgrid.authz
import rego.v1
default allow := false
allow if input.role == "compliance"' -o /dev/null
allow=$(curl -s -X POST "$OPA/v1/data/offgrid/authz" -H 'content-type: application/json' \
  -d '{"input":{"role":"compliance","resource":"audit","attributes":{}}}')
deny=$(curl -s -X POST "$OPA/v1/data/offgrid/authz" -H 'content-type: application/json' \
  -d '{"input":{"role":"viewer","resource":"audit","attributes":{}}}')
echo "$allow" | grep -q '"allow":true' && check "allows matching role" ok || check "allows matching role" ""
echo "$deny" | grep -q '"allow":false' && check "denies non-matching role" ok || check "denies non-matching role" ""

echo "── lineage: Marquez OpenLineage round-trip (LineagePort) ───────────────"
run=$(uuidgen 2>/dev/null || echo "run-$$")
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$MARQUEZ/api/v1/lineage" \
  -H 'content-type: application/json' \
  -d "{\"eventType\":\"COMPLETE\",\"eventTime\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"producer\":\"https://github.com/offgrid/console\",\"run\":{\"runId\":\"$run\"},\"job\":{\"namespace\":\"$NS\",\"name\":\"verify.ingest\"},\"inputs\":[{\"namespace\":\"$NS\",\"name\":\"verify-source\"}],\"outputs\":[{\"namespace\":\"$NS\",\"name\":\"verify-doc\"}]}")
[ "$code" = "200" ] || [ "$code" = "201" ] && check "accepts OpenLineage event ($code)" ok || check "accepts OpenLineage event ($code)" ""
curl -s "$MARQUEZ/api/v1/namespaces/$NS/jobs" | grep -q 'verify.ingest' \
  && check "job graph queryable after emit" ok || check "job graph queryable after emit" ""

echo "── observability: Langfuse v3 OTLP ingestion (otel.ts fan-out) ─────────"
now=$(( $(date +%s) * 1000000000 ))
tid=$(openssl rand -hex 16 2>/dev/null || echo "$(date +%s)0000000000000000000000")
sid=$(openssl rand -hex 8 2>/dev/null || echo "verifyspan000000")
otlp=$(printf '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"offgrid-console"}}]},"scopeSpans":[{"scope":{"name":"offgrid-console"},"spans":[{"traceId":"%s","spanId":"%s","name":"verify.span","kind":1,"startTimeUnixNano":"%s","endTimeUnixNano":"%s","attributes":[]}]}]}]}' "$tid" "$sid" "$now" "$now")
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$LF_OTLP/v1/traces" \
  -H 'content-type: application/json' -H "authorization: Basic $LF_AUTH" -d "$otlp")
[ "$code" = "200" ] || [ "$code" = "202" ] && check "accepts OTLP trace ($code)" ok || check "accepts OTLP trace ($code)" ""

echo
echo "verify-adapters: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
