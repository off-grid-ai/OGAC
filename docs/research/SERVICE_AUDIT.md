# Service Audit — Off Grid Console OSS Stack

**Date:** 2026-07-02  
**Method:** Read `deploy/docker-compose.yml`, `docs/OSS_SERVICES_MATRIX.md`, `docs/OSS_CAPABILITY_AUDIT.md`, then grep `src/` for hostnames, env vars, and client imports.  
**Note on resource limits:** The compose file defines **no** `mem_limit`, `cpus`, or `deploy.resources` constraints on any service. All RAM/CPU figures below are real-world typical ranges from public documentation, not enforced limits.

---

## Summary Table

| Service | Profile (always-on?) | Console calls it? | Safe to turn off today? | One-time setup needed? |
|---|---|---|---|---|
| **Postgres** | `data,ai,all` — core dep | Yes — Drizzle ORM, all state | No — everything breaks | Run `drizzle-kit migrate` on first boot |
| **Keycloak** | `identity,all` | Yes — login path via NextAuth | No — no one can sign in | Realm auto-imported via `--import-realm`; none |
| **OPA** | `policy,all` | Yes — `POST /v1/data/offgrid/authz` per agent run | Soft-yes — first-party ABAC fallback kicks in | Load Rego policies (no bundle delivery wired yet) |
| **OpenBao** | `secrets,all` | Yes — KV read/write/list via `secrets.ts` | Soft-yes — throws if URL unset, Secrets panel breaks | Dev token auto-configured; prod needs proper auth method |
| **Qdrant** | `ai,all` | Yes — client exists; **not the default** | Yes — LanceDB is default; reindex action just fails | Set `OFFGRID_ADAPTER_RETRIEVAL=qdrant`; run reindex |
| **OpenSearch** | `siem,all` | Yes — `_bulk` audit ingest + `_search` read-back | No — Audit search, gateway logs/analytics/finops views break | None (auto-creates indexes on first write) |
| **OpenSearch Dashboards** | `siem,all` | Embed URL referenced in `services.ts` | Yes — console never deep-links into Dashboards | None |
| **Marquez** | `lineage,all` | Yes — emits OpenLineage events + reads graph back | Soft-yes — lineage page empty; app continues | None (DB auto-migrated by Marquez on start) |
| **Temporal** | `agents,all` | Scaffold only — no real calls today | Yes — agent runs stay synchronous without it | Wire `OFFGRID_TEMPORAL_HTTP_URL`; start a worker |
| **Langfuse** (all 6) | `llmops,all` | Yes — OTLP spans + score push + trace read-back | Soft-yes — Observability page empty; no LLM tracing | Headless bootstrap in compose env; none |
| **Superset** | `bi,all` | Yes — guest-token minted on Analytics page | Soft-yes — Analytics page shows empty embed | `docker compose exec superset superset init` |
| **FleetDM** | `mdm,all` | Yes — reads host list via REST | Soft-yes — Fleet page falls back to native device list | `fleetctl setup` + set `OFFGRID_FLEET_TOKEN` |
| **Presidio analyzer** | `guardrails,all` | Yes — `/analyze` in-path on every request | Soft-yes — falls back to regex detector | None |
| **Presidio anonymizer** | `guardrails,all` | No — `/anonymize` not called (regex redact used) | Yes — fully safe | None |
| **Unleash** | `flags,all` | Yes — flag lookups in `flags.ts` | Soft-yes — Postgres fallback for flags | None (DB auto-migrated) |
| **Redis** | `caching,all` | Yes — response cache GET/SET via `cache.ts` | Soft-yes — in-process fallback activates | None |
| **Caddy** | Not in compose (runs native) | Indirectly — fronts gateway + console | No — edge routing breaks | Native install; config in `Caddyfile` |
| **SeaweedFS** | `data,all` | No — zero src/ references | Yes — nothing uses it | Provision buckets + wire `OFFGRID_SEAWEED_URL` |
| **VictoriaMetrics** | `observability,all` | No — zero src/ references | Yes — nothing uses it | Wire OTLP metrics endpoint |
| **VictoriaLogs** | `observability,all` | No — zero src/ references | Yes — nothing uses it | Wire log export |
| **OTel Collector** | `observability,all` | No — console pushes traces directly to Langfuse OTLP | Yes — nothing routes through it | Config `otel-collector.yaml` must exist |
| **Jaeger** | `observability,all` | No — zero src/ references | Yes — nothing uses it | None |
| **Evidently** | `qa,all` | Adapter exists (`drift.ts`); **only if `OFFGRID_EVIDENTLY_URL` set** | Yes — PSI drift runs natively | None (Python sidecar; `sidecars/drift/` must build) |
| **Ragas** | `qa,all` | Adapter exists (`evals.ts`); **only if `OFFGRID_RAGAS_URL` set** | Yes — golden-set evals run natively | None (Python sidecar; `sidecars/ragas/` must build) |

