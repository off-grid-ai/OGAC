# Off Grid Console — Swap Pairs Research

Deep investigation into the competing/swappable service pairs in the stack. For each pair: the
actual adapter/env-var switch in code (file + line), whether the swap is real or aspirational,
what you gain and lose, and any blockers to it working today.

Sources consulted: `deploy/docker-compose.yml`, `docs/OSS_CAPABILITY_AUDIT.md`,
`docs/OSS_SERVICES_MATRIX.md`, and a live grep of `src/`.

---

## 1. Qdrant vs LanceDB (vector store)

### Switch mechanism

`src/lib/brain.ts` lines 15–17:
```ts
function qdrantSelected(): boolean {
  return process.env.OFFGRID_ADAPTER_RETRIEVAL === 'qdrant';
}
```

The three public Brain functions (`listDocuments`, `addDocument`, `searchDocuments`) each check
this flag and delegate to `src/lib/qdrant.ts` when true. The Qdrant implementation is a
pure-REST client (no NPM package dependency) using `OFFGRID_QDRANT_URL` (default
`http://127.0.0.1:6333`), `OFFGRID_QDRANT_COLLECTION` (default `offgrid-brain`), and optional
`OFFGRID_QDRANT_API_KEY`.

The registry entry in `src/lib/adapters/services.ts` lines 127–160 also lists `pgvector` as a
third option but it is metadata-only (no `RETRIEVAL_ENTRIES` porter behind `pick()`).

A `/api/v1/admin/reindex` route pre-populates Qdrant from LanceDB so the store is not empty on
first switch.

### Is the swap real or aspirational?

**Real and tested for Qdrant.** All five Qdrant functions (`qdrantAdd`, `qdrantList`,
`qdrantSearch`, `qdrantReindex`, `qdrantCount`) are fully implemented in `src/lib/qdrant.ts`.
The reindex admin action means switching mid-flight is safe. The swap for `pgvector` is
**aspirational** — it appears only as an `AdapterMeta` entry in the registry
(`src/lib/adapters/services.ts` line 140); there is no pgvector implementation module, no
`pgvectorAdd`/`pgvectorSearch` functions, and no code path that reads
`OFFGRID_ADAPTER_RETRIEVAL=pgvector`.

### What you gain switching to Qdrant

- Server-scale storage independent of the Next.js process and its filesystem; survives
  process restarts without re-embedding.
- Collections and aliases API for zero-downtime index swaps.
- Qdrant's native filtering (HNSW filterable traversal) vs LanceDB's post-hoc filter.
- REST-only, no Node native binding — no ARM/musl compatibility issues.

### What you lose

- LanceDB is embedded: zero network hop, zero additional container, works in any
  environment including CI with no docker-compose dependency.
- LanceDB table is seeded with three starter documents on first open; Qdrant starts
  empty and needs the reindex action.

### Blockers today

None for the Qdrant swap — `OFFGRID_ADAPTER_RETRIEVAL=qdrant` plus a running Qdrant container
(already in the `ai` / `all` profile) is sufficient. Run the reindex action first to
pre-populate. The `pgvector` swap has no implementation; attempting it silently falls through
to LanceDB (the default wins when `pick()` finds no match).

---

## 2. Langfuse vs Jaeger (trace UI)

### Switch mechanism

There is no single `OFFGRID_ADAPTER_TRACES` switch. Instead the code has two independent paths:

1. **Langfuse OTLP target** (`src/lib/otel.ts` lines 11–12, 22–28): when
   `OFFGRID_LANGFUSE_OTLP_URL` + `OFFGRID_LANGFUSE_AUTH` are set, `emitSpan()` fans out to
   Langfuse alongside any `OFFGRID_OTLP_URL` target. Both are fired concurrently;
   Langfuse is additive.

