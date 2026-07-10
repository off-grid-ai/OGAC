# How-tos - step by step

Short, concrete recipes for everyday tasks. Each works in the **UI** and via the **API** (the
OpenAPI spec at `/docs` is the source of truth and the SDK generator).

---

## Issue a virtual key (token issuance)

**UI:** FinOps → **Issue key** → name, scope (user/project), subject, optional budget → copy the
`ogk_...` token (shown once). **API:**

```bash
curl -XPOST $URL/api/v1/admin/keys -H 'content-type: application/json' \
  -d '{"name":"Claims team","subjectType":"project","subject":"claims","budgetUsd":500}'
# → { key: {...}, token: "ogk_..." }   (token returned once)
```

Revoke: toggle off in FinOps, or `PATCH /api/v1/admin/keys/{id} {"enabled":false}`.

---

## Add a routing rule (incl. geo / data-residency)

**UI:** Control → Model routing → **Add rule** → attribute (`data_class`/`task`/`cost`/`region`),
equals value, route (`local`/`cloud`/`block`), optional model. **API:**

```bash
curl -XPOST $URL/api/v1/admin/routing -H 'content-type: application/json' \
  -d '{"name":"India → on-device","attribute":"region","operator":"eq","value":"in","action":"local","model":"gemma-local"}'
```

Test it: Control → Model routing → tester, or
`POST /api/v1/admin/routing/evaluate {"attributes":{"region":"in"}}`. Cloud is leashed by the egress
switch (a `cloud` decision with egress off → `block`).

---

## Ingest into the Brain (text / file / image / dataset)

**UI:** Brain → **Ingest** → pick a kind. Images are captioned by the gateway; datasets become a
record. **API:**

```bash
curl -XPOST $URL/api/v1/admin/brain/ingest -H 'content-type: application/json' \
  -d '{"kind":"text","title":"Lapse grace period","text":"A policy has a 30-day grace period..."}'
```

It's embedded + indexed with provenance, then retrievable via the router.

---

## Register a tool (router's `tool` source)

**UI:** Brain → Tools & services → **Register tool** → name, type (`http`/`mcp`), endpoint,
"when to use" (used to match query intent). **API:** `POST /api/v1/admin/tools`.

---

## Run an eval

**UI:** Brain → Evals → **Run eval** (golden set vs the Brain; recall-scored). **API:**
`POST /api/v1/admin/evals/run`. Add golden cases via Brain → Evals → Add case, or
`POST /api/v1/admin/golden-cases`.

---

## Verify an answer's citations (grounding, standalone)

```bash
curl -XPOST $URL/api/v1/admin/grounding/verify -H 'content-type: application/json' \
  -d '{"answer":"A death claim needs the certificate.","sources":[{"text":"Capture the death certificate."}]}'
# → per-claim {supported, score, source}
```

No Brain required - point it at your own sources. Swap the grounding model to HHEM/MiniCheck via
`OFFGRID_GROUNDING_MODEL`.

---

## Run an agent and read its trace

```bash
curl -XPOST $URL/api/v1/admin/agents/runs -H 'content-type: application/json' \
  -d '{"agentId":"fnol-intake","query":"how do I handle a death claim?"}'
# → { steps:[plan,retrieve,handoff,ground,answer], answer, citations:[{ref,score,supported}] }
```

List recent runs: `GET /api/v1/admin/agents/runs`.

---

## Add a governance item (Phase E)

**UI:** Regulatory → Governance registry → **Add item** → kind (policy / ethics_review / raci /
training / vendor / insurance / drill / impact_assessment), title, owner. **API:**
`POST /api/v1/admin/governance`.

---

## Generate a regulator pack

**UI:** Reports → pick IRDAI / RBI / SEBI / DPDP / CERT-In → **Generate** (Markdown download).
**API:** `GET /api/v1/admin/reports/{id}/export`.

---

## Swap a capability to its OSS backend

1. `cd deploy && make <profile>` (e.g. `make guardrails`).
2. `.env.local`: `OFFGRID_ADAPTER_GUARDRAILS=presidio` + `OFFGRID_PRESIDIO_URL=...`.
3. Restart the console. Confirm in **Admin → Integrations · adapters** (active + healthy).

---

## Inspect the audit / cost / traces

- **Audit:** Control → Audit log, or `GET /api/v1/audit`.
- **Cost/usage:** FinOps, or `GET /api/v1/admin/finops`.
- **Bindings/health:** `GET /api/v1/admin/adapters?health=1`.
- **Traces:** Jaeger (`:16686`); **LLM traces:** Langfuse (`:3030`); **SIEM:** OpenSearch (`:9200`).

---

## Generate a client SDK

The contract is OpenAPI 3.1 at `/openapi.json` (rendered at `/docs`). Generate any-language client:

```bash
npx @openapitools/openapi-generator-cli generate -i $URL/openapi.json -g typescript-fetch -o ./sdk
```

Agents call the **gateway** with any OpenAI-compatible SDK; devices use the desktop node client.

---

## Agent QA - run evals, score live traffic, watch for drift

All admin routes accept either an SSO session or `Authorization: Bearer $OFFGRID_ADMIN_TOKEN`.
Set `BASE=http://127.0.0.1:3000` (or your host) for the examples below.