---

## Per-Service Detail

### Postgres + pgvector

**Profile:** `data, ai, all`  
**Image:** `pgvector/pgvector:0.8.0-pg16`  
**Ports:** `5432`  
**RAM/CPU:** ~100–300 MB idle; ~512 MB under moderate write load. No compose limit set.

**Console calls it?** Yes, deeply.  
Evidence: `src/db/index.ts`, `src/lib/store.ts`, `src/lib/agentrun.ts`, `src/lib/evals.ts`, `src/lib/token-budgets.ts`, `src/lib/org-knowledge.ts`, `src/lib/prompts.ts` — virtually every lib file touches Drizzle ORM. Also the `drizzle/` migration directory in the working tree.

**Safe to turn off?** No. Postgres is the console's system of record: all module state, audit log, FinOps data, agent runs, chat history, flag fallback. Turning it off kills the entire app.

**What breaks:** Everything — app won't start, no auth, no data.

**One-time setup:** Run Drizzle migrations (`drizzle-kit migrate` or equivalent). The `drizzle/` directory exists but migrations must be applied on first boot or after schema changes. The compose healthcheck ensures it's ready before dependents start.

---

### Keycloak

**Profile:** `identity, all`  
**Image:** `quay.io/keycloak/keycloak:26.0.7`  
**Ports:** `8080`  
**RAM/CPU:** ~400–700 MB (JVM). No compose limit set.

**Console calls it?** Yes — the sign-in path.  
Evidence: `src/auth.config.ts` configures NextAuth with Keycloak OIDC. `src/lib/keycloak-admin.ts` provides admin API calls used by the new access management routes (`src/app/api/v1/admin/access/`). `src/app/(console)/access/page.tsx` is a full UI for managing users, roles, and machine clients.

**Safe to turn off?** No. Without Keycloak, `NEXTAUTH_URL` configuration fails and nobody can log in.

**What breaks:** Authentication entirely.

**One-time setup:** None in dev — the realm is auto-imported from `deploy/keycloak/offgrid-realm.json` via `--import-realm`. In production: back with real Postgres, remove hardcoded dev secret, configure proper TLS.

---

### OPA (Open Policy Agent)

**Profile:** `policy, all`  
**Image:** `openpolicyagent/opa:0.70.0`  
**Ports:** `8181`  
**RAM/CPU:** ~50–150 MB. No compose limit set.

**Console calls it?** Yes — in-path on agent runs.  
Evidence: `src/lib/adapters/policy.ts` — `fetch(\`${url}/v1/data/offgrid/authz\`, ...)` called per agent run. `src/lib/adapters/services.ts` references `env.OFFGRID_OPA_URL` for health pings and embed URL.

**Safe to turn off?** Soft-yes. The adapter has an explicit first-party ABAC fallback (`src/app/api/v1/admin/abac/evaluate/route.ts`). Agent authz continues working, just via the in-process evaluator.

