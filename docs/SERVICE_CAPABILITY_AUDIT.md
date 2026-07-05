# Underlying-service capability audit — VERIFIED (2026-07-05)

For every integrated service: what it can do, and **how much the console actually uses** — graded by
reading the real `fetch()` calls, not by claims. Five parallel code audits (file:line-cited) replaced
the earlier optimistic self-assessment. **Bottom line: of 14 real integrations, only 2 are genuinely
DEEP.** The console is a *wide, honest* CRUD/ops surface that leans on the operational slice of each
service — deep almost nowhere, and outright scaffold on four.

**Legend:** 🟢 DEEP (uses most core functionality) · 🟡 PARTIAL · 🟠 SHALLOW (only touches it) ·
🔴 SCAFFOLD (wired but inert / first-party engine does the real work).

## Verified scorecard

| Service | Verdict | Actually used → the gap |
|---|---|---|
| **SeaweedFS** | 🟢 DEEP | Full S3 CRUD + metadata + visibility (copy-onto-self). The only file store, genuinely real. Missing: presigned URLs, lifecycle (non-critical). |
| **Langfuse** | 🟢 DEEP | Emits OTLP spans + chat traces, ingests scores, **reads the trace waterfall back**. Missing: prompt registry, datasets, sessions CRUD. |
| **AI Gateway / aggregator** | 🟡 PARTIAL | Chat/vision/TTS/STT/image/models/traffic used. **Node control (swap/restart/enable) returns 501** — aggregator exposes no control endpoint. No fallback/cache control. (Rate-limit is Caddy's job — see below — NOT a gap here.) |
| **Keycloak** | 🟡 PARTIAL | Real user/role/client lifecycle **+ client-secret rotation** (`keycloak-admin.ts`). Missing: IdP federation, MFA policy, realm/session/token-lifetime config. |
| **OpenSearch** | 🟡 PARTIAL | `_bulk` ship + full-text search + term filters. ⚠️ **All aggregations computed in JS after fetching ≤5000 docs** — OpenSearch's own `aggs`/dashboards/alerting/ISM unused. Correctness/scale problem, not just a missing feature. |
| **Marquez / OpenLineage** | 🟡 PARTIAL | Runtime emits basic run events (`brain.ingest`, `brain.retrieve`) + reads graph + creates namespaces. Missing: facets, column lineage, tagging from the console; append-only. |
| **Qdrant / LanceDB** | 🟠 SHALLOW | Vector ANN only. **No metadata filtering, no hybrid/BM25 search**, no payload updates, no reindex/snapshots; `scroll` capped at 1000 (large collections truncated). Hurts RAG quality. |
| **OpenBao** | 🟠 SHALLOW | Thin KV v2 CRUD + seal/mount status view. Missing: dynamic secrets, rotation, leases, auth methods, seal/unseal ops, policies. |
| **Presidio** | 🟠 SHALLOW | `/analyze` + optional `/anonymize` (else local redaction). Missing: custom recognizers, deny lists, per-entity/threshold tuning, ad-hoc recognizers. |
| **Unleash** | 🟠 SHALLOW | **Read-only flag evaluation** (`/api/frontend/features`). The flag CRUD in the console writes to **first-party Postgres, not Unleash**. Missing: real Unleash CRUD, variants, gradual rollout, segments, environments. |
| **OPA** | 🔴 SCAFFOLD | Read-only decision calls + pushes console ABAC as **JSON, not Rego**. First-party ABAC is the real engine; OPA is an optional accelerator. No Rego authoring/bundles/analysis. |
| **Superset** | 🔴 SCAFFOLD | Mints a guest token for **one pre-provisioned dashboard UUID that may not exist** (mints 200 even for a ghost → blank iframe). No SQL Lab, no dashboard/dataset provisioning. |
| **FleetDM** | 🔴 SCAFFOLD | **List hosts + health only.** Device command/policy/audit routes hit the **first-party Postgres registry**, not FleetDM. `/fleet-control` advertises live-query/software-inventory/patch — none reachable. |
| **Temporal** | 🔴 SCAFFOLD | Fire-and-forget HTTP POST that's **never polled**; `runAgent()` runs 100% synchronously in-process; `getAgentRuntime()` used only by a health probe. "Durable workflows" doesn't exist. |

**Tally: 2 DEEP · 4 PARTIAL · 4 SHALLOW · 4 SCAFFOLD.**

## Two kinds of gap (they're not equal)

1. **Legitimate ports-and-adapters design** — OPA, Unleash, and partly OpenBao/secrets read 🟠/🔴
   on the *branded service* because the console runs a **first-party engine by default** (first-party
   ABAC, first-party flags) with the OSS tool as a swap-in. The *feature* works; it just isn't powered
   by the named service. Defensible architecture, not vaporware.
2. **Genuine demo-theater / gaps** — **Temporal** (no async execution at all), **FleetDM live-query**
   (UI advertises capabilities that don't exist), **Superset** (ghost dashboard), plus two quality
   gaps: **vector search has no filtering/hybrid** (hurts RAG) and **OpenSearch aggregations run in JS**
   (won't scale). These are the ones to build or stop claiming.

## Was this missed, or known?

**Largely known, then falsely marked done.** ROADMAP Phase 4 ("OSS feature parity") is exactly about
this ("services wired as write-only sinks… close every gap"), and its per-service table listed
Temporal durable runs, FleetDM live-query, OpenSearch aggregation, Unleash variants, Presidio
recognizers. **But it was declared "largely complete" (line 469) and blamed remaining work on "S2
offline"** — both untrue: the deep work is still scaffold, and the services are up on S1/g6.
**Genuinely missed:** vector filtering/hybrid search, the OpenSearch-aggregation-in-JS scale problem,
the Superset ghost-dashboard silent failure.

## Correction — rate limiting is Caddy's job
The **Caddy edge gateway** (`gateway.getoffgridai.co`) does rate limiting + WAF; the Next.js
middleware adds a 60/min per-IP layer. So the aggregator having no rate-limit endpoint is **by design**,
not a gap. (Recorded in memory `reference-caddy-edge-gateway`.)

## What's genuinely DEEP and demo-safe
Chat, Knowledge, Storage (SeaweedFS), Gateway inference, Analytics, FinOps, Provenance, Access
(Keycloak lifecycle), Secrets (OpenBao KV), Evals, Agents + real run traces, Integrations, Policy/ABAC,
Guardrails (regex), Observability (Langfuse). **Avoid/caveat in a demo:** `/fleet-control` (FleetDM
live-query), anything framed "durable/Temporal", the Superset embed (verify the UUID), Lineage + SIEM
(sparse), Sandbox.