2. **`OFFGRID_OTLP_URL`** (`src/lib/otel.ts` line 8): generic OTLP endpoint. In
   `deploy/docker-compose.yml` the OTel Collector (`otel-collector`, profile `observability`)
   has Jaeger as a `depends_on` (line 122). If the collector is running and its config routes
   traces to Jaeger, Jaeger receives them. But the collector is in the **off-by-default**
   `observability` profile; the compose comment (line 179) says "Console pushes traces straight
   to Langfuse's OTLP endpoint; collector unneeded."

The Observability page reads traces back **only from Langfuse** via
`src/lib/langfuse.ts` / `src/lib/chat-trace.ts` (env vars `OFFGRID_LANGFUSE_URL`,
`OFFGRID_LANGFUSE_PUBLIC_KEY`, `OFFGRID_LANGFUSE_SECRET_KEY`). The trace waterfall,
expandable list, and LLM-judge scores are all Langfuse read-back. There is no Jaeger read-back
in the console app.

### Is the swap real or aspirational?

**Langfuse is real and active.** Jaeger is aspirational from the console perspective — it is a
valid OTLP backend and receives spans if the collector is running, but the console UI only reads
from Langfuse. Switching to Jaeger as the trace UI would require adding a Jaeger read-back path
(or embedding the Jaeger UI), which does not exist.

### What you gain switching to Jaeger

- Standard distributed-trace semantics (parent/child span hierarchy, service map)
  without Langfuse's LLM-centric framing.
- No Langfuse v3 stack dependency (6 containers: langfuse, langfuse-worker, langfuse-db,
  langfuse-clickhouse, langfuse-minio, langfuse-redis).
- Jaeger all-in-one is a single container.

### What you lose

- Per-trace LLM cost rollups, model/token counts, and LLM-as-judge scores — Langfuse
  surfaces these; Jaeger does not.
- Trace read-back in the Observability page — the console only queries
  `/api/public/traces` and `/api/public/observations` from Langfuse.
- The headless score push (`/api/public/scores`) used by the QA scoring path has no
  Jaeger equivalent.

### Blockers today

Jaeger cannot be selected as the console trace UI without new read-back code. Using Jaeger in
parallel (as a generic OTLP sink) requires starting the `observability` profile and configuring
the collector's pipeline, but the console view would remain Langfuse-only.

---

## 3. OpenSearch vs VictoriaLogs (log search)

### Switch mechanism

Log shipping is hardcoded to OpenSearch in `src/lib/siem.ts`:

- Line 6: `const OPENSEARCH_URL = process.env.OFFGRID_OPENSEARCH_URL;`
- Line 29: `fetch(\`${OPENSEARCH_URL}/_bulk\`, ...)`

The read-back `searchAudit()` calls OpenSearch `_search` directly. There is no adapter layer
or `OFFGRID_ADAPTER_SIEM` switch — the SIEM pair in `src/lib/adapters/services.ts` (lines
166–189) is registry metadata only; `getPii()` / `getPolicy()` etc. have `pick()` implementations
but there is no `getSiem()` function and no behavior port behind the SIEM pair.

VictoriaLogs (compose: `victorialogs`, profile `observability`, port 9428) has a different query
API (LogsQL, not the OpenSearch `_search` DSL). It is listed in `docs/OSS_SERVICES_MATRIX.md`
as "available, not active."

### Is the swap real or aspirational?

**Aspirational for VictoriaLogs.** OpenSearch is the only wired log search backend. VictoriaLogs
appears in compose and the service matrix but has zero call sites in `src/`. The `siem.ts` module
is hardwired to OpenSearch's `_bulk` and `_search` API shapes.

### What you gain switching to VictoriaLogs

- Single lightweight container vs OpenSearch + opensearch-dashboards (OpenSearch is the
  heaviest service in the stack at 512 MB JVM heap minimum).
- VictoriaLogs has a simpler ops story (no shard management, no ISM, no Java GC tuning).
- LogsQL is ergonomic for structured-field filtering; the console's current queries
  are simple enough to port.

### What you lose