**What breaks:** The OPA-backed policy decision path. The Control page health widget shows it as down.

**One-time setup:** Rego policies must be loaded (currently run via `opa run --server`; no bundle delivery is wired so policies must be posted manually or baked into the image). No automated bundle fetch configured.

---

### OpenBao

**Profile:** `secrets, all`  
**Image:** `openbao/openbao:2.1.0`  
**Ports:** `8200`  
**RAM/CPU:** ~80–200 MB. No compose limit set.

**Console calls it?** Yes — KV read/write/list.  
Evidence: `src/lib/adapters/secrets.ts` — `BAO_URL = process.env.OFFGRID_OPENBAO_URL`, calls `${BAO_URL}/v1/secret/data/...`. `src/components/control/SecretsPanel.tsx` + `src/app/(console)/control/page.tsx` render the Secrets Vault panel.

**Safe to turn off?** Soft-yes. The adapter throws with a clear error when `OFFGRID_OPENBAO_URL` is unset; the Secrets panel breaks but no other path depends on it.

**What breaks:** Secrets Vault panel on Control. Any connector that stores credentials in OpenBao.

**One-time setup:** Dev mode uses `BAO_DEV_ROOT_TOKEN_ID: offgrid-dev-token` (auto-unsealed, in-memory). For production: remove dev token, configure a real auth method (AppRole at minimum), enable audit device, create proper ACL policies.

---

### Qdrant

**Profile:** `ai, all`  
**Image:** `qdrant/qdrant:v1.12.5`  
**Ports:** `6333`  
**RAM/CPU:** ~200–500 MB depending on collection size. No compose limit set.

**Console calls it?** Yes — client exists and is imported; **not the active default**.  
Evidence: `src/lib/qdrant.ts`, `src/app/api/v1/vectordb/route.ts`, `src/app/api/v1/admin/reindex/route.ts`, `src/components/data/VectorDBInspector.tsx`, `src/components/data/ReindexQdrantButton.tsx`, `src/lib/adapters/services.ts` (health ping on `OFFGRID_QDRANT_URL`). The default retrieval adapter is LanceDB (embedded); Qdrant activates via `OFFGRID_ADAPTER_RETRIEVAL=qdrant`.

**Safe to turn off?** Yes, if `OFFGRID_ADAPTER_RETRIEVAL` is not `qdrant`. The Vector DB Inspector page and Reindex button will fail, but brain search works via LanceDB.

**What breaks:** Vector DB Inspector page, Reindex to Qdrant action. Brain search continues via LanceDB.

**One-time setup:** Set `OFFGRID_ADAPTER_RETRIEVAL=qdrant` and run the "Reindex Brain → Qdrant" admin action to populate the collection.

---

### OpenSearch

**Profile:** `siem, all`  
**Image:** `opensearchproject/opensearch:2.18.0`  
**Ports:** `9200`  
**RAM/CPU:** 512 MB heap (`OPENSEARCH_JAVA_OPTS: '-Xms512m -Xmx512m'`); typically 1–1.5 GB RSS total. `memlock: -1` set.

**Console calls it?** Yes — both write and read.  
Evidence: `src/lib/siem.ts` ships audit events via `_bulk` to `OFFGRID_OPENSEARCH_URL`. `src/app/api/v1/gateway/analytics/route.ts`, `src/app/api/v1/gateway/logs/route.ts`, `src/app/api/v1/gateway/finops/route.ts`, `src/app/api/v1/prompts/common/route.ts`, `src/lib/token-budgets.ts` all do `_search` queries against OpenSearch. `src/components/control/AuditSearch.tsx` drives the search read-back on Control.

**Safe to turn off?** No — too many read paths depend on it. Gateway analytics, gateway logs, FinOps charts, token budget enforcement, and audit search all break.

**What breaks:** Control > Audit Search, gateway analytics/logs/finops API routes, token budget read-back.

