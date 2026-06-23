# Integration catalog — every service: what · why · when · how to configure

The full inventory the console can run with. Each entry: **what** it is, **why/when** to use it,
and **how to configure** (compose profile → env → adapter id). The console works with **none** of
these (first-party defaults); each is an opt-in swap. All permissive-licensed — see `LICENSES.md`.

> Pattern for every swap: `cd deploy && make <profile>` → set `OFFGRID_ADAPTER_<CAP>=<id>` +
> the service URL in `.env.local` → restart the console → confirm in **Admin → Integrations ·
> adapters** (active + healthy). Remove the env var to revert to the first-party default.

---

## Required core

### Off Grid AI Gateway · `:7878` · first-party (external)

- **What:** the OpenAI-compatible, MCP-native, multimodal inference endpoint. The single egress.
- **Why:** every model call (chat, embeddings, grounding-NLI, vision) goes through it — the
  chokepoint where policy/guardrails/audit apply.
- **Configure:** `OFFGRID_GATEWAY_URL=http://127.0.0.1:7878`. Runs separately, never in compose.

### PostgreSQL + pgvector · `:5432` · PostgreSQL licence · profile `data`

- **What:** console state, the append-only audit log, AND the server-scale Brain vector store.
- **Why:** one durable store you already operate; pgvector serves the Brain at scale.
- **Configure:** `DATABASE_URL=…`; for the Brain set `OFFGRID_ADAPTER_RETRIEVAL=pgvector`.

---

## Data plane

### SeaweedFS · `:8333` · Apache-2.0 · profile `data`

- **What/why:** S3-compatible object store for documents/artifacts (the MinIO swap — permissive).
- **When:** you need raw/masked document zones or large-blob storage. **Configure:** `OFFGRID_SEAWEEDFS_URL`.

### Qdrant · `:6333` · Apache-2.0 · profile `ai`

- **What/why:** dedicated vector DB — an alternative Brain store for large fleets / high QPS.
- **When:** you outgrow LanceDB/pgvector. **Configure:** `OFFGRID_ADAPTER_RETRIEVAL=qdrant` + `OFFGRID_QDRANT_URL`.

---

## Secrets & identity

### OpenBao · `:8200` · MPL-2.0 · profile `secrets`

- **What/why:** KMS-backed secrets (KV v2) — the HashiCorp Vault swap, permissive.
- **When:** production secrets beyond env vars. **Configure:** `OFFGRID_ADAPTER_SECRETS=openbao` +
  `OFFGRID_OPENBAO_URL` + `OFFGRID_OPENBAO_TOKEN`.

### Keycloak · `:8080` · Apache-2.0 · profile `identity`

- **What/why:** full IAM — SSO / SAML / OIDC / federation. Default is Auth.js (Google/Entra).
- **When:** enterprise SSO/SAML, many realms. **Configure:** `OFFGRID_ADAPTER_IDENTITY=keycloak` +
  `OFFGRID_KEYCLOAK_URL`. Surfaced as a Tier-3 admin embed.

---

## Guardrails & policy

### Microsoft Presidio (analyzer `:5002` / anonymizer `:5001`) · MIT · profile `guardrails`

- **What/why:** production PII detection + anonymization. Default is the first-party regex checks.
- **When:** real PII/PHI workloads. **Configure:** `OFFGRID_ADAPTER_GUARDRAILS=presidio` + `OFFGRID_PRESIDIO_URL`.

### Open Policy Agent · `:8181` · Apache-2.0 · profile `policy`

- **What/why:** policy-as-code (Rego) decisions. Default is first-party RBAC + ABAC.
- **When:** complex authorization auditors recognize. **Configure:** `OFFGRID_ADAPTER_POLICY=opa` + `OFFGRID_OPA_URL`.

---

## Observability & tracing

### OpenTelemetry Collector · `:4318/:4317` · Apache-2.0 · profile `observability`

- **What/why:** one OTLP wire in, fans out to any backend. The seam `emitSpan` exports to.
- **Configure:** `OFFGRID_OTLP_URL=http://127.0.0.1:4318`. Config: `deploy/otel-collector.yaml`.

### VictoriaMetrics `:8428` / VictoriaLogs `:9428` · Apache-2.0 · profile `observability`

