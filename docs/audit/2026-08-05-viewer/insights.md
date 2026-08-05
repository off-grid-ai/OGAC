# Insights — viewer-demo audit

Auditing as the AI Engineer + Principal UX/Usability/UI/QA/QC team. Screenshots at 1600px, both
demo tenants (Suraksha Life = insurer, Bharat Union Bank = bank), signed in as the read-only viewer.

## Verdict for this section (FINAL)

This section has the single worst finding of the whole audit surface available to it, and it's real:
the entire "AI behaviour" subsection (Traces, Prompts, Datasets, and the AI-overview cost/eval tiles)
is **not tenant-scoped at all** — Suraksha Life (insurer) and Bharat Union Bank (bank) are reading the
exact same underlying Langfuse project and are shown byte-identical trace IDs, timestamps, registry
counts, and — worst of all — the SAME prompt body, which names the other tenant by name ("You are a
compliant RM assistant for **Bharat Union**") rendered live on the Suraksha Life demo link. This is
proven, not suspected (see BLOCKER 1). Everything else is secondary to that, but there's plenty: the
Traces feature is showing raw audit-log rows dressed up as spans (illegible hashed IDs, a generic name
on every row, zero latency/cost throughout, a one-span "waterfall" that's a flat dot); Usage/Dashboards
is dead (two "chart-data 404" errors) and names the BI engine ("Superset") on-screen; Usage/Traffic
names "OpenSearch" in a live outage banner; and a prompt-detail page hands the read-only viewer four
fully-armed destructive controls that 403 on click — confirmed live. Outcomes/ROI and the Cost pages
are the genuine bright spot: legible, labelled, honest about estimate-vs-actual. Net: this section
would cost credibility on the first link sent out, before a viewer even gets to the second.

## BLOCKERS (severity first, then cheapest first)

1. **CROSS-TENANT LEAK — the entire AI-behaviour surface shares one unscoped store across both demo
   tenants.** `/insights/ai/traces`, `/insights/ai/langfuse-datasets`, `/insights/ai/langfuse-prompts`,
   and the AI overview tiles (`/insights/ai/overview`) return **byte-identical data** for Suraksha Life
   (insurer, org_suraksha) and Bharat Union Bank (bank, org_bharat). Proven programmatically: the first
   5 trace IDs + timestamps on `/insights/ai/traces` are identical strings on both tenants; the
   AI-overview tiles are identical (Trace records 100/100, Registry 102/102, Traces 544/544, Scored
   metrics 2/2, Traced cost $0.0000/$0.0000); the one dataset (`cross-sell-eval-set`) and one prompt
   (`rm-cross-sell-system`) both exist on *both* tenants. **The worst part is visible on-screen, not
   just in the IDs**: opening that prompt's body from the Suraksha Life (insurer) demo link shows
   `You are a compliant RM assistant for Bharat Union. Recommend only suitable products.` — Bharat
   Union Bank's own system prompt, naming the other bank, rendered live to anyone sent the insurer
   link. Screenshot: `insurer/prompt-detail2.png` (taken on `suraksha-onprem-console...`, body reads
   "for Bharat Union"). Root cause: `src/lib/langfuse.ts` reads back from a single global
   `OFFGRID_LANGFUSE_URL` keypair with no per-org Langfuse project/filter — the file's own comments
   confirm per-org keys are not yet provisioned via OpenBao and it "fall[s] back to the current env
   keys UNCHANGED" for every org. This is the same class of bug as the `/insights/audit` leak fixed an
   hour ago, in a different, unfixed surface. Fix: either provision per-org Langfuse projects/keys
   before this link goes out, or pull this entire AI-behaviour subtree (Traces/Prompts/Datasets/
   Registry/Overview cost+eval tiles) from both viewer links until it is scoped — do not ship this
   subsection as-is to either tenant.

2. **Viewer sees fully-armed destructive controls that 403 — `/insights/ai/langfuse-prompts/rm-cross-sell-system`.**
   "Delete version", "Delete all" (red/destructive styling), "Promote to production", and each label's
   "×" remove button render fully enabled for the read-only viewer. Clicking "Delete version" pops a
   native `confirm()` ("Delete version 1 of rm-cross-sell-system?") and, on accept, the app fires the
   DELETE and shows a red "forbidden" toast. Confirmed live via automated click (see
   `insurer/prompt-after-delete-version.png`). Source: `src/components/observability/LangfusePromptDetail.tsx`
   — every action button is gated only on local `busy` state, never on `useViewerMode()` (zero
   consumers, per the brief). This is the exact top-severity pattern the brief calls out. Fix: gate all
   four actions (delete version/all, promote, remove-label, add-label) on `useViewerMode()` and render
   them disabled with a tooltip ("Read-only demo — write disabled") instead of armed-then-403.
   Screenshot: `insurer/prompt-detail2.png` (armed) + `insurer/prompt-after-delete-version.png` (403 toast).

3. **Trace list and trace detail are illegible — `/insights/ai/traces`.** Every row's "Trace" name is
   the literal string `audit.event.v2` (the audit-event schema id, not a description of what happened),
   under a 90+ character raw hex blob as the "id". Every row: User `—`, Latency `0ms`, Cost `$0.0000`.
   Clicking "Inspect" opens `/insights/ai/traces/<96-char-hex>` whose only content is a page heading
   that IS that hex string, and a "span waterfall" that is a single green dot at 0ms labelled
   `audit.event.v2` — not the "deep-linked span waterfall with its recorded timing and model data" the
   list page promises immediately above it. To an unguided stranger this reads as broken, not as a
   trace viewer. Root cause: audit-log rows are being pushed into the trace store without a human name
   or real span data (`src/lib/langfuse.ts` reads back exactly what was pushed). Fix: give pushed
   traces a readable `name` (the actual action, e.g. "Death claim eligibility check"), and/or stop
   surfacing rows that only ever produce a one-span, 0ms waterfall. Screenshots: `insurer/insights_ai_traces.png`,
   `insurer/trace-detail.png`.

4. **Usage → Dashboards is dead and names the BI engine on-screen — `/insights/usage/dashboards`.**
   Both panels ("Requests over time", "Tokens by model") render `Query error: chart-data 404` in red.
   The page copy itself says "Superset runs each governed query..." and has an "Open in Superset" link
   — the OSS BI engine name is on the face of the screen, not in a tooltip, exactly the case the brief
   flags as fatal here. Fix (cheap): rename the copy to a generic "BI charts" / "governed dashboards"
   label (there's a `publicLabel()` mapper for this already), and fix the 404 or hide the panel behind
   an honest "not connected" empty state instead of a raw query error. Screenshot: `insurer/insights_usage_dashboards.png`.

5. **Traffic page names "OpenSearch" directly in a live outage message — `/insights/usage/traffic`.**
   Right panel: "Gateway usage" → "OpenSearch is unreachable — gateway usage analytics are unavailable."
   Two problems in one string: the OSS engine name on-screen, and a visible backend outage on the demo
   box. (Recent commits show this exact system has had auth/offline issues before — this is a live
   recurrence, not a one-off.) Fix: label it "gateway usage analytics" only, and page the failure so it
   doesn't stay down during a demo window. Screenshot: `insurer/insights_usage_traffic.png`.

6. **Eval dataset has zero items and zero runs — `/insights/ai/langfuse-datasets/cross-sell-eval-set`.**
   The one dataset that exists ("cross-sell-eval-set", golden Q/A pairs for RM cross-sell grounding
   checks) opens to "Items (0)" and "Runs (0)". For a section whose whole pitch is "prove quality over
   time," the one artifact built to do that is empty — nothing here backs any quality claim. Fix: seed
   3-5 real items and at least one experiment run so the detail view has something to show.
   Screenshot: `insurer/dataset-detail.png`.

7. **Eval-score trend chart is empty and its own date axis contradicts itself — `/insights/ai/overview`.**
   "Eval score trend" plots `faithfulness` and `quality` against a 0-1 axis, but no line is drawn, and
   the x-axis reads `07-29 ... 07-29` — the same date at both ends, i.e. effectively a zero-width
   window despite the page defaulting to the "7d" range toggle. "SCORED METRICS: 2" above it implies
   there should be two lines. Fix: default to a window that actually contains the two metrics'
   timestamps, and confirm the chart renders at least one visible point before shipping. Screenshot:
   `insurer/insights_ai_overview.png`.

8. **Cost Overview total contradicts its own breakdown — `/insights/cost/overview` vs `/insights/cost/users`.**
   Overview stat tile: "TOTAL SPEND $0.01". The per-user breakdown one click away lists three rows,
   each "$0.00", which sum to $0.00, not $0.01. Both numbers are real (rounding: sub-cent spend
   rounding up at the aggregate and down at each row), but a skeptical reader doing the obvious
   add-it-up check sees two panels disagree. Fix: show 4 decimal places consistently (the AI-behaviour
   page already does `$0.0000`) so the parts visibly sum to the whole. Screenshots:
   `insurer/insights_cost_overview.png`, `insurer/insights_cost_users.png`.

## RISKS

- **`/insights/cost/users`** — the "User" column mixes one real demo human (`demo-insurer@getoffgridai.co`)
  with two internal system callers shown as raw identifiers: `trigger:topic` and `service@offgrid.local`.
  "attribute spend to individual callers" reads oddly when two of three "callers" are internal plumbing
  with an internal domain (`offgrid.local`) visible. Relabel as "Automated trigger" / "Platform service"
  rather than the raw id.
- **`/insights/usage/overview`** — "P95 LATENCY: 46596 ms" (46.6 seconds), and the drift banner above it
  says the *recent* p95 is 55808 ms vs a 4056 ms baseline. Even flagged transparently as "degradation,"
  a 46-56 second p95 for an AI gateway reads as broken/unusable rather than "governed." Worth confirming
  this metric is actually per-call gateway latency and not something that includes human-in-the-loop
  wait time bleeding into a metric labelled "latency" — if so, exclude it or relabel.
- **URL slugs leak the underlying engine** — `/insights/ai/langfuse-datasets` and
  `/insights/ai/langfuse-prompts` put "langfuse" directly in the address bar (on-screen copy itself is
  clean: "Datasets", "Prompts"). Lower severity than a face-of-screen leak, but a curious viewer who
  reads the URL bar sees it. Cheap fix: rename the route segments (`ai/datasets`, `ai/prompt-registry`
  already exists as a separate, differently-modelled page — worth reconciling into one).
- **Two prompt registries** — `/insights/ai/langfuse-prompts` (CRUD) and `/insights/ai/prompt-registry`
  (read-back tabs: Prompts/Datasets/Sessions) both show the same one prompt, `rm-cross-sell-system`,
  via two different UIs reachable from the same left-nav group. Not wrong, but redundant enough that an
  unguided visitor may reasonably wonder which one is "real."
- **`/insights/outcomes`** "By department" table has a single row, "Unassigned" — every app in this org
  is unassigned to a department, so the department rollup (the interesting cut for a business buyer)
  never differentiates. Not broken, just currently proving nothing beyond the org total.

## Appropriateness findings

- No credentials, secrets, or connection strings observed anywhere in this section (checked the
  prompt bodies, dataset metadata, and cost/user tables specifically for leaked values — clean).
- **Cross-tenant leakage IS present in this section** — see BLOCKER 1. This is the finding to lead
  with: the AI-behaviour subtree (Traces/Prompts/Datasets/Registry/Overview) is shared, unscoped, and
  shows one tenant's named content (Bharat Union's system prompt) to the other tenant's viewer link.
- OSS engine names ON SCREEN (not tooltip): **Superset** (`/insights/usage/dashboards`, page body copy
  + link text) and **OpenSearch** (`/insights/usage/traffic`, error string). Both are BLOCKERS above.
  "Langfuse" appears only in URL slugs (RISK, not BLOCKER) and in code comments (not viewer-visible).
- `/insights/audit` (owned by another team, not deep-audited per instructions): redirects cleanly to
  `/governance/evidence/audit` on both tenants; every row's Project column reads `org_suraksha` on the
  insurer link and `org_bharat` on the bank link — no cross-mixing observed. Looks correct on both now.

## What is genuinely strong here

- **`/insights/outcomes`** (ROI) is the standout page in this section: real ₹ numbers, an honest
  "estimate" vs "actual" badge on every tile, a plain-language explanation of where the estimate comes
  from ("15 min/run @ ₹2,500/hr", editable), and a ranked "Top apps by value" list with real app names.
  This is exactly the "prove business impact" pitch delivered well.
- **`/insights/cost/models`** proactively explains its own zero: "Local models report $0 spend" sits
  directly above a table showing $0.00/$0.01 — the page answers the "why is this zero" question before
  the viewer has to ask it. This is the right pattern; the eval-score chart and traces list should copy it.
- **Viewer-mode IS correctly wired on the list/create forms**: "Save prompt" (`/insights/ai/langfuse-prompts`),
  "Create dataset" (`/insights/ai/langfuse-datasets`), and "Add item" (dataset detail) are all genuinely
  `disabled` for the viewer role (verified via DOM `isDisabled()`, not just visual styling) — so the gap
  is specifically the prompt-*version* detail page's lifecycle actions, not the whole section.
- Usage/Latency and Usage/Adoption charts render real, varied lines/bars with sensible model names
  (llama3.1:70b, claude-3-5-haiku-latest, qwen3-vl-8b) — no placeholder/lorem data anywhere in this section.

## LATER

- `/insights/{accounting,analytics,copilot,drift,finops,platform,quality*,reports,roi,siem}` are all
  redirect stubs to routes owned by other sections (`/solutions/quality/*`, `/governance/*`,
  `/runtime/*`, `/operations/*`) and are not reachable from the Insights left-nav (confirmed: the nav
  only exposes Outcomes / AI behaviour / Usage / Cost). Not on the three-click demo path; dead code to
  clean up eventually, not a demo defect today.
- Two structurally separate "prompt registry" surfaces (`ai/langfuse-prompts` vs `ai/prompt-registry`)
  and their near-duplicate `ai/langfuse-datasets` — worth consolidating post-demo.