**One-time setup:** None. Indexes are created automatically on first `_bulk` write (dynamic mapping). For production: enable ISM lifecycle policies to prevent unbounded disk growth.

---

### OpenSearch Dashboards

**Profile:** `siem, all`  
**Image:** `opensearchproject/opensearch-dashboards:2.18.0`  
**Ports:** `5601`  
**RAM/CPU:** ~300–600 MB. No compose limit set.

**Console calls it?** No direct API calls — only referenced as an embed URL.  
Evidence: `src/lib/adapters/services.ts` stores `env.OFFGRID_OPENSEARCH_DASHBOARDS_URL` as `embedUrl` for the service health registry. The console does not construct any requests into Dashboards.

**Safe to turn off?** Yes. The console shows a health-widget entry for it, but no feature depends on Dashboards being up.

**What breaks:** The Dashboards embed URL goes dead. Nothing functional.

**One-time setup:** None beyond having OpenSearch running.

---

### Marquez (+ marquez-db + marquez-web)

**Profile:** `lineage, all`  
**Images:** `marquezproject/marquez:0.50.0`, `postgres:16.6-alpine`, `marquezproject/marquez-web:0.50.0`  
**Ports:** `9000` (API), `5010` (admin), `3001` (web UI)  
**RAM/CPU:** Marquez ~200–400 MB; its Postgres ~100–200 MB; web ~50 MB. No compose limits.

**Console calls it?** Yes — emits events and reads the graph.  
Evidence: `src/lib/marquez.ts` — `POST /api/v1/lineage` for OpenLineage events. `src/lib/adapters/lineage.ts` — reads lineage graph. `src/components/observability/MarquezGraph.tsx` + `src/app/api/v1/admin/lineage-graph/route.ts` render the Lineage page. `src/lib/adapters/services.ts` health-pings `env.OFFGRID_MARQUEZ_URL`.

**Safe to turn off?** Soft-yes. Lineage events are fire-and-forget; the Lineage page goes empty but the app continues.

**What breaks:** Lineage page shows no graph. OpenLineage events are dropped.

**One-time setup:** None. Marquez auto-migrates its Postgres DB on start.

---

### Temporal (+ temporal-db + temporal-ui)

**Profile:** `agents, all`  
**Images:** `temporalio/auto-setup:1.25.2`, `postgres:16.6-alpine`, `temporalio/ui:2.32.0`  
**Ports:** `7233` (gRPC), `8081` (UI)  
**RAM/CPU:** Temporal server ~300–600 MB; its Postgres ~100 MB; UI ~50 MB. No compose limits.

**Console calls it?** Scaffold only — no real calls today.  
Evidence: `src/lib/adapters/agentruntime.ts` — `TEMPORAL_HTTP = process.env.OFFGRID_TEMPORAL_HTTP_URL`; the adapter logs "running sync" if the HTTP bridge URL is absent (which it is in practice). `src/lib/agentrun.ts` uses synchronous/Postgres-backed execution. The `gateway/queue` enqueue path exists but is a dynamic import.

**Safe to turn off?** Yes. Agent runs continue synchronously. Nothing observable changes for users.

**What breaks:** Nothing currently. The Temporal UI embed link on Control goes dead.

**One-time setup:** To activate: set `OFFGRID_TEMPORAL_HTTP_URL`, implement and register a Temporal worker with `startQueueWorker`, switch `agentruntime` adapter selection. The compose sets up the DB automatically via `auto-setup`.

---

### Langfuse (langfuse + langfuse-worker + langfuse-db + langfuse-clickhouse + langfuse-minio + langfuse-redis)