- **What/why:** metrics + logs backends (the Grafana/Loki swap — permissive, lightweight).
- **Configure:** `OFFGRID_SIGNOZ_URL` points dashboards at VictoriaMetrics; logs ingest via the collector.

### Jaeger · `:16686` · Apache-2.0 · profile `observability`

- **What/why:** distributed-trace backend — the queryable **app-layer trace UI** (spans incl. agent runs).
- **When:** you need to follow a request across steps/services. **Configure:** collector exports traces → Jaeger.

### Langfuse (+db) · `:3030` · MIT · profile `llmops`

- **What/why:** **LLM & agent tracing** — prompt/response, cost, sessions, prompt A/B, nested agent spans.
- **When:** content-level LLM observability + prompt management. **Configure:** `OFFGRID_ADAPTER_OBSERVABILITY=signoz`
  style + `OFFGRID_LANGFUSE_URL`. Tier-3 embed.

---

## Lineage, durability, infra

### OpenLineage + Marquez (+web `:3001`, api `:9000`, db) · Apache-2.0 · profile `lineage`

- **What/why:** dataset/job/run lineage — source→chunk→answer provenance as a queryable graph.
- **When:** regulators want lineage to source records. **Configure:** `OFFGRID_ADAPTER_LINEAGE=marquez` + `OFFGRID_MARQUEZ_URL`.

### Temporal (+ui `:8081`, server `:7233`, db) · MIT · profile `agents`

- **What/why:** durable workflow engine for long-running / multi-step agents.
- **When:** agents need retries, timers, durability. **Configure:** `OFFGRID_TEMPORAL_URL`.

### Redis · `:6379` · BSD-3 · profile `caching`

- **What/why:** scale backend for the response cache + rate limiting (first-party cache is in-process).
- **When:** multi-instance / high volume. **Configure:** `OFFGRID_ADAPTER_CACHING=redis` + `OFFGRID_REDIS_URL`.

### OpenSearch (+dashboards `:5601`) · `:9200` · Apache-2.0 · profile `siem`

- **What/why:** SIEM — full-text search + dashboards over the audit stream (the audit log ships here).
- **When:** security teams need search/alerting. **Configure:** `OFFGRID_OPENSEARCH_URL` (+ `_DASHBOARDS_URL`).

### Unleash (+db) · `:4242` · Apache-2.0 · profile `flags`

- **What/why:** feature-flag service — the backbone of modular capability/module control at scale.
- **When:** toggle modules/capabilities per tenant/env. **Configure:** `OFFGRID_ADAPTER_FLAGS=unleash` + `OFFGRID_UNLEASH_URL`.

### Apache Superset · `:8088` · Apache-2.0 · profile `bi`

- **What/why:** BI / data exploration — SQL Lab, charts, pivot/transpose, dashboards (the Metabase swap;
  Metabase is AGPL → embed-only). First run: `docker compose exec superset superset init`.
- **When:** analysts need to explore/transpose data. **Configure:** `OFFGRID_SUPERSET_URL`. Tier-3 embed.

---

## At a glance

| Capability          | Default (first-party) | OSS swap                                 | Profile                |
| ------------------- | --------------------- | ---------------------------------------- | ---------------------- |
| inference           | Off Grid Gateway      | —                                        | (external)             |
| retrieval           | LanceDB               | pgvector · Qdrant                        | data · ai              |
| secrets             | env                   | OpenBao                                  | secrets                |
| identity            | Auth.js               | Keycloak                                 | identity               |
| guardrails          | checks                | Presidio                                 | guardrails             |
| policy              | RBAC+ABAC             | OPA                                      | policy                 |
| observability       | OTLP no-op            | OTel→VictoriaMetrics · Jaeger · Langfuse | observability · llmops |
| lineage             | (emit)                | Marquez                                  | lineage                |
| caching             | in-process            | Redis                                    | caching                |
| siem                | audit store           | OpenSearch                               | siem                   |
| flags               | env                   | Unleash                                  | flags                  |
| bi                  | —                     | Superset (· Metabase embed)              | bi                     |
| agents (durability) | in-process            | Temporal                                 | agents                 |
