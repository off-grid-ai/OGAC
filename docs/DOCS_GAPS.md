# Docs gaps ledger

Gaps observed while writing the product docs (`/docs`, content in `src/lib/docs.ts`). Each is
something the docs describe or imply that isn't fully true/built yet, needs verification, or is a
content area still to cover. Keep this current as docs + product evolve.

## Product/doc mismatches to resolve
- **Provenance signing in the pipeline** — the governed-pipeline doc says answers "can be signed."
  Verify the sign step is actually invoked on chat/agent runs by default (vs. only on report export)
  and reconcile the wording.
- **Cloud egress / cloud models** — docs describe routing to cloud models "when policy allows," but
  the routing/leash framework has no cloud provider clients wired yet (local-only today). Docs should
  not imply cloud is live until a provider is connected. Currently phrased as conditional ("when your
  policy allows") — keep it aspirational-but-honest; revisit when cloud routing ships.
- **Permissions-aware retrieval** — Knowledge doc implies retrieval "respects who is allowed to see
  what." Verify real-time source-level permission binding exists vs. project/ABAC scoping only.
- **Image models in chat** — verified live (juggernaut via sd-server). Fine.

## Coverage still to write (per-capability depth)
- Deeper guides with request/response examples for: Gateway routing rules, Agents + tools, Studio
  publish/share, FinOps budgets, Evals/golden sets, Fleet node config.
- **Integrations catalog** — a page listing every supported connector + how to configure each
  (Portkey has a big integrations section). Only a short Data page exists now.
- **SDK/code samples** — the API page points to the reference, but there are no per-language
  quickstart snippets (Python/Node/curl) like Portkey's landing. Add once the SDK (Phase 7) exists.
- **Self-hosting runbook** — the self-hosting page is a map, not a runbook. A real deploy guide
  (topology, env, TLS, scaling) belongs here or in DEPLOY.md, linked.

## Docs-platform gaps (the docs site itself)
- **Search** — no docs search yet (Portkey has ⌘K search). Could extend the console global search or
  add a docs-only search.
- **Prev/next + on-page TOC** — pages have no footer prev/next nav or right-rail table of contents.
- **Versioning** — no doc versioning; fine for now.
- **Copy audit** — all copy written against `brand/` (outcomes-first, Off Grid voice, no em-dashes/
  AI-slop). Re-audit on each new page.