### Run an offline eval
```bash
curl -sX POST "$BASE/api/v1/admin/evals/run" -H "authorization: Bearer $TOKEN"
# → { "id", "engine": "golden", "score": 0..100, "passed", "total", "startedAt" }
```
Switch the evaluator with `OFFGRID_ADAPTER_EVALS=golden|promptfoo|ragas`. `promptfoo` needs the
`promptfoo` binary on PATH; `ragas` needs the sidecar (`make qa`, `OFFGRID_RAGAS_URL`). Both fall
back to `golden` if unavailable - so this call always records a run.

### Score a live interaction (online eval → Langfuse)
```bash
curl -sX POST "$BASE/api/v1/admin/qa/score" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"input":"What is the contestability window?","output":"Two years from issue.","sources":["Claims SOP: ...within two years of issue."]}'
# → { "traceId", "verdict": {"quality":0..1,"faithfulness":0..1,"reasoning"}, "judged": bool, "posted": bool }
```
`judged:false` = the gateway judge was unreachable (no fabricated score is written). `posted:false`
= Langfuse down. Needs `OFFGRID_LANGFUSE_URL` + `OFFGRID_LANGFUSE_AUTH`. In the agent pipeline this
fires automatically after each run (gated by the `online-evals` flag + `OFFGRID_QA_SAMPLE_RATE`).

### Check drift / degradation
```bash
curl -s "$BASE/api/v1/admin/qa/drift"   -H "authorization: Bearer $TOKEN"  # PSI + mean-delta, status stable|warning|drift
curl -s "$BASE/api/v1/admin/qa/status"  -H "authorization: Bearer $TOKEN"  # offline score + drift + online state
```
`OFFGRID_ADAPTER_DRIFT=native` (PSI over eval history, default) or `evidently` (`make qa`).

### Schedule the QA sweep (cron / CI gate)
```bash
curl -sX POST "$BASE/api/v1/admin/qa/sweep" -H "authorization: Bearer $TOKEN"
# 200 + {degraded:false,...}  |  503 + {degraded:true, reasons:[...]}  → emits a qa.sweep span
# cron example: */30 * * * *  curl -fsX POST ... || alert
```

## Provenance - sign & verify exports and assets

### Export a report with a signed manifest, then verify
```bash
curl -s "$BASE/api/v1/admin/reports/audit-summary/export?format=pdf&manifest=1" -H "authorization: Bearer $TOKEN" > manifest.json
curl -sX POST "$BASE/api/v1/admin/provenance/verify" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d "{\"manifest\": $(cat manifest.json)}"
# → { "signatureValid": true, "algorithm": "ed25519|HMAC-SHA256" }
```

### C2PA Content Credentials on an image
```bash
B64=$(base64 < logo.png)
curl -sX POST "$BASE/api/v1/admin/provenance/c2pa" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d "{\"image\":\"$B64\",\"mimeType\":\"image/png\"}"   # → { image: signed-base64 }
# verify: re-POST the signed image with "action":"verify" → { hasManifest, valid }
```

### Sigstore (keyless attestation)
```bash
curl -s "$BASE/api/v1/admin/provenance/sigstore" -H "authorization: Bearer $TOKEN"   # { signingConfigured }
curl -sX POST "$BASE/api/v1/admin/provenance/sigstore" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"action":"verify","bundle":{}}'             # → { valid, error? }
```
Signing needs an OIDC identity token (`OFFGRID_SIGSTORE_IDENTITY_TOKEN`); public-good Fulcio/Rekor by
default, or self-host via `OFFGRID_FULCIO_URL` / `OFFGRID_REKOR_URL`.

## Sandbox - run agent code safely
```bash
# Enable first: OFFGRID_ADAPTER_SANDBOX=docker + turn on the agent-code-exec flag (Admin → Flags).
curl -sX POST "$BASE/api/v1/admin/sandbox/run" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"language":"python","code":"print(2**10)"}'
# → { engine:"docker", ok:true, stdout:"1024\n", exitCode:0 }   (403 if the flag is off / no-exec default)
```
Runs `--network none`, memory/CPU/PID-capped, read-only, non-root, with a hard timeout.

## Fleet Control - device inventory
```bash
curl -s "$BASE/api/v1/admin/mdm/devices" -H "authorization: Bearer $TOKEN"   # { backend:"native|fleetdm", data:[...] }
```
Point at FleetDM with `OFFGRID_ADAPTER_MDM=fleetdm` + `OFFGRID_FLEET_URL` + `OFFGRID_FLEET_TOKEN`
(`make mdm`; see RUNBOOKS for the `fleetctl` token steps). Falls back to the registry if unreachable.

Inventory, live osquery, software + CVE visibility, and policies work today. Device CONTROL - the
MDM commands that act on a device (lock / wipe / config-profile push / settings enforcement) - is
coming soon: in the console those actions render disabled with a "Coming soon" label rather than
firing. Advanced MDM control is Fleet Premium, separately licensed. The first-party kill switch
(`POST /api/v1/admin/devices/{id}/kill`) is unaffected and works today.
