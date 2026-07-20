# Off Grid AI — the platform

> **Become an intelligent enterprise, without compromising.** On-prem · local-first · source-available · data never leaves the box. This is the canonical platform model — the spine of the public source. Visual map: [`platform-map.html`](./platform-map.html).

## The thesis (one sentence)
One **governed pipeline** is the unit of everything — it governs **model access AND data movement** under one policy/guardrail/redaction/eval contract; it runs on a **smart gateway** (routing + edge + its own telemetry); every run and every sync emits into **one shared spine** (observability · audit · lineage · provenance · cost · compliance), is **replayable end-to-end**, and an **org view** rolls the whole estate up.

## The layers
- **Org view** — roll-up across every pipeline/gateway/consumer: spend & chargeback, all traces/audit, every data flow + lineage graph, drift & data-quality, compliance coverage, fleet health, tenants. Drill into any pipeline's slice.
- **Consumers** (bind a pipeline) — Apps · Agents · Chat/Projects · **BI (Superset/PowerBI)** · external 3rd-parties via a provisioned key. Built by non-technical dept staff in plain language.
- **Pipeline** — THE governed unit, owns everything. Does **model-access** (grounded answers + citations) AND **data-movement** (connector→warehouse; batch/incremental/CDC). Same peripheries govern both: data-allowlist (hard ceiling), policy (ABAC/OPA), guardrails, **PII redaction on the sync path**, model evals+golden+drift, **data-quality evals (Great Expectations)**, routing/egress leash, schedule/CDC trigger, provisioned API key, versioning, **replay**. Per-pipeline lenses = its slice of the spine.
- **Gateway** — the smart network+model edge: smart routing (model pick/fallback/load-balance/egress leash) + edge functions (Caddy: WAF, rate-limit, cache, TLS, per-tenant URL) + its OWN observability/logs.
- **Substrate — two engines:** the **model engine** (llama.cpp fleet + cloud, OpenAI-compat — LIVE) and the **data engine** (Airbyte + Redpanda + ClickHouse + dbt + Great Expectations — **LIVE on S2, 2026-07-08**; the AWS-data-stack parity map is [`DATA_PLANE_PARITY.md`](./DATA_PLANE_PARITY.md)).
- **The spine** (run OR sync = the join key): Observability (Langfuse) · Audit/SIEM (OpenSearch) · Lineage (Marquez) · Provenance + Citations · FinOps/Cost · Regulatory (ISO 42001 / NIST / EU AI Act).
- **Cross-cutting:** Identity (Keycloak) · Secrets (OpenBao) · Multi-tenancy · Flags (Unleash) · Fleet/MDM (FleetDM) · Storage (SeaweedFS) · Knowledge/Brain (Qdrant/LanceDB) · Backups/DR.

## The OSS stack (permissive licences — moat is ownership + air-gap, not secrecy)
| Capability | Engine | Status |
|---|---|---|
| Model gateway | llama.cpp fleet + OpenAI-compat | live |
| Warehouse (Snowflake/Databricks-equiv) | ClickHouse | **live on S2** |
| Connectors + ELT (Glue-equiv) | Airbyte (300+) | **live on S2** |
| CDC (DMS-equiv) | Debezium (via Airbyte) | **live on S2** |
| Streaming / MQ | Redpanda (Kafka API) | **live on S2** |
| Transforms | dbt | job/CLI |
| Data-quality evals | Great Expectations | **live on S2** |
| PII redaction | Presidio | live |
| Model evals / drift | ragas · deepeval · Evidently | live |
| Observability | Langfuse | live |
| Audit / SIEM | OpenSearch | live |
| Lineage | Marquez (OpenLineage) | live |
| Policy | OPA (ABAC) | live |
| Secrets · Identity · Durable runs | OpenBao · Keycloak · Temporal | live |
| Flags · MDM · BI · Object store | Unleash · FleetDM · Superset · SeaweedFS | live |

## Experience principle (the product bet)
The platform must feel **beautiful and effortless** — creating and deploying a governed use-case is the core loop, and it should be a joy, not a config chore. Two pillars:
1. **A LOT of prebuilt pipelines** — a rich, curated library of ready-to-run governed use-cases (BFSI: KYC, loan underwriting, fraud, FNOL, reimbursement, cross-sell; ETL: connector→warehouse syncs; plus general). Clone → tweak in plain language → deploy. The library is the fastest path to value and the showcase of the platform.
2. **Plain-language authoring** — describe the use-case in English; the platform wires the pipeline (gateway binding, data allowlist, guardrails, steps, schedule). Non-technical dept staff are the acceptance bar.

## Fleet
10 machines: **S1** control-plane · **S2** data-plane (Airbyte/ClickHouse/Redpanda/GE — **LIVE under OrbStack**, fronted on S1 edge loopbacks 8941–8944) · **g1–g8** model nodes.

## Positioning
"A private AI, everywhere" + the governed data platform under it. Fair-code: free for up to 25 users; larger deployments require a commercial license.