**Profile:** `llmops, all`  
**Images:** `langfuse/langfuse:3.30.0`, `langfuse/langfuse-worker:3.30.0`, `postgres:16.6-alpine`, `clickhouse/clickhouse-server:24.8-alpine`, `minio/minio:RELEASE.2024-11-07T00-52-20Z`, `redis:7.4-alpine`  
**Ports:** `3030` (web), internal only for worker/db/clickhouse/minio/redis  
**RAM/CPU:** ClickHouse alone ~500 MB–1 GB; full stack ~1.5–2.5 GB aggregate. No compose limits except ClickHouse `ulimits.nofile`.

**Console calls it?** Yes — OTLP ingest and read-back.  
Evidence: `src/lib/otel.ts` — `LANGFUSE_OTLP_URL = process.env.OFFGRID_LANGFUSE_OTLP_URL`; pushes OTLP spans. `src/lib/langfuse.ts` and `src/lib/chat-trace.ts` — use `OFFGRID_LANGFUSE_URL` / `PUBLIC_KEY` / `SECRET_KEY` for the ingestion and public APIs. `src/lib/qa/scoring.ts` pushes LLM-judge scores. `src/components/observability/LangfuseTraces.tsx` + `src/app/api/v1/admin/traces/` read traces back into the Observability page.

**Safe to turn off?** Soft-yes. No tracing is collected; the Observability page shows nothing. The rest of the app works.

**What breaks:** Observability > Traces page goes empty. No LLM tracing, no span waterfalls, no score history.

**One-time setup:** Headless bootstrap fully wired in compose env (`LANGFUSE_INIT_ORG_ID`, `LANGFUSE_INIT_PROJECT_PUBLIC_KEY`, `LANGFUSE_INIT_PROJECT_SECRET_KEY`, etc.). No manual click-through needed. The MinIO bucket `langfuse` is pre-created by the entrypoint command.

---

### Superset

**Profile:** `bi, all`  
**Image:** `apache/superset:4.1.1`  
**Ports:** `8088`  
**RAM/CPU:** ~400–800 MB. No compose limit set.

**Console calls it?** Yes — mints a guest token.  
Evidence: `src/lib/superset.ts`, `src/app/api/v1/admin/superset-token/route.ts`, `src/app/(console)/analytics/page.tsx` embeds the dashboard via guest token. `src/lib/adapters/services.ts` health-pings `OFFGRID_SUPERSET_URL`.

**Safe to turn off?** Soft-yes. The Analytics page will have an empty/broken embed but no other paths fail.

**What breaks:** Embedded Superset dashboard on Analytics.

**One-time setup:** `docker compose exec superset superset init` — creates the admin user and metadata DB tables. Without this, the guest-token endpoint returns 401 and the embed is blank. Also requires manually creating a dataset pointing at Postgres and a dashboard to embed.

---

### FleetDM (fleet + fleet-mysql + fleet-redis)

**Profile:** `mdm, all`  
**Images:** `fleetdm/fleet:v4.87.0`, `mysql:8.0.40`, `redis:7.4-alpine`  
**Ports:** `8070`  
**RAM/CPU:** Fleet ~200–400 MB; MySQL ~300–500 MB; Redis ~30 MB. No compose limits.

**Console calls it?** Yes — read-only host list.  
Evidence: `src/lib/adapters/mdm.ts` — `fetch(\`${FLEET_URL}/api/v1/fleet/hosts\`, ...)` with bearer token; falls back to `firstPartyDevices()` if `FLEET_URL` is unset. `src/middleware.ts`, `src/app/(console)/fleet/page.tsx` use the MDM adapter.

**Safe to turn off?** Soft-yes. The Fleet page falls back to the native first-party device list.

**What breaks:** Fleet page shows native devices only instead of osquery-enriched data.

**One-time setup:** Two steps:
1. `docker compose exec fleet fleetctl setup --email <admin@example.com> --password '...' --org-name OffGrid`
2. `fleetctl login && fleetctl get api-token` → set `OFFGRID_FLEET_TOKEN` in the console environment.

Without this, `FLEET_TOKEN` is blank and host API calls fail with 401, triggering the fallback.

---

