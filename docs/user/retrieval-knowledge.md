# Data & Retrieval

*Documented + verified 2026-07-07.* Surface: **Data (`/data`, plus Integrations / Data domains / Retrieval / Lineage tabs)**.

## What it is

The Data section is where source data comes **in**, gets **governed** on the way (PII masked, classified),
and becomes **traceable** — so every answer can be walked back to the systems it came from. It's the plumbing
under the Brain and every agent: connectors to your databases/warehouses/SaaS, ingest runs that report real
row counts, PII masking + a live redaction scanner, the data catalog, the vector-store view, and a
source→answer lineage graph.

The left-nav groups it into tabs (each a URL, deep-linkable and Back-coherent):

- **Integrations** — browse the connector catalog and add a source.
- **Connectors** (`/data`) — the connectors table, ingest runs, masking rules, catalog, vector index, erasure.
- **Data domains** (`/data-domains`) — the no-guess rule engine that maps a phrase to a connector (its own
  page — see [Data domains](data-domains.md)).
- **Retrieval** — the vector store behind retrieval: inspect and manage collections.
- **Lineage** — the source→answer graph for what ran.

## Why use it

- **Bring your systems in without leaking them.** Connect a database or object store; nothing leaves your
  infrastructure. PII is detected and masked as data flows, and you can preview exactly what gets redacted.
- **Honest counts, never fabricated.** A sync reports the *real* row count from the source, or marks the
  connector in **error** and records zero — it never invents a number.
- **Trace every answer.** The lineage graph shows which documents and datasets fed a run — the accountability
  trail behind a cited answer.
- **One declaration powers the builder.** Declaring a data domain here is what lets the plain-language builder
  wire a "read data" step to the *correct* system, by rule.

## When to use it

- **Wiring a source** — adding a connector and running its first sync.
- **Governing PII** — defining a masking rule, or checking what a redactor catches before you trust it.
- **Auditing provenance** — tracing where an answer's data came from (lineage).
- **Managing the vector store** — inspecting collections and counts behind retrieval.
- **Handling a data-subject request** — queuing an erasure across the platform.

## How to use it

### Connectors — add, sync, remove (full CRUD)

On **Integrations**, browse the catalog (relational databases, warehouses, object stores, streaming, SaaS /
REST, NoSQL) and add one; or on **Connectors** (`/data`) click **Add connector** — give it a **Name** and
**Type**, save. It appears in the connectors table with a status badge. Click a connector row to open its
detail (`/data/connectors/[id]`).

- **Sync now** (row menu) triggers an ingest run and reports the **records** it pulled. The run lands in the
  **Ingest jobs** table (connector, status, record count).
- **Remove** (row menu) deletes the connector, with confirmation.

> Live-query counts are wired for relational databases and REST/SaaS sources. Warehouses, object stores, and
> streaming sources are catalogued for reference but read metadata only — a sync on those reports what it can,
> not a fabricated count.

### PII masking rules + the redaction scanner

In the **PII masking rules** card, click **Add rule**: choose the **PII type** (email, phone, PAN, Aadhaar…)
and the **action** — **mask**, **tokenize**, or **block**. Toggle a rule enabled/disabled inline. Rules govern
what happens to detected PII as data flows through.

To *see it work before you trust it*, use the **PII scanner** card: paste text with fake PII and click **Scan
for PII**. It returns the detected entity types and a **redacted preview** with each value replaced by a typed
placeholder (`<EMAIL_ADDRESS>`, `<PHONE_NUMBER>`, `<IN_PAN>`, …). This is the honest proof that redaction
actually fires — not a promise, an observed result.

### Data catalog

The **Data catalog** table lists known datasets (dataset, source, row count, classification). It's your
inventory of what's queryable and how each set is classified (public / PII / PHI). Populated as connectors are
synced and datasets registered.

### Vector store (Retrieval tab)

The **Retrieval** tab shows the vector store behind retrieval: the active store, whether it's reachable, and
its collections (name, vector count, point count, status). Where the active store supports it, you get a **New
collection** button (name + vector size + distance metric) and a per-row **Delete** — full lifecycle on the
collections that back retrieval. The `/data` page also carries a **vector-index** card with a **Reindex** action
to (re)populate the external store from the Brain corpus, and an inspector that samples a collection and plots
its embeddings.

> **Two retrieval stores — know which is active.** By default the Brain answers retrieval from an *embedded,
> on-disk* store; the *external* vector store shown in the inspector is a separate, optional backend that stays
> empty until you explicitly reindex into it. So the Retrieval tab may honestly show an empty/unreachable
> external store while [Brain](brain.md) retrieval works perfectly — they are not the same store. Confirm
> retrieval by asking the Brain a question (see below), not by the external collection's count.

### Lineage

The **Lineage** tab draws the source→answer graph: the jobs that ran, the datasets/documents they consumed as
**inputs**, and what they produced as **outputs** (e.g. a retrieval that consumed your ingested SOP docs and
produced a result; an agent run that consumed documents and produced a signed run). Pick a namespace to scope
it. It's read-only exploration — the accountability trail, reconstructed from what actually executed.

### Erasure (data-subject request)

The **Retention & erasure** card queues a right-to-erasure: enter an email or subject id and click **Erase
subject**. It reports the request as **queued** and the scope it would propagate to (lake, KB, vector index,
memory, audit).

> **Honest status:** erasure currently **queues** the request and reports its scope; end-to-end propagation
> across every store is not yet fully wired. Treat it as request-capture, not a completed deletion, until the
> propagation path is live. Tracked in `docs/GAPS_BACKLOG.md`.

## How to check it's working

Every claim on this surface has an in-product signal — never check a container or a log:

1. **A sync reports real counts.** Add a relational connector pointed at a real database, click **Sync now**,
   and open the **Ingest jobs** table: the run should show a **non-zero record count** that matches the source.
   If the source is unreachable, the connector flips to **error** and the run records **0** — that's the
   no-fabrication guarantee, working. *(Verified: `syncConnector` reads the real count or marks the connector
   in error; it never invents rows.)*
2. **Masking actually redacts.** In the **PII scanner**, paste `Email jane.doe@acme.com and call
   +1-202-555-0142, PAN ABCDE1234F` and **Scan for PII**. It should return the entity types and a redacted
   string like `<PERSON> <EMAIL_ADDRESS> and call <PHONE_NUMBER>, PAN <IN_PAN>` — visible proof the redactor
   fires. *(Verified live.)*
3. **Retrieval returns cited hits.** Ingest a document in [Brain](brain.md), then ask for it back on the
   Brain **Retrieval** tab — your doc should be the top scored hit. That, not the external vector-store count,
   is the true retrieval signal. *(Verified: Brain retrieval returns scored, cited hits live.)*
4. **Lineage shows real jobs.** After a retrieval or an agent run, open **Lineage**: you should see the job
   with your ingested documents listed as **inputs** and a result/run as its **output**. An empty graph means
   nothing has run yet, not that lineage is broken. *(Verified: the graph shows retrieval and agent jobs with
   document inputs and run outputs.)*

If the **Retrieval** tab shows an unreachable/empty external store, that's expected when retrieval is served by
the embedded store — judge retrieval health by step 3, not by that count.

See `docs/HOWTO.md` for cross-surface recipes and `/docs/api` for the API contract. This surface is distinct
from [Brain](brain.md) (the ingestion→answer RAG layer) and [Knowledge](knowledge.md) (the org-wide chat
corpus) — see `docs/KNOWLEDGE_IA.md`.
