# Brain / Soul / Pipeline — research note

> **Purpose:** map the event→enrichment→embedding→vector store→retrieval→proactive-intelligence
> pipeline as it stands today, find the gaps, and describe how to close them using only
> infrastructure already running on the fleet.
>
> **Not a design spec.** This is a ground-truth read of the existing code and docs.
> No new OSS services are proposed — every piece below is already deployed or already
> packaged inside `@offgrid/*`.

---

## 1. Terminology: "the Brain" and "the Soul"

### The Brain — an explicit, defined concept

**"The Brain"** is an official product concept. It appears in:

- `docs/CONCEPTS.md` (AI plane section): *"the knowledge layer — ingest text/file/image/dataset → chunk → embed → index with provenance; retrieve with citations."*
- `src/lib/brain.ts` (file-level comment): *"The Brain — the ingestion→retrieval (RAG) pipeline. LanceDB (embedded, on-disk) is the default store; Qdrant is the server-scale swap-in."*
- Marketing copy on `src/app/page.tsx`: *"one governed knowledge brain that every agent and person draws from — your context, on your infrastructure."*
- `docs/OSS_SERVICES_MATRIX.md` (Qdrant row): *"dedicated vector DB — an alternative Brain store."*

The Brain is **the org knowledge base** — the chunk→embed→index→retrieve pipeline that grounds agent answers.

### "The Soul" — not a defined term in this codebase

Grepping every `.ts`, `.tsx`, and `.md` file across the entire `off-grid-ai/` tree finds "soul" only once: a design doc comment (*"this doc keeps the same soul"*) referring to brand identity, not an engineering concept.

**There is no "Soul" as a technical layer in the current codebase.** If the user means to introduce one, the closest candidate is the **proactive intelligence layer** described in this document — background event summarization, ambient context delivery, and the eventual on-device policy model from `shared/ROADMAP.md §∞`. That could be named the Soul; nothing conflicts with it.

---

## 2. Event sources that already exist in the stack

### 2a. The audit log (Postgres + OpenSearch)

Every gateway call produces an audit event in Postgres (`audit_log` table), then is bulk-shipped to OpenSearch (`offgrid-audit` index) via `src/lib/siem.ts`. Each event carries:

```
id, deviceId, model, outcome, tokens, leftDevice, keyId, ts
```

**The gateway model-call log** is a separate OpenSearch index (`offgrid-gateway`) — every model call across all nodes lands there with caller identity (`x-offgrid-user`).

**What's missing:** timestamps are there; richer event attributes (query text, answer hash, agent id, tool invocations, latency) are in `agentRuns` (Postgres) but are NOT currently cross-linked into the OpenSearch audit record. The SIEM record is thin.

### 2b. OpenLineage / Marquez

`src/lib/ingest.ts` and `src/lib/agentrun.ts` both emit OpenLineage events to Marquez on every ingest and every retrieval:

- `brain.ingest` run: `inputs=[source]`, `outputs=[doc.title]`
- `brain.retrieve` run: `inputs=[source labels]`, `outputs=['retrieval-result']`
- `agent:{id}` run: `inputs=[citation refs]`, `outputs=[runId]`

The lineage graph is queryable and is visualised on the `/lineage` console page via `MarquezGraph.tsx`. **Current gap:** only dataset-level lineage; no column-level, no error facets, no `ParentRunFacet` linking agent→tool→document in a single tree.

### 2c. Langfuse traces (OTLP)

Every agent step emits an OTLP span via `src/lib/otel.ts` → Langfuse. The span waterfall is read back on the Observability page. LLM-as-judge scores are pushed asynchronously post-response. **Current gap:** `sessionId` and `userId` are often not stamped (noted in the audit doc as "Partial"); session-level analytics are unused.

### 2d. Agent run records (Postgres)

`agentRuns` table holds the full structured trace of every run: `query`, `answer`, `status`, `steps[]`, `citations[]`, `checks[]`, `provenance`. This is the richest per-interaction record in the system. **Not in the vector store.** Not enriched into any embedding pipeline.

### 2e. FinOps / token-budget events

`src/lib/finops.ts` and `src/lib/token-budgets.ts` record per-key and per-user token spend. These events are computed from the audit log but are stored in Postgres (`token_budget_usage` table). Not shipped anywhere outside Postgres.

### 2f. QA sweep results

`src/lib/qa/sweep.ts` runs offline eval + drift analysis on demand (cron / CI). Result emitted as an OTLP span (`qa.sweep`) with `degraded`, `eval.score`, `drift.status`. **Not embedded or stored for retrieval.**

---

## 3. Embedding infrastructure — what is active vs. available

### Active: LanceDB (default) via `src/lib/brain.ts`