### Presidio Analyzer

**Profile:** `guardrails, all`  
**Image:** `mcr.microsoft.com/presidio-analyzer:2.2.356`  
**Ports:** `5002` (host) → `3000` (container)  
**RAM/CPU:** ~300–600 MB (spaCy model in memory). No compose limit set.

**Console calls it?** Yes — in-path PII detection.  
Evidence: `src/lib/adapters/pii.ts` — `fetch(\`${url}/analyze\`, ...)` called pre-input and post-output on every request. Falls back to regex detector if `OFFGRID_PRESIDIO_URL` is unset or unreachable. `src/app/api/v1/admin/pii/scan/route.ts` provides a manual scan endpoint.

**Safe to turn off?** Soft-yes. Fallback regex detector activates. PII coverage drops to pattern-matching only (no ML entity recognition).

**What breaks:** ML-based PII detection. Regex fallback in `src/lib/checks.ts` still runs.

**One-time setup:** None. The spaCy model is bundled in the image.

---

### Presidio Anonymizer

**Profile:** `guardrails, all`  
**Image:** `mcr.microsoft.com/presidio-anonymizer:2.2.356`  
**Ports:** `5001` (host) → `3000` (container)  
**RAM/CPU:** ~100–200 MB. No compose limit set.

**Console calls it?** No. The `/anonymize` endpoint is never called.  
Evidence: `src/lib/adapters/pii.ts` only calls `/analyze` on the analyzer. Redaction is done with regex string-replace in the console code, not via `/anonymize`. Zero src/ references to port `5001` or `/anonymize`.

**Safe to turn off?** Yes — completely safe today. Nothing in the codebase calls it.

**What breaks:** Nothing.

**One-time setup:** N/A. Wiring `/anonymize` requires adding an `anonymize()` call in `pii.ts` and choosing operator types (replace/mask/hash/encrypt).

---

### Unleash (+ unleash-db)

**Profile:** `flags, all`  
**Images:** `unleashorg/unleash-server:6.6`, `postgres:16.6-alpine`  
**Ports:** `4242`  
**RAM/CPU:** Unleash ~200–400 MB; its Postgres ~100 MB. No compose limits.

**Console calls it?** Yes — flag lookups.  
Evidence: `src/lib/adapters/flags.ts` — `UNLEASH_URL = process.env.OFFGRID_UNLEASH_URL`; `GET /api/frontend/features` with `UNLEASH_TOKEN`. Falls back to `nativeFlags` (Postgres-backed) if URL is unset.

**Safe to turn off?** Soft-yes. Postgres fallback for flags activates. Feature flag behavior stays consistent; just no remote control.

**What breaks:** Remote feature flag management. Flags revert to their Postgres default values.

**One-time setup:** None. Unleash auto-migrates its Postgres DB. However, an `UNLEASH_TOKEN` (frontend/client API token) must be generated from the Unleash UI and set as `OFFGRID_UNLEASH_TOKEN` for the console to authenticate.

---

### Redis (caching)

**Profile:** `caching, all`  
**Image:** `redis:7.4-alpine`  
**Ports:** `6379`  
**RAM/CPU:** ~30–100 MB (no persistence configured). No compose limit set.

**Console calls it?** Yes — response cache.  
Evidence: `src/lib/redis.ts`, `src/lib/cache.ts`, `src/lib/adapters/cache.ts` — `REDIS_URL = process.env.OFFGRID_REDIS_URL`; GET/SET/SETEX for response cache. Falls back to in-process Map if Redis is unavailable.

**Safe to turn off?** Soft-yes. In-process cache activates (non-shared, resets on restart).

**What breaks:** Cross-process response cache sharing. Each console process gets its own isolated cache.

**One-time setup:** None. Configured with `--save '' --appendonly no` (ephemeral, no persistence).

---

### Caddy (edge)

**Profile:** Not in compose — runs natively on the host.  
**RAM/CPU:** ~20–50 MB. Negligible.

