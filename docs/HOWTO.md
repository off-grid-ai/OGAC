# How-tos — step by step

Short, concrete recipes for everyday tasks. Each works in the **UI** and via the **API** (the
OpenAPI spec at `/docs` is the source of truth and the SDK generator).

---

## Issue a virtual key (token issuance)

**UI:** FinOps → **Issue key** → name, scope (user/project), subject, optional budget → copy the
`ogk_…` token (shown once). **API:**

```bash
curl -XPOST $URL/api/v1/admin/keys -H 'content-type: application/json' \
  -d '{"name":"Claims team","subjectType":"project","subject":"claims","budgetUsd":500}'
# → { key: {...}, token: "ogk_…" }   (token returned once)
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
  -d '{"kind":"text","title":"Lapse grace period","text":"A policy has a 30-day grace period…"}'
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

No Brain required — point it at your own sources. Swap the grounding model to HHEM/MiniCheck via
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
2. `.env.local`: `OFFGRID_ADAPTER_GUARDRAILS=presidio` + `OFFGRID_PRESIDIO_URL=…`.
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