- OpenSearch Dashboards (embedded via `OFFGRID_OPENSEARCH_DASHBOARDS_URL`) for the
  SIEM visual layer.
- Full-text BM25 ranking (`_search` relevance scoring). VictoriaLogs supports full-text
  search but without BM25 scoring.
- Future aggregation use (date histograms, terms aggs, percolator alerting) — all of
  which require OpenSearch.
- The existing audit-search UI in the console (`src/components/control/AuditSearch.tsx`)
  uses the OpenSearch query DSL directly.

### Blockers today

`src/lib/siem.ts` must be rewritten to target VictoriaLogs's HTTP query API. No adapter
abstraction exists. VictoriaLogs must also be added to the running profiles (it is off by
default). The OTel Collector (also off by default) would need a `vlogs` exporter configured
to route logs to VictoriaLogs.

---

## 4. Presidio ML redaction vs regex fallback

### Switch mechanism

`src/lib/adapters/pii.ts` is the behavior port. The active PII adapter is selected by
`OFFGRID_ADAPTER_GUARDRAILS` via the `pick()` function in the registry
(`src/lib/adapters/registry.ts` line 86):

```ts
export function getPii(): PiiPort {
  return pick('guardrails', PII_PORTS);
}
```

`PII_PORTS` is `[regexPii, presidioPii]` (pii.ts line 86). The first element is the default
so `regexPii` wins unless `OFFGRID_ADAPTER_GUARDRAILS=presidio` is set.

`regexPii` (`src/lib/adapters/pii.ts` lines 19–41): scans for EMAIL and PHONE with two
hardcoded regexes, returns `engine: 'regex'`, performs string-replace redaction.

`presidioPii` (`src/lib/adapters/pii.ts` lines 61–84): calls `OFFGRID_PRESIDIO_URL/analyze`
(English, all default recognizers). If unreachable, falls back to `regexScan()`. Critically,
it calls `presidioAnalyze()` but **does not call the `/anonymize` endpoint** — the entity list
is returned but redaction is left to the caller (which also uses regex-replace in practice,
as confirmed by the audit: "redaction is done with regex string-replace, not Presidio's ML").

### Is the swap real or aspirational?

**Detection swap is real.** Setting `OFFGRID_ADAPTER_GUARDRAILS=presidio` causes every
in-path PII scan to call Presidio's `/analyze` endpoint and detect a full set of entity
types (CREDIT_CARD, US_SSN, PERSON, LOCATION, IP, IBAN, CRYPTO, DATE_TIME, etc.) instead
of just EMAIL and PHONE from the regex.

**ML redaction is aspirational.** The `/anonymize` endpoint (the Presidio ML redaction with
mask/hash/encrypt/replace operators) is never called. Presidio-anonymizer is in the compose
file (`presidio-anonymizer`, port 5001, profile `guardrails`) but `src/lib/adapters/pii.ts`
has no call to it.

### What you gain switching to Presidio

- 15+ entity types vs 2 (EMAIL, PHONE).
- NER-backed detection for PERSON and LOCATION (not regex-approximable).
- Confidence scores (available but currently unused — audit notes "use types, not thresholds").

### What you lose

- The regex fallback is always available and has zero latency, zero dependency.
- Presidio adds ~4 s timeout per scan (AbortSignal.timeout(4000) in `presidioAnalyze`).
- ML redaction (the thing Presidio is best at) is not wired; you get better detection but
  the same regex-replace redaction either way.

### Blockers today

For improved detection: set `OFFGRID_ADAPTER_GUARDRAILS=presidio` and ensure Presidio is
running (`--profile guardrails`). Works today.

For ML redaction: `src/lib/adapters/pii.ts` must be extended to call
`OFFGRID_PRESIDIO_ANONYMIZER_URL/anonymize` with the detected spans and desired operators.
The anonymizer container is already defined in compose but nothing calls it.

---

## 5. Temporal vs synchronous Postgres (agent runtime)

### Switch mechanism