**Console calls it?** Indirectly — all traffic routes through it.  
Evidence: `src/lib/adapters/agentruntime.ts` and related files reference `OFFGRID_CADDY_*` env vars for the embed URL. The audit in `OSS_SERVICES_MATRIX.md` notes Caddy runs as a native process, not a container.

**Safe to turn off?** No. It routes traffic from external clients to the console and gateway.

**What breaks:** All inbound traffic routing. Console and gateway become unreachable.

**One-time setup:** Native install + `Caddyfile` config. Note: `auto_https off` is set (LAN plaintext). TLS requires proper domain and removing that flag.

---

### SeaweedFS

**Profile:** `data, all`  
**Image:** `chrislusf/seaweedfs:3.80`  
**Ports:** `8333` (S3), `9333` (master)  
**RAM/CPU:** ~100–300 MB. No compose limit set.

**Console calls it?** No — zero src/ references.  
Evidence: `grep -rn "seaweed\|8333\|9333" src/` returns nothing. Confirmed in `OSS_SERVICES_MATRIX.md`: "Artifacts + KB use Postgres/MinIO today."

**Safe to turn off?** Yes — nothing uses it today.

**What breaks:** Nothing.

**One-time setup:** Would require provisioning buckets and wiring `OFFGRID_SEAWEED_URL` (currently no such env var exists in `src/`).

---

### VictoriaMetrics

**Profile:** `observability, all`  
**Image:** `victoriametrics/victoria-metrics:v1.106.1`  
**Ports:** `8428`  
**RAM/CPU:** ~100–300 MB depending on retention. No compose limit set.

**Console calls it?** No — zero src/ references.  
Evidence: `grep -rn "victoriametrics\|victoria\|8428" src/` returns nothing. Confirmed in `OSS_CAPABILITY_AUDIT.md`: "entire service OFF — native `:9100` used instead."

**Safe to turn off?** Yes — nothing uses it today.

**What breaks:** Nothing. Node metrics come from a native `:9100` endpoint, not this TSDB.

**One-time setup:** Would require wiring OTLP metrics export in `src/lib/otel.ts` (currently only traces go to Langfuse) and pointing at `http://victoriametrics:8428`.

---

### VictoriaLogs

**Profile:** `observability, all`  
**Image:** `victoriametrics/victoria-logs:v1.3.2-victorialogs`  
**Ports:** `9428`  
**RAM/CPU:** ~100–200 MB. No compose limit set.

**Console calls it?** No — zero src/ references.  
Evidence: `grep -rn "victoria.*log\|vlogs\|9428" src/` returns nothing. OpenSearch covers log search.

**Safe to turn off?** Yes — redundant with OpenSearch for current usage.

**What breaks:** Nothing.

**One-time setup:** Would require a log export path separate from OpenSearch `_bulk`.

---

### OTel Collector

**Profile:** `observability, all`  
**Image:** `otel/opentelemetry-collector-contrib:0.116.0`  
**Ports:** `4317` (gRPC), `4318` (HTTP)  
**RAM/CPU:** ~50–150 MB. No compose limit set.

**Console calls it?** No — traces go directly to Langfuse's OTLP endpoint.  
Evidence: `src/lib/otel.ts` uses `OFFGRID_LANGFUSE_OTLP_URL` directly. No src/ file references `4317` or `4318`. The `otel-collector.yaml` config file is volume-mounted but the console bypasses the collector.

**Safe to turn off?** Yes — the console routes OTLP directly to Langfuse.

**What breaks:** Nothing. The collector is bypassed.

**One-time setup:** `deploy/otel-collector.yaml` must exist (referenced as a required volume mount). Without it the collector container itself fails to start, but since the console doesn't use it, this only matters if you need the fan-out routing.

---

### Jaeger

