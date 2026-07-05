# Underlying-service capability audit

For every integrated service: what it does, its key functionality, and **how much of it is usable
from the console** — so we can see where the console fully leverages the service and where the
functionality exists but isn't reachable from the UI/API yet. Assessed against the code + live
probes (2026-07-05).

**Coverage legend:** ✅ usable from console · 🟡 partial · ❌ not exposed · ⚪ service not running.

Wiring status recap (live): Gateway, 6 data connectors, LanceDB, Keycloak, Langfuse (g6), Unleash
(g6), Superset (g6), FleetDM (g6), **Presidio (g6, live)** are up. Qdrant not default. **OpenSearch,
Marquez, OpenBao not running.** Temporal adapter scaffolded.

---

## Gateway / aggregator (model serving)
**Does:** OpenAI-compatible routing across gateway nodes; chat, vision, embeddings, image gen.
| Capability | Console coverage |
|---|---|
| Chat completions | ✅ Chat, agents |
| Vision (image input) | ✅ vision models in Chat |
| Image generation | ✅ image models in Chat |
| Embeddings | ✅ used by Knowledge/RAG (no direct UI, by design) |
| Model list / per-node health | ✅ Gateway page |
| Routing rules (local/cloud/block) | ✅ Control (CRUD) — but **0 rules configured** |
| Fallback / cache / rate-limit config | 🟡 exists in aggregator; not all editable from console |
**Gap:** cache/rate-limit tuning and fallback chains aren't fully console-editable.

## Keycloak (identity) ✅
**Does:** OIDC SSO, users, roles, clients.
| Capability | Console coverage |
|---|---|
| SSO login (Google/MS/Keycloak) | ✅ |
| Users + role assignment | ✅ Access → Users |
| Custom roles → module capabilities | ✅ Access → Roles |
| Machine clients (service accounts) + secret rotation | ✅ Access → Machine Clients |
| Realm/client config, IdP federation, MFA policy | ❌ (managed in Keycloak admin, not console) |
**Gap:** deep realm config (federation, MFA, token lifetimes) is Keycloak-admin only.

## Presidio (PII) 🟡 → can be ✅ (LIVE on g6, not yet wired)
**Does:** entity-grade PII detection (/analyze) + masking (/anonymize).
| Capability | Console coverage |
|---|---|
| Detection on prompts/answers | 🟡 regex floor active; Presidio adapter ready but env not set |
| Anonymize/mask | 🟡 wired in code; activates when Presidio URL set |
| Test-a-string | ✅ Guardrails (runs the active engine) |
| Custom recognizers | ❌ not exposed |
**Gap:** Presidio is running on g6 (:5002/:5001, verified 200) but the console env points at the
regex floor. Wiring it (Caddy loopback proxy + `OFFGRID_ADAPTER_GUARDRAILS=presidio`) makes
Guardrails show real entity-grade masking. Custom-recognizer management not built.

## OPA (policy) 🟡
**Does:** policy-as-code (Rego) decisions.
| Capability | Console coverage |
|---|---|
| Allow/deny decisions | ✅ via the policy adapter (first-party ABAC default) |
| ABAC rule CRUD | ✅ Policy page |
| Author/deploy Rego bundles | ❌ not exposed (adapter can query OPA; no bundle editor) |
**Gap:** first-party ABAC is fully console-managed; raw Rego authoring is not in the console.

## OpenBao (secrets) ⚪ → not running
**Does:** KV v2 secrets vault, rotation, audit.
| Capability | Console coverage |
|---|---|
| Read/write/list KV | 🟡 code ready (env adapter is the live default) |
| Rotation, seal/unseal, auth methods | ❌ |
**Gap:** OpenBao isn't running; Secrets uses the env adapter (no keys). Start OpenBao + set
`OFFGRID_ADAPTER_SECRETS=openbao` to make it real. Rotation UI not built.

## Qdrant (vectors) 🟡
**Does:** vector store — collections, upsert, search.
| Capability | Console coverage |
|---|---|
| Search / retrieval | ✅ (LanceDB is the live default; Qdrant swappable) |
| Collection create/list/delete | ✅ Retrieval page |
| Reindex Brain → Qdrant + point count | ✅ Data page |
| Flip to Qdrant as default | 🟡 config-only (LanceDB default today) |
**Gap:** none major; Qdrant just isn't the active backend.

