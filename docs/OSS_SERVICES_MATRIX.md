# Off Grid Console — OSS Services Matrix

**What this is:** every open-source service we run on the on-prem fleet, what it's *for*, the
APIs/functionality it exposes, the purpose of that functionality, and — the important column —
**what the console actually consumes today vs. what's still available to wire up.**

Legend for integration depth:
- 🟢 **Deep / active** — the console calls it in-path on real requests (or reads its data back into a console view).
- 🟡 **Partial** — one direction only (write-only sink, or read-only), or built-but-not-default.
- ⚪ **Available, not active** — implemented/reachable but not selected in the current deployment.
- 🔴 **Not integrated** — running (or scaffolded) but the console doesn't use it yet.

Where they run: **S1 (127.0.0.1)** — OpenSearch, Qdrant, OPA, OpenBao, Marquez, Temporal, Postgres, Keycloak.
**S2 (192.168.1.60)** — Langfuse, Superset, FleetDM, Presidio, Unleash, Redis.

---

## Summary matrix

| Service | Purpose | Console integration | Depth |
|---|---|---|---|
| **Postgres/pgvector** | Console state + append-only audit + vector store | All module state, audit, FinOps, agent runs, chat | 🟢 |
| **Keycloak** | Identity / SSO (OIDC) | The login path; `@example.com` restricted | 🟢 |
| **OPA** | Policy-as-code decisions | `POST /v1/data/offgrid/authz` per agent run + fallback | 🟢 |
| **Presidio** | PII detection / redaction | `/analyze` per request; redaction is regex (not `/anonymize`) | 🟢 / 🟡 |
| **Redis** | Response cache + rate limiting | get/set response cache (active) | 🟢 |
| **Unleash** | Feature flags | flag lookups gate sandbox/evals (active) | 🟢 |
| **OpenSearch** | SIEM — audit/log search | `_bulk` ingest (audit + gateway calls) **and** `_search` read-back (Audit search on Control) | 🟢 |
| **Langfuse** | LLM tracing + scores | OTLP + score push **and** trace/waterfall read-back on Observability | 🟢 |
| **Marquez** | Data lineage (OpenLineage) | emit events **and** job→dataset graph read-back on Lineage | 🟢 |
| **OpenBao** | Secrets vault (KV) | KV read/write/list + Secrets panel on Control | 🟢 |
| **Qdrant** | Vector store (Brain) | full client + "reindex Brain→Qdrant"; default is LanceDB | ⚪ |
| **Superset** | BI / dashboards | guest-token embed on Analytics (needs one-time `superset init`) | 🟡 |
| **FleetDM** | MDM / device inventory | read-only host list via REST+token | 🟡 |
| **Temporal** | Durable workflows | adapter scaffold only; agent runs stay synchronous | 🔴 |

---

## Per-service detail

### Postgres + pgvector — state, audit, vector
**Purpose:** the console's system of record. Holds every module's data, the append-only audit log
(source of truth), and — via pgvector — a server-scale vector option for the Brain.
**Exposed:** SQL (Drizzle ORM), pgvector similarity search.
**Console consumes:** everything — fleet/control/data/agents/chat/projects/knowledge state, audit
events (which feed Analytics/FinOps/Regulatory), agent-run traces. **🟢 fully used.**

### Keycloak — identity / SSO
**Purpose:** who can log in. OIDC realm `offgrid`, restricted to `@example.com`.
**Exposed:** OIDC (authorize/token/userinfo), admin API, SCIM.
**Console consumes:** the sign-in flow (NextAuth → Keycloak). Roles come from the user record.
**Available, not wired:** SCIM group→role auto-provisioning (stub endpoint exists). **🟢.**

### OPA — policy-as-code
**Purpose:** centralized allow/deny decisions (RBAC/ABAC) evaluated as code.
**Exposed:** `POST /v1/data/<pkg>` (decisions), policy bundles, decision logs, metrics.
**Console consumes:** `POST /v1/data/offgrid/authz` with `{input}` on **every agent run**; falls back
to the first-party ABAC evaluator if OPA is unreachable.
**Not used:** bundle delivery/auto-update, decision-log streaming. **🟢 active.**