- Embedded LanceDB on-disk at `LANCEDB_PATH` (default `./.lancedb`).
- Table: `documents`. Schema: `{ id, title, source, text, vector: number[] }`.
- Single vector per document (title + full text concatenated).
- Embeddings produced by calling `getInference().embed(text)` → the gateway's `/v1/embeddings` (384-dim MiniLM).
- Similarity: L2 distance converted to `1/(1+d)` score.

### Active (parallel path): Postgres JSONB (in `src/lib/rag.ts` and `src/lib/org-knowledge.ts`)

Two separate chunk→embed→cosine-in-JS pipelines live in Postgres (JSONB column `embedding`):

- `chat_chunks` table: per-project RAG for project-scoped chat.
- `org_knowledge_chunks` table: org-wide knowledge base with RBAC-gated retrieval.
- Both call the gateway `/v1/embeddings` for 384-dim MiniLM vectors.
- Retrieval: load **all** chunks into Node.js, compute cosine in JavaScript, sort, slice top-k.
- **No pgvector.** Despite pgvector being installed (noted in the audit: "pgvector — **No** — Vectors in LanceDB/Qdrant"), the cosine is computed application-side over JSONB arrays.

### Available but not default: Qdrant

- Full client in `src/lib/qdrant.ts`.
- Activated with `OFFGRID_ADAPTER_RETRIEVAL=qdrant`.
- "Reindex Brain → Qdrant" admin action exists in `src/components/data/ReindexQdrantButton.tsx`.
- **Not the default**. The LanceDB path runs unless the env var is set.

### Not wired: `@offgrid/rag` package

The OSS capability audit flags this as the **biggest single gap**: *"`@offgrid/rag` entirely unimported — a full chunk→embed→retrieve→prompt pipeline built and unused."* The console re-implements cosine retrieval three separate times (brain.ts, rag.ts, org-knowledge.ts) rather than importing the shared package.

### Summary table

| Store | Model | Active? | Notes |
|---|---|---|---|
| LanceDB (embedded) | 384-dim MiniLM | Yes (default Brain) | One doc per entry, no chunking |
| Postgres JSONB | 384-dim MiniLM | Yes (project + org KB) | In-JS cosine, full table scan |
| Qdrant (server) | 384-dim MiniLM | Available, not default | Flip one env var |
| pgvector | — | Not used | Installed, never called |
| `@offgrid/rag` | (same gateway) | Not imported | Full pipeline exists in shared pkg |

---

## 4. Retrieval patterns already coded

### 4a. Vector similarity (LanceDB)

`src/lib/brain.ts → searchDocuments()`: embed query → `tbl.search(vector).limit(k)` → convert L2 to score.

### 4b. Cosine similarity in JavaScript (Postgres)

`src/lib/rag.ts → retrieve()` and `src/lib/org-knowledge.ts → retrieve()`: embed query → load all chunk embeddings from Postgres → compute cosine per chunk in JS → sort → top-k. Correct but does not scale (loads the entire table into Node).

### 4c. Token-overlap keyword matching

`src/lib/retrieval/sources.ts`: the `databaseSource` and `toolSource` use `tokenOverlap()` — a simple `|q ∩ t| / |q|` Jaccard over word-token sets. No semantic component.

### 4d. Reciprocal Rank Fusion (RRF)

`src/lib/retrieval/router.ts → fuse()`: merges ranked lists from multiple sources (KB, database, tool) via RRF with `k=60`. This is a genuine hybrid-retrieval fusion, not just score averaging.

### 4e. Intent routing

`src/lib/retrieval/router.ts → classify()`: regex signals mapped to source kinds (`kb`, `database`, `tool`). Heuristic, deterministic, offline.

### 4f. Grounding verification

`getGrounding().verify(answer, sources)` is called after composition in `agentrun.ts`. The grounding adapter checks each claim against its cited source.

### What is NOT coded

- **No background / push retrieval.** All retrieval is synchronous, query-driven.
- **No scheduled re-embedding** of events (audit events, Langfuse traces, lineage runs).
- **No retrieval-augmented prompts injected at "nodes"** (enrolled devices). Nodes pull policy; they do not receive contextual intelligence.
- **No semantic search over the audit log.** OpenSearch's kNN is not wired (`No` in the capability audit); audit search is keyword + filter only.
- **No proactive summarisation job.** No background process summarises recent events and pushes summaries to any vector store.

---

## 5. What is missing in the pipeline today

The desired pipeline:

```
events → enrichment → embeddings → vector store → retrieval → proactive intelligence at nodes
```

Current state vs. desired state:

| Stage | Current state | Gap |
|---|---|---|
| **Event sources** | Audit (thin), Langfuse (traces), Marquez (lineage), agentRuns (rich, Postgres), QA sweep (OTLP span) | Events are siloed; no unified event stream or enrichment hop |
| **Enrichment** | None. Events are stored as-is. | No LLM summarisation of events before embedding; no entity extraction from audit records |
| **Embeddings** | Three separate chunk→embed pipelines, all gateway-backed 384-dim MiniLM; all triggered by ingest, not by events | No periodic job embeds event records; the vector store is a static knowledge base, not a live event index |
| **Vector store** | LanceDB (Brain docs) + Postgres JSONB (project + org KB chunks) | Events (audit, traces, lineage) are never embedded; only manually ingested documents are in the vector store |
| **Retrieval** | Synchronous, query-driven; RRF over KB + DB + tool; per-request only | No ambient background retrieval; no context pre-fetched for a "node session"; no retrieval triggered by non-query events |
| **Proactive delivery at nodes** | None. Nodes pull policy; no intelligence is pushed or pre-staged. | No mechanism to push summaries or retrieved context to enrolled devices |

The single largest structural gap: **events are never embedded.** The entire left side of the pipeline (audit log, Langfuse traces, Marquez lineage, agent run records) produces structured data that is read back through dashboards but never turned into vectors that can be semantically retrieved.

---

## 6. How proactive productivity boost could work architecturally

### The design in one paragraph

A background job runs on a cadence (e.g. every 15 minutes). It reads the last N audit events, Langfuse trace summaries, and agent run records from Postgres/OpenSearch. It sends each batch to the gateway for LLM summarisation (a brief, entity-rich paragraph per session or per user). The summary is embedded (384-dim MiniLM via the gateway) and upserted into an `event_summaries` collection in Qdrant or LanceDB. At query time — or proactively when a node pulls its policy bundle — the console retrieves the top-k most relevant recent summaries and injects them as context into the agent's system prompt. Nodes receive this as a `context_hints` payload alongside the policy bundle.

### Concrete stages using only existing stack

#### Stage 1 — Event fan-out (no new infra)

Use the existing Postgres `agentRuns` table and OpenSearch `offgrid-audit` index as the event sources. A new API route (`POST /api/v1/admin/intelligence/ingest`) reads:

- Recent `agentRuns` (last 100, ordered by `startedAt` desc)
- Recent audit events from OpenSearch (last N hours)
- Recent Langfuse traces via the public API (`GET /api/public/traces`)
- Marquez job runs via the Marquez API

No new event infrastructure needed — all four sources are already polled by existing console views.

#### Stage 2 — Enrichment via the gateway (LLM summarisation)

For each batch, POST to the gateway `/v1/chat/completions` (Gemma-4 local) with a prompt:

```
Summarise these N agent interactions as a 3–5 sentence paragraph noting:
which queries were asked, which documents/tools were used, any errors or blocked runs,
and the user or project context. Be terse and entity-rich.
```

This is the only new LLM call. It runs asynchronously, out-of-band, and is gated by the existing `online-evals` Unleash flag pattern or a new `event-intelligence` flag.

#### Stage 3 — Embedding and upsert (Qdrant or LanceDB)

Pass the summary text to `/v1/embeddings` → 384-dim vector. Upsert into:

- **Qdrant** (preferred for event summaries — server-scale, payload filtering, datetime range): a new collection `event_intelligence` with payload `{ userId, projectId, ts, kind: 'event_summary', source: ['audit'|'trace'|'lineage'] }`.
- Or **LanceDB** with a new table `event_intelligence` alongside `documents`.

The upsert path is already implemented for the Brain (`addDocument` in `brain.ts`); it is a matter of calling it with the summarised text and an `event_intelligence` source label.

#### Stage 4 — Retrieval at query time (extend the router)

Add a fourth `RetrievalSource` to `src/lib/retrieval/sources.ts`:

```typescript
export const eventIntelligenceSource: RetrievalSource = {
  id: 'event_intelligence',
  kind: 'kb',           // reuse existing kind; router handles it
  label: 'Recent activity (event intelligence)',
  describe: 'Embedded summaries of recent agent runs, audit events, and lineage.',
  async search(query, k) { /* qdrantSearch or brainSearch over event_intelligence */ },
};
```

The RRF fusion in `router.ts` picks this up automatically — no changes to the router logic.

#### Stage 5 — Proactive delivery at nodes

Nodes already pull a policy bundle from `GET /api/v1/devices/policy`. Extend this response to include a `context_hints` field:

```json
{
  "policy": { ... },
  "context_hints": [
    { "kind": "event_summary", "text": "In the last hour, 12 agent runs completed...", "ts": "..." }
  ]
}
```

The console computes `context_hints` by running the retrieval router with a synthetic query built from the node's `deviceId` and enrolled user (e.g. `"recent activity for device {id}"`). The node's local agent prepends these hints to its system prompt.

This reuses: the policy pull mechanism (already implemented), the retrieval router (already implemented), and the gateway embedding endpoint (already implemented). The only net-new code is the background ingestion job and the `context_hints` field on the policy response.