## Langfuse (observability) 🟡 (up on g6)
**Does:** LLM tracing, cost, scores.
| Capability | Console coverage |
|---|---|
| Emit spans (OTLP) | ✅ |
| Trace read-back | 🟡 Observability shows recent traces — confirm they render |
| Cost → FinOps, score charts | 🟡 FinOps computed from audit log (not Langfuse), score charts not built |
**Gap:** deeper Langfuse dashboards (score trends) aren't mirrored; the console links out.

## Marquez (lineage) ⚪ → not running
**Does:** OpenLineage graph (namespaces, jobs, datasets, runs).
| Capability | Console coverage |
|---|---|
| Emit lineage events | ✅ (adapter emits) |
| Read graph | 🟡 code ready; Marquez not running → Lineage empty |
**Gap:** start Marquez + set `OFFGRID_MARQUEZ_URL` to populate Lineage.

## OpenSearch (SIEM) ⚪ → not running
**Does:** audit/event index, full-text search, aggregations.
| Capability | Console coverage |
|---|---|
| Ship audit events | ✅ (shipper wired) |
| Full-text audit search | 🟡 code ready; not running → empty |
| Suppression rules | ✅ SIEM page (applies to the view) |
| Aggregation dashboards, alert rules | ❌ |
**Gap:** OpenSearch isn't running → SIEM + audit search empty. Aggregation/alert UIs not built.

## Superset (BI) 🟡 (up on g6)
**Does:** dashboards, SQL Lab, guest-token embeds.
| Capability | Console coverage |
|---|---|
| Guest-token embed + SQL API | ✅ wired (Analytics) |
| Provision default dashboard | ❌ not auto-provisioned |
**Gap:** no dashboard is provisioned to embed yet.

## Unleash (flags) ✅ (up on g6)
**Does:** feature flags, variants, gradual rollout.
| Capability | Console coverage |
|---|---|
| Flag lookups (gating) | ✅ |
| Flag management (create/toggle/delete) | ✅ Configuration page |
| A/B variants, gradual-rollout editor | ❌ |
**Gap:** only on/off flags from the console; variants/rollout are Unleash-native.

## FleetDM (MDM) 🟡 (up on g6)
**Does:** device inventory, policies, live queries (osquery).
| Capability | Console coverage |
|---|---|
| Device list + enroll + actions | ✅ Fleet page |
| Policy version | ✅ |
| Live query UI, software inventory | ❌ |
**Gap:** osquery live-query + software inventory not surfaced.

## Temporal (workflows) 🟡 scaffold
**Does:** durable workflow execution.
| Capability | Console coverage |
|---|---|
| Runtime adapter | 🟡 scaffolded; runAgent works without it |
| Durable agent runs, worker, retries | ❌ (Phase 6/8) |
**Gap:** durable execution is the biggest unbuilt integration.

## SeaweedFS (storage) ✅
**Does:** S3-compatible object store.
| Capability | Console coverage |
|---|---|
| Upload / list / preview / share | ✅ Storage page |
| Public/private URLs | ✅ |
| Bucket policy / lifecycle | ❌ (defaults; not console-managed) |
**Gap:** bucket lifecycle/policy not exposed (rarely needed).

## Data connectors (6, live) ✅
Postgres/MySQL/MSSQL/S3/Kafka/REST — add/edit/sync/delete + real ingest counts from Integrations.
**Gap:** per-source schema browsing / column-level config not exposed.

---

## Bottom line for leverage
- **Fully leveraged from the console:** gateway, connectors, LanceDB/Qdrant retrieval, Keycloak
  identity, Unleash flags, SeaweedFS storage, provenance, evals, analytics/finops, agents/studio.
- **Wire-and-it's-real (services running, env not set):** **Presidio** (guardrails) — highest-value
  quick win for the demo.
- **Start-the-service-then-wire:** OpenBao (secrets), Marquez (lineage), OpenSearch (SIEM).
- **Deeper native features not mirrored (by design or unbuilt):** Keycloak realm config, OPA Rego
  authoring, Unleash variants, FleetDM live-query, Superset dashboards, Temporal durable runs.

Not everything a service *can* do is reachable from the console — the console covers the operational
80% (the CRUD + actions an operator needs). The deep/admin tails live in each service's own admin UI
by design. The genuine build gaps are: Temporal durable runs, OPA Rego editor, FleetDM live-query,
Superset dashboard provisioning, and the aggregator cache/rate-limit tuning.