**Profile:** `observability, all`  
**Image:** `jaegertracing/all-in-one:1.62.0`  
**Ports:** `16686` (UI)  
**RAM/CPU:** ~100–300 MB. No compose limit set.

**Console calls it?** No — zero src/ references.  
Evidence: `grep -rn "jaeger\|16686" src/` returns nothing. Langfuse serves as the trace UI.

**Safe to turn off?** Yes — Langfuse covers tracing.

**What breaks:** Nothing. Jaeger UI goes dark; no console feature uses it.

**One-time setup:** None if you keep Langfuse as the trace backend.

---

### Evidently

**Profile:** `qa, all`  
**Build:** `./sidecars/drift` (custom Python sidecar)  
**Ports:** `8001`  
**RAM/CPU:** ~200–400 MB (Python + scikit-learn). No compose limit set.

**Console calls it?** Conditionally — only if `OFFGRID_EVIDENTLY_URL` is set.  
Evidence: `src/lib/adapters/drift.ts` — `EVIDENTLY_URL = process.env.OFFGRID_EVIDENTLY_URL`; if unset, native PSI drift runs instead. The adapter scaffolding exists fully.

**Safe to turn off?** Yes — native PSI drift is the default and works without Evidently.

**What breaks:** Nothing by default. Evidently-backed drift detection only activates when `OFFGRID_EVIDENTLY_URL` is set.

**One-time setup:** The `sidecars/drift/` directory must contain a valid Python app; the compose `build:` context assumes it exists. Set `OFFGRID_EVIDENTLY_URL=http://localhost:8001` to activate.

---

### Ragas

**Profile:** `qa, all`  
**Build:** `./sidecars/ragas` (custom Python sidecar)  
**Ports:** `8002`  
**RAM/CPU:** ~300–600 MB (Python + sentence-transformers). No compose limit set.

**Console calls it?** Conditionally — only if `OFFGRID_RAGAS_URL` is set.  
Evidence: `src/lib/adapters/evals.ts` — `RAGAS_URL = process.env.OFFGRID_RAGAS_URL`; the adapter calls the sidecar for evals only when URL is configured. Golden-set evals run natively otherwise.

**Safe to turn off?** Yes — golden-set / native evals are the default.

**What breaks:** Nothing by default. Ragas-backed RAG evals only activate when `OFFGRID_RAGAS_URL` is set.

**One-time setup:** The `sidecars/ragas/` directory must build successfully. Set `OFFGRID_RAGAS_URL=http://localhost:8002` to activate.

---

## Honest Bottom Line

**Genuinely active (turning off breaks the console today):**
- Postgres — system of record, nothing works without it
- Keycloak — auth, nobody can log in without it
- OpenSearch — too many read paths (analytics, logs, finops, audit search, token budgets) depend on it

**Active with fallback (safe to turn off, degraded experience):**
- OPA — first-party ABAC fallback
- OpenBao — Secrets panel breaks only
- Langfuse — Observability page goes empty
- Marquez — Lineage page goes empty
- Redis — in-process cache fallback
- Unleash — Postgres flag fallback
- Presidio Analyzer — regex fallback
- FleetDM — native device list fallback

**Aspirational / scaffolded (safe to turn off, zero visible impact today):**
- Temporal — agent runs are synchronous, no Temporal calls made
- Presidio Anonymizer — `/anonymize` is never called
- OpenSearch Dashboards — embed URL only, no console features use it
- Superset — Analytics embed broken but no critical path
- VictoriaMetrics, VictoriaLogs, OTel Collector, Jaeger — zero src/ references
- SeaweedFS — zero src/ references
- Evidently, Ragas — only activate via env var; native implementations are the default

**Profile-gate summary:**
No service is "always-on" in the sense of having no profile. Every service requires at least one profile flag. In practice the `all` profile brings everything up; selective profiles (`data`, `identity`, etc.) let you run only what you need. The compose design is correct for this — the issue is that several profiles (`observability`, `qa`) start containers with zero active callers.