---

## 7. Which existing OSS services cover each pipeline stage

| Pipeline stage | Service(s) already running | How they cover it |
|---|---|---|
| **Event collection** | Postgres (`agentRuns`, `auditLog`), OpenSearch (`offgrid-audit`, `offgrid-gateway`), Langfuse (OTLP traces), Marquez (OpenLineage) | All four sources exist and are populated. No additional collector needed. |
| **Enrichment (summarisation)** | Off Grid AI Gateway (`:7878`) | LLM call via existing `/v1/chat/completions`. Gemma-4 local handles it offline. No new service. |
| **Embedding** | Off Grid AI Gateway (`:7878`) | `/v1/embeddings` (384-dim MiniLM) is already the embedding endpoint for the Brain, project RAG, and org KB. Same endpoint, same model. |
| **Vector store (event index)** | Qdrant (`:6333`, already deployed, already has a full client in `src/lib/qdrant.ts`) | New collection `event_intelligence`. Activate `OFFGRID_ADAPTER_RETRIEVAL=qdrant`; the reindex path already exists. Alternatively: second LanceDB table. |
| **Background job scheduling** | Two options: (a) Temporal (`:7233`, deployed, scaffolded) as a scheduled workflow; (b) Existing `/api/v1/admin/qa/sweep` pattern — a route hit by cron or CI. | Temporal `Schedules API` is the clean durable path; the QA sweep pattern is the zero-infra-change path (a new route + an OS cron hitting it). |
| **Retrieval** | `src/lib/retrieval/router.ts` (RRF + intent routing, already multi-source) | Add one `RetrievalSource`. No architecture change. |
| **Context delivery to nodes** | `GET /api/v1/devices/policy` (already the node pull endpoint) | Extend the JSON response with `context_hints`. |
| **Observability of the pipeline** | Langfuse (OTLP spans), OpenSearch (audit), Marquez (lineage) | Emit a `brain.event_ingest` OpenLineage job and a `intelligence.sweep` OTLP span per background run, following the existing patterns in `ingest.ts` and `qa/sweep.ts`. |

Nothing in the pipeline requires a new container. The only new infrastructure concern is activating Qdrant as the default retrieval backend (one env var) so event summaries have a scalable, payload-filterable home.

---

## 8. The `@offgrid/rag` package gap — why it matters here

The desktop's `@offgrid/rag` package (`shared/packages/rag/`) is a complete, tested chunk→embed→retrieve→prompt pipeline. The console re-implements the same logic three times (brain.ts, rag.ts, org-knowledge.ts). If the event intelligence pipeline is built as a fourth re-implementation, the technical debt compounds.

**The right fix:** import `@offgrid/rag` and implement the event intelligence pipeline as a fourth `RagService` instance backed by Qdrant. This is the path the roadmap's `∞.1` checkpoint (*"in-context / RAG personalization over `@offgrid/rag` + the memory graph"*) describes. The console's three existing pipelines should eventually converge onto it.

For the immediate proactive-intelligence build, this is a refactoring concern, not a blocker — the console's existing `addDocument`/`searchDocuments` pattern is sufficient to ship the pipeline.

---

## 9. Key findings in summary

1. **"The Brain"** is a defined, implemented concept: the org knowledge base (LanceDB + Qdrant swap). **"The Soul"** is not a codebase term — it could be coined for the proactive intelligence layer described here.

2. **Four rich event sources exist today** (Postgres audit + agent runs, OpenSearch gateway log, Langfuse OTLP traces, Marquez lineage) but none of them are embedded. The vector stores hold only manually ingested documents.

3. **Three parallel RAG implementations** exist in the console (brain.ts, rag.ts, org-knowledge.ts), all using the same gateway embedding endpoint and all doing in-JS cosine over JSONB. The `@offgrid/rag` shared package is not imported.

4. **The retrieval router** (RRF + intent classification) is designed to be multi-source and can absorb an `event_intelligence` source without architectural change.

5. **The full proactive pipeline** (events → LLM summarise → embed → Qdrant → retrieve at query time → `context_hints` on policy pull) can be built using only services already running on the fleet. The net-new code surface is:
   - A background ingestion route/job (analogous to `qa/sweep.ts`)
   - A new Qdrant collection `event_intelligence`
   - One new `RetrievalSource` in `sources.ts`
   - A `context_hints` field on the policy pull response

6. **Temporal** is the right durable scheduler for the background job once it needs retries and replay; the existing scaffold (`AgentRuntimePort`) is the activation path.

7. **The biggest single prerequisite** is activating Qdrant as the retrieval backend (`OFFGRID_ADAPTER_RETRIEVAL=qdrant`) so event summaries have a server-scale, payload-filterable home rather than a full-table-scan JSONB store.