`src/lib/adapters/agentruntime.ts` is the behavior port. Switch:

```
OFFGRID_ADAPTER_AGENTRUNTIME=temporal
OFFGRID_TEMPORAL_ADDRESS=<host:7233>           # gRPC (required for gRPC client, not used yet)
OFFGRID_TEMPORAL_HTTP_URL=<url>                # HTTP bridge (required for HTTP submission)
OFFGRID_TEMPORAL_NAMESPACE=default
OFFGRID_TEMPORAL_TASK_QUEUE=offgrid-agents
```

`getAgentRuntime()` (line 131) runs `pick()` then checks `available()`:

```ts
export function getAgentRuntime(): AgentRuntimePort {
  const wanted = process.env.OFFGRID_ADAPTER_AGENTRUNTIME;
  const chosen = AGENT_RUNTIME_PORTS.find((p) => p.meta.id === wanted) ?? syncRuntime;
  return chosen.available() ? chosen : syncRuntime;
}
```

`temporalRuntime.available()` (line 75) returns `Boolean(TEMPORAL_HTTP)` — it only claims
availability when an HTTP bridge URL is set. Even with `OFFGRID_ADAPTER_AGENTRUNTIME=temporal`
and a running Temporal cluster at `:7233`, if no HTTP bridge is configured the runtime falls
back to sync.

The TODO comment at line 80 is explicit: "bind @temporalio/client (gRPC) in a Node runtime to
submit against OFFGRID_TEMPORAL_ADDRESS directly. Until then, without an HTTP bridge we cannot
submit."

### Is the swap real or aspirational?

**Aspirational / scaffold only.** The Temporal adapter submits via HTTP REST (`POST
/api/v1/namespaces/{ns}/workflows/{id}`) against a Temporal HTTP API bridge — but Temporal
does not expose this natively. Temporal's REST API (`temporalio/temporal-api`) is only in
recent server versions (≥ 1.24 with `--enable-http`) or requires a separate HTTP gateway. The
compose file exposes port 7233 (gRPC only); there is no HTTP bridge container. The `AgentRunWorkflow`
referenced in the submission body does not appear anywhere in `src/` — no worker registers it.

The OSS_SERVICES_MATRIX explicitly states: "Temporal — adapter scaffold only; agent runs stay
synchronous."

### What you gain switching to Temporal

- Durable, replayable agent runs: a crash mid-workflow resumes from the last completed
  activity rather than re-running from scratch.
- Retry policies, timeouts, and heartbeat-based stall detection per activity.
- Signals for approval-queue flows (pause mid-run waiting for human approval).
- Temporal UI at `:8081` for live workflow inspection.

### What you lose / what still works

- The synchronous path is reliable and simpler to debug; no new infrastructure dependency.

### Blockers today

1. No `@temporalio/client` binding: the gRPC client is not installed. Temporal's gRPC port
   (7233) is unreachable from the fetch-only seam.
2. No HTTP bridge: the compose file does not include a Temporal HTTP API bridge container.
   Even with a recent server version that supports HTTP, the bridge URL must be configured.
3. No worker code: `AgentRunWorkflow` is never defined or registered. The Temporal cluster
   would receive the submission and have no worker to execute it.

All three blockers must be resolved before the swap is functional.

---

## 6. Superset vs native charts (BI / analytics)

### Switch mechanism

`src/lib/superset.ts` manages two modes:
- **Guest token embed** (`mintGuestToken()`): mints a short-lived token using
  `OFFGRID_SUPERSET_URL`, `OFFGRID_SUPERSET_USERNAME`, `OFFGRID_SUPERSET_PASSWORD`, and
  `OFFGRID_SUPERSET_EMBED_UUID`. The Analytics page uses this to render a Superset dashboard
  iframe.
- **SQL API** mode (`OFFGRID_SUPERSET_DB_ID`): documented in the comment at line 5 but
  not implemented in the file. No `runSql()` function exists.

