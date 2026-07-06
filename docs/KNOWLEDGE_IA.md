# Knowledge vs. Knowledge base — information architecture

The founder flagged a real overlap: two surfaces that read as the same mental model
("a corpus of documents you retrieve from") but had two names and two backing stores.
This documents what they actually are, the decision taken, and why.

## The two surfaces

| | **Organization Knowledge** | **Agent knowledge base** |
|---|---|---|
| Where | Sidebar → Workspace → **Knowledge** (`/knowledge`) | Inside **Brain** → `/brain?view=knowledge` |
| Backing store | Postgres: `org_knowledge_collections` / `_docs` / `_chunks`, JSONB embeddings | LanceDB (`documents` table), Qdrant swap-in via `OFFGRID_ADAPTER_RETRIEVAL=qdrant` |
| Lib | `src/lib/org-knowledge.ts` | `src/lib/brain.ts` |
| Retrieval math | cosine over JSONB vectors, in JS | LanceDB vector + optional BM25 hybrid (RRF fuse) |
| Access model | **role**-based allow-lists per collection (`allowedRoles`) | per-document **ACL** (owner / roles / subjects / data-class) |
| Who retrieves it | **Chat** (`/api/v1/chat/stream`, `orgKnowledge` flag), citations in the answer | **Agents / the retrieval router / evals** (RAG) — `searchDocuments` via `retrieval/sources`, `eval-runner`, `org-context`, `ingest` |
| Curated by | Admins, as a shared "Ask Your Org" corpus | Ingestion (SOPs/playbooks the agents ground on) |

## Data-model finding: TWO distinct stores

They are **not** the same store surfaced twice. They are two independent pipelines with
different databases, different embedding storage, different ACL models, and different
consumers. Confirmed by import graph:

- `org-knowledge.ts` is consumed by the chat stream route + the `/knowledge` pages only.
- `brain.ts` is consumed by evals, the router, ingest, org-context, and the Brain admin
  routes/pages — the agent-facing RAG path.

## Decision: keep separate stores, make the distinction UNMISTAKABLE + cross-link

Unifying the store was considered and **rejected as too invasive / high-risk** for this
change:

- The stores use fundamentally different engines (Postgres+JSONB vs LanceDB/Qdrant) and
  different ACL shapes (role allow-list vs per-doc owner/role/subject/data-class). A merge
  is a schema + retrieval-pipeline migration, not a read-layer merge.
- Two live critical paths consume them — **chat retrieval** and **agent/router RAG**.
  A store unification risks breaking both. The task's own constraint is the lowest-risk
  change that removes the confusion.

So the resolution is the clarify-and-cross-link option, done so the two are never again
identically named:

1. **Rename** the Brain tab + card from "Knowledge base" → **"Agent knowledge base"**.
   The sidebar item stays **Knowledge**; its page title stays **Organization Knowledge**.
   No two things share a name now.
2. **One-line explainer on each**, in the reader's own words:
   - Organization Knowledge — "the org-shared corpus retrieved in **chat**".
   - Agent knowledge base — "the document corpus your agents and the retrieval router
     pull from — LanceDB RAG".
3. **Bidirectional cross-link** so someone who landed on the wrong one gets to the right
   one in one click:
   - `/knowledge` → "Managing the docs your agents/router retrieve from? → Brain → Agent
     knowledge base"
   - `/brain?view=knowledge` → "Curating a shared corpus for chat? → Organization
     Knowledge"

## Files changed

- `src/app/(console)/knowledge/page.tsx` — explainer + cross-link to Brain.
- `src/app/(console)/brain/page.tsx` — KB card renamed "Agent knowledge base" + explainer + cross-link to `/knowledge`.
- `src/components/brain/BrainNav.tsx` — tab label "Knowledge base" → "Agent knowledge base".

## Retrieval unaffected (verified)

No lib/store/retrieval logic was touched — only labels, copy, and cross-links on the two
UI surfaces. `org-knowledge.ts` (chat) and `brain.ts` (RAG) are byte-unchanged, so chat
retrieval and Brain/agent RAG behave exactly as before.

## If a future unification is wanted (note for the parent / follow-up)

A true single-corpus model would mean picking one store (likely LanceDB/Qdrant via the
retrieval adapter) and giving it BOTH access models — collection role allow-lists AND
per-doc ACL — then pointing the chat stream's `orgKnowledge` path and the agent RAG path
at the same corpus, differentiated only by a `scope`/`shared-in-chat` flag, not a separate
table. That is a schema migration + a chat-retrieval rewrite and should be its own task
with its own test coverage; it is deliberately out of scope here.
