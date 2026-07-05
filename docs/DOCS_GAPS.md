# Docs gaps ledger

Gaps observed while writing the product docs (`/docs`, content in `src/lib/docs/`). Kept current as
docs + product evolve. Copy is written to `brand/` (outcomes-first, Off Grid voice, no em-dashes/
AI-slop) — re-audit on each new page.

## Coverage (as of the comprehensive pass)
Breadth is now comprehensive — a page per capability across Introduction, Core concepts, Build,
Govern, Operate, Integrations, API (with curl/Python/Node samples), and Self-hosting (~45 pages).
Content lives in per-section files under `src/lib/docs/` so pages can be deepened in parallel.

## Product/doc mismatches to verify or reconcile
- **Provenance signing default** — docs say agent answers "can be signed." Confirm the sign step
  runs on chat/agent runs by default vs. only on report export; reconcile wording.
- **Cloud egress / cloud models** — docs describe routing to cloud models "when policy allows," but
  no cloud provider clients are wired yet (local-only today). Phrased conditionally on purpose;
  make it concrete once cloud routing ships.
- **Permissions-aware retrieval** — Knowledge/architecture imply retrieval "respects who can see
  what." Verify real-time source-level permission binding vs. project/ABAC scoping only.
- **Temporal durable runs** — listed as a platform service; the runtime adapter is scaffolded but
  full durable-run wiring is the open Phase 6/8 item. Don't imply it's fully live.
- **Backups restore** — docs mention restore within a recovery target; verify the restore path is
  wired end-to-end (daily dump exists; DR failover is not configured).

## Depth still to add (per page)
- Screenshots / short walkthroughs on the capability guides (currently prose + steps, no images).
- More request/response examples on the console-API side (the model API has curl/Python/Node; the
  console REST routes point to the interactive reference only).
- A first-party **SDK** page becomes real once the SDK (Phase 7) exists; today it points at the
  OpenAI SDKs.
- Per-connector setup detail in the Integration catalog (endpoint formats, auth per source).

## Docs-platform gaps (the site itself)
- **Search** — no docs search yet (Portkey has ⌘K). Extend the console global search to docs, or add
  a docs-only index.
- **Prev/next + on-page TOC** — pages have no footer prev/next or right-rail table of contents.
- **Versioning** — none; fine for now.
- **Code-block copy button + syntax highlighting** — code renders monospaced but without a copy
  button or highlighting.