The registry in `src/lib/adapters/services.ts` (lines 258–283) lists `superset` and
`metabase` as BI options but there is no `getBI()` pick function — BI is metadata-only in
the registry; it does not route behavior.

The "native charts" path is what the Analytics page uses **when Superset is not configured**:
the page fetches from `/api/v1/gateway/analytics` and `/api/v1/gateway/finops` to render
first-party charts built on Postgres + the `@offgrid/analytics` package.

There is no `OFFGRID_ADAPTER_BI` switch. The Analytics page conditionally renders either
the Superset embed or the native charts based on whether Superset env vars are set.

### Is the swap real or aspirational?

**Both exist and work independently.** Native charts are the always-on default. Superset embed
is functional when configured, but requires a one-time `docker compose exec superset superset init`
to create the admin user and metadata before the guest token can be minted (per compose comment
at line 403). Without that init, login fails with 401 and `mintGuestToken()` returns an error.

The OSS_SERVICES_MATRIX describes Superset as "🟡 Partial — guest-token embed on Analytics
(needs one-time `superset init`)."

### What you gain switching to Superset

- SQL Lab for ad-hoc queries directly against Postgres.
- Pivot/transpose, heatmap, and advanced chart types not in the native view.
- Scheduled reports and threshold alerts.
- Dashboard sharing (via guest token, already wired).

### What you lose

- Native charts are instant, zero-config, and zero-dependency; they work in all environments.
- Native FinOps and analytics views use the first-party `@offgrid/analytics` and
  `@offgrid/finops` packages which are aware of the console data model.
- Superset has no Row Level Security wired (`rls: []` in the guest token body, line 62 of
  `superset.ts`) — any embedded dashboard is effectively unscoped.

### Blockers today

- One-time `superset init` must be run; this is a manual step not automated by compose.
- A dashboard must be created/provisioned in Superset and its embed UUID set in
  `OFFGRID_SUPERSET_EMBED_UUID`. No dashboard is pre-provisioned.
- `OFFGRID_SUPERSET_EMBED_UUID` is the hard gate: if unset, `mintGuestToken()` returns
  `{ configured: false }` and the page falls back to native charts silently.

---

## 7. pgvector vs Qdrant (vector store alternative)

### Switch mechanism

`pgvector` appears as a third option in `RETRIEVAL_ENTRIES`
(`src/lib/adapters/services.ts` lines 139–147):

```ts
{
  meta: {
    id: 'pgvector',
    capability: 'retrieval',
    vendor: 'Postgres + pgvector',
    license: 'PostgreSQL',
    render: 'headless',
    description: 'Server-scale vectors in the Postgres you already run.',
  },
},
```

No `health` ping, no `embedUrl`, no implementation module. Setting
`OFFGRID_ADAPTER_RETRIEVAL=pgvector` causes `pick()` in the registry to find this entry
(it matches on `meta.id`) and return it as the active registry binding — but `src/lib/brain.ts`
only checks for `=== 'qdrant'` and falls through to LanceDB for any other value. There is no
`pgvectorSelected()` branch.

### Is the swap real or aspirational?

**Entirely aspirational.** There is no pgvector implementation. Selecting it silently falls
back to LanceDB. The Postgres container runs `pgvector/pgvector:0.8.0-pg16` (compose line 20),
so the extension is available, but the Drizzle schema (`src/db/schema.ts`) has no vector
column and no `<=>` operator queries exist in `src/`.

### What you gain switching to pgvector

- Vector search in the same Postgres instance already running for console state — no
  additional container.
- Joins between vector results and relational data (e.g. per-user document access) are
  SQL-native.
- pgvector 0.8 supports HNSW indexes comparable in performance to Qdrant for moderate
  dataset sizes.

### What you lose vs Qdrant

- Qdrant's dedicated collection management, filterable HNSW traversal, and scroll/pagination
  APIs are richer than pgvector's current operator set.
