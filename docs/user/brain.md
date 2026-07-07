# Brain

*Documented + verified 2026-07-07.* Surface: **Intelligence → Brain (`/brain`)**.

## What it is

The Brain is where a document becomes a **grounded, cited answer**. You ingest text, files, images, or
a dataset summary; the Brain embeds and indexes each one; and from then on any question — asked here,
in Chat, or by an agent — can be answered *strictly from what you put in*, with a clickable citation
back to the source. It is the RAG layer of the platform: retrieval that never leaves your infrastructure
and never invents a source.

It's more than a document bin. The Brain is a **retrieval router**: it reads the intent of a question and
fans it across your knowledge base, your structured databases, and your registered tools — then fuses the
hits with provenance on every one. The page has six tabs (each is a URL — `/brain?view=…`, so every tab is
deep-linkable and Back-coherent):

- **Router** — route a query across all sources and see what it hit and why.
- **Tools** — the HTTP/service tools the router can reach (managed under Build → Tools).
- **Retrieval** — search the knowledge base directly and read the scored, cited hits.
- **Agent knowledge base** — the document corpus: ingest, browse, delete.
- **Prompts** — versioned, immutable prompt templates.
- **Evals** — a golden question set that proves retrieval still answers correctly.

## Why use it

- **Answers you can defend.** Every grounded answer cites the exact document it came from — no "the model
  said so," a source you can open and check.
- **On-prem and permission-aware.** Documents carry per-document access rules (owner / roles / subjects), so
  a person only ever retrieves what their role may see. Nothing leaves your servers.
- **No fabrication.** If nothing in the corpus matches, retrieval returns nothing rather than a plausible
  guess. A grounded answer with no sources is honestly empty, not made up.
- **One corpus, many consumers.** What you ingest here grounds the Brain tab, agents, and grounded Chat —
  ingest once, cite everywhere.

## When to use it

- When an answer **must** cite source docs — SOPs, policies, playbooks, handbooks.
- When you're standing up an assistant or agent that should answer **only from your corpus**.
- When you want to confirm a newly-added document is actually retrievable before you rely on it.
- When you need to see **why** a question routed to a database or a tool instead of the knowledge base.

## How to use it

### Ingest a document (Agent knowledge base tab)

Open **Brain → Agent knowledge base** and click **Ingest**. Four kinds, each opening a form:

- **Ingest text** — give it a **Title** and **Content**, click **Index**. Best for pasting an SOP or a note.
- **Ingest a file** — pick a text or Markdown file (`.txt`, `.md`, and similar text formats). Click **Index file**.
- **Ingest an image** — pick an image; the gateway captions it and indexes the caption. Click **Caption & index**.
- **Ingest from a dataset** — pick one of your declared datasets from the data plane to index a summary of it.

Each ingested doc is *extracted, embedded, and indexed with provenance*. It appears immediately as a card in
the corpus grid (title, source badge, snippet). Click a card to open its detail; use the delete control on a
card to remove it (with confirmation). This is full CRUD — create by ingesting, read the grid + detail, and
delete per card.

### Retrieve with citations (Retrieval tab)

Open **Brain → Retrieval** and ask a real question — the field prompts you *"Ask the Brain — e.g. how do I
handle a death claim?"*. Hit **Search**. You get back a **scored, ranked list of hits**: each shows the
document title, its source badge, a snippet, and a relevance score. These hits *are* the citation set — the
same set Chat and agents cite from. No matches shows *"No matches."* honestly rather than a fabricated answer.

### Route a query across all sources (Router tab)

Open **Brain → Router** and route a question — e.g. *"how many rows in the customers dataset?"*. The router
classifies intent and fans the query across the **knowledge base**, your **structured databases** (declared
data domains), and your **tools/services**, then returns the fused hits with the source of each. This is how
you see *why* a question went to a database instead of the corpus. No hits shows *"No hits across the routed
sources."*.

### Prompts, tools, and evals

- **Prompts** — add versioned, immutable prompt templates; publishing a change creates a new version (the
  old one is preserved).
- **Tools** — read the HTTP/service tools the router can reach; register/manage them under **Build → Tools**
  (the tab links out with **Manage tools →**).
- **Evals** — add golden cases (a query + its expected source) and **Run eval**. The score badge (e.g.
  *42/50 · 84%*) tells you honestly how many retrievals still land on the right document — your regression
  gate for the corpus. Delete a case with confirmation. See [Evals](evals.md) for the deeper eval surface.

## How to check it's working

The Brain is honest about grounding — you can prove it end to end without touching a server:

1. **Ingest a distinctive fact.** In *Agent knowledge base*, ingest text with a title and a sentence only
   your org would know (e.g. *"The lapse grace period is 30 days after a missed premium."*).
2. **Ask for it back.** Switch to the *Retrieval* tab and ask a question that fact answers (*"how long is the
   grace period after a missed premium?"*). The document you just ingested should come back as the **top hit**,
   with its title, its source badge, and a relevance score — that is the citation you'd get in Chat.
3. **Confirm the negative.** Ask something the corpus does *not* cover. You should get *"No matches."* — proof
   the Brain returns nothing rather than inventing an answer.
4. **Route it.** In the *Router* tab, ask a counting question about one of your datasets; it should route to
   the structured-database source, not the knowledge base — the decision is shown alongside the hits.

If a freshly-ingested document does **not** come back as a top hit for its own content, the embed/index step
didn't land — re-ingest it and check the corpus card actually appeared.

> **Two independent retrieval stores (know which you're looking at).** The Brain answers retrieval from its
> own on-disk index by default — this is what powers the *Retrieval* and *Router* tabs, and it is live and
> working. The **Data & Retrieval** vector-store *inspector* (see [Data & Retrieval](retrieval-knowledge.md))
> reads a *separate* external vector collection that stays empty until an operator explicitly re-indexes into
> it. So it's expected and correct that the Retrieval tab returns rich cited hits while the vector-store
> inspector shows a `0`-vector `offgrid-brain` collection — they are not the same store. Judge whether the
> Brain "works" by the *Retrieval tab returning your ingested doc*, never by the inspector's count.

See `docs/HOWTO.md` for cross-surface recipes and `/docs/api` for the API contract. The Brain is distinct from
[Knowledge](knowledge.md) (the org-wide chat corpus) and from [Data & Retrieval](retrieval-knowledge.md) (the
connector/vector-store/lineage plane) — see `docs/KNOWLEDGE_IA.md`.