### Presidio — PII detection / redaction
**Purpose:** find (and mask) personal data in prompts/outputs — a guardrail.
**Exposed:** `POST /analyze` (entity detection), `POST /anonymize` (ML redaction), custom recognizers.
**Console consumes:** `POST /analyze` in-path on every request (pre-input + post-output), reports the
entity types found; falls back to a regex detector.
**Not used:** `/anonymize` (redaction is done with regex string-replace, not Presidio's ML),
custom recognizers, non-English languages. **🟢 detect / 🟡 redact.**

### Redis — response cache
**Purpose:** exact/semantic response cache in front of the gateway → lower latency & cost.
**Exposed:** GET/SET/TTL, INCR (rate limits), pub/sub, transactions.
**Console consumes:** get/set response cache with write-through to an in-process fallback.
**Not used:** INCR rate-limiting, pub/sub. **🟢 active.**

### Unleash — feature flags
**Purpose:** toggle capabilities without redeploying; gate features per environment.
**Exposed:** `/api/frontend/features`, strategies (gradual/percentage), segments, variants, metrics.
**Console consumes:** flag lookups (e.g. `agent-code-exec`, `online-evals`) with Postgres fallback.
**Not used:** strategies, segments, A/B variants. **🟢 active.**

### OpenSearch — SIEM
**Purpose:** durable, full-text-searchable audit/log store + dashboards.
**Exposed:** `_bulk` (ingest), `_search` (query + filters), aggregations, alerting, Dashboards UI.
**Console consumes:** ships the audit log via `_bulk`; **the gateway aggregator now indexes every
model call** into `offgrid-gateway`; and there's a **SIEM search read-back** ("Audit search" on the
Control page) that queries `_search`. Dashboards embeddable via the embed guard.
**Not used:** aggregations/faceting, watcher alerting. **🟢.**

### Langfuse — LLM tracing
**Purpose:** trace every model/agent step, score answer quality, track per-trace cost.
**Exposed:** OTLP ingest, ingestion API (traces+scores), `/api/public/traces` + `/observations`
(query), cost API.
**Console consumes:** pushes OTLP spans per agent step + LLM-as-judge scores; **reads traces back**
into an expandable list + **span waterfall** on Observability.
**Not used:** per-trace cost rollups into FinOps. **🟢.**

### Marquez — data lineage (OpenLineage)
**Purpose:** source → chunk → answer provenance; what data produced what output.
**Exposed:** `POST /api/v1/lineage` (emit), `/namespaces`, `/jobs`, `/datasets`, lineage graph query.
**Console consumes:** emits OpenLineage events on ingest/retrieve/agent-run; **reads the job→dataset
graph back** into the Lineage page (alongside the audit-reconstructed view).
**🟢.**

### OpenBao — secrets vault
**Purpose:** store connector/tool/API-key secrets encrypted, out of env files.
**Exposed:** KV v2 read/write/list, dynamic secrets, transit encryption, PKI, audit.
**Console consumes:** KV read/write/list via the secrets adapter, with a **Secrets Vault panel** on
Control; `getSecrets()` now has real call sites.
**Not used:** dynamic secrets, transit/PKI, lease rotation. **🟢 (KV).**

### Qdrant — vector store
**Purpose:** server-scale vector search for the Brain (alternative to embedded LanceDB).
**Exposed:** collections, upsert, search, scroll, snapshots, quantization.
**Console consumes:** full client (`ensureCollection`/upsert/search/scroll) + a **"Reindex Brain →
Qdrant"** admin action so it's not empty. **Not the default** — activate with
`OFFGRID_ADAPTER_RETRIEVAL=qdrant` (default is LanceDB).
**Not used:** batch ops, quantization, sharding. **⚪ available, not active.**

### Superset — BI / dashboards
**Purpose:** dashboards, SQL Lab, pivot/exploration over console data.
**Exposed:** dashboards, `/api/v1/chart|dataset|sqllab`, guest-token embedded SDK.
**Console consumes:** mints a **guest token** and embeds a Superset dashboard on Analytics (behind
the embed guard). **Requires a one-time `superset init`** (admin + metadata) to show real data.
**Not used:** SQL Lab, dataset provisioning. **🟡.**

### FleetDM — MDM / device management
**Purpose:** osquery-based cross-platform device inventory, policies, live queries.
**Exposed:** hosts, teams/policies, live queries, software/vuln inventory, MDM profiles.
**Console consumes:** **read-only host list** via REST + bearer token on the Fleet page, with
first-party fallback. **Requires a one-time `fleetctl setup`.**
**Not used:** policy push, live queries, software inventory, MDM enrollment. **🟡.**

### Temporal — durable workflows
**Purpose:** durable, replayable multi-step agent execution (survives crashes).
**Exposed:** workflow/activity execution, retries, replay, `:7233` gRPC + `:8081` UI.
**Console consumes:** an **`AgentRuntimePort` adapter scaffold** exists (`syncRuntime` default;
`temporalRuntime` submits via HTTP bridge if configured). Agent runs are currently **synchronous /
Postgres-backed** — Temporal is not authoritative yet. **🔴 scaffold only.**

---

## The honest bottom line
- **Governance + observability + knowledge are genuinely wired both ways** now: OPA, Presidio,
  Redis, Unleash run in-path; OpenSearch/Langfuse/Marquez both write *and* read back into console
  views; OpenBao is a real secrets store.
- **Qdrant** is ready but the deployment defaults to embedded LanceDB — flip one env var to use it.
- **Superset / FleetDM** need their one-time init to show live data; they're read/embed-only.
- **Temporal** is the one still-open integration — scaffolded, not consuming.

_This matrix reflects state after the integration-deepening pass (Phase 8) + parity Waves 0–2.
Update it when an adapter changes depth._