- Qdrant separates concerns: vector storage does not compete with OLTP workload on the
  same Postgres instance.

### Blockers today

pgvector as a swap-in requires:
1. A Drizzle migration adding a `vector(N)` column to a documents table (schema change).
2. A new implementation module (`src/lib/pgvector.ts`) with `pgvectorAdd`, `pgvectorList`,
   `pgvectorSearch`.
3. A branch in `src/lib/brain.ts` alongside the existing `qdrantSelected()` check.

Until all three exist, `OFFGRID_ADAPTER_RETRIEVAL=pgvector` is a no-op.

---

## Docker Compose: profile inventory

Services grouped by profile status:

### Always-on (no `profiles:` key)

None — every service in the compose file has a profile. Without `--profile` flags (or
`--profile all`), **nothing starts**.

### Profile `data` (or `all`)
- `postgres` (also in `ai`)
- `seaweedfs`

### Profile `ai` (or `all`)
- `postgres`
- `qdrant`

### Profile `secrets` (or `all`)
- `openbao`

### Profile `identity` (or `all`)
- `keycloak`

### Profile `policy` (or `all`)
- `opa`

### Profile `guardrails` (or `all`)
- `presidio-analyzer`
- `presidio-anonymizer`

### Profile `observability` (or `all`)
- `victoriametrics`
- `victorialogs`
- `otel-collector`
- `jaeger`

### Profile `llmops` (or `all`)
- `langfuse-db`, `langfuse-clickhouse`, `langfuse-minio`, `langfuse-redis`, `langfuse-worker`, `langfuse`

### Profile `lineage` (or `all`)
- `marquez-db`, `marquez`, `marquez-web`

### Profile `agents` (or `all`)
- `temporal-db`, `temporal`, `temporal-ui`

### Profile `caching` (or `all`)
- `redis`

### Profile `siem` (or `all`)
- `opensearch`, `opensearch-dashboards`

### Profile `flags` (or `all`)
- `unleash-db`, `unleash`

### Profile `qa` (or `all`)
- `evidently`
- `ragas`

### Profile `bi` (or `all`)
- `superset`

### Profile `mdm` (or `all`)
- `fleet-mysql`, `fleet-redis`, `fleet`

### Key observation

`jaeger` and `victorialogs` are both in the `observability` profile. Jaeger is also a hard
`depends_on` of `otel-collector` (compose line 122). Neither is started by the reference
fleet deployment (which uses `--profile all` but the services matrix states the collector is
"off" because the console pushes traces directly to Langfuse). The `observability` profile
is effectively a "generic OTLP infra" profile separate from the LLMOps plane.

---

## Summary table

| Pair | Switch env var | Swap real? | Main blocker |
|---|---|---|---|
| LanceDB → Qdrant | `OFFGRID_ADAPTER_RETRIEVAL=qdrant` | Yes — full implementation | None; run reindex first |
| LanceDB → pgvector | `OFFGRID_ADAPTER_RETRIEVAL=pgvector` | No — falls back to LanceDB | No implementation module, no schema |
| Langfuse → Jaeger (trace UI) | No switch exists | No — Jaeger is OTLP sink only | No Jaeger read-back; console reads only Langfuse |
| OpenSearch → VictoriaLogs | No switch exists | No — `siem.ts` hardwired to OpenSearch | No adapter abstraction; different query API |
| Presidio detect ON | `OFFGRID_ADAPTER_GUARDRAILS=presidio` | Yes — detection real | None; presidio must be running |
| Presidio ML redact ON | N/A | No — `/anonymize` never called | `pii.ts` must call anonymizer endpoint |
| Sync → Temporal | `OFFGRID_ADAPTER_AGENTRUNTIME=temporal` | No — scaffold only | No gRPC client; no HTTP bridge; no worker |
| Native charts → Superset embed | Set `OFFGRID_SUPERSET_*` env vars | Partial — embed works once init'd | One-time `superset init`; no pre-provisioned dashboard |
