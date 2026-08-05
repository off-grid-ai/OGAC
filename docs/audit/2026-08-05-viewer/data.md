# Data — viewer-demo audit

Audited live on both demo tenants: `demo-insurer@getoffgridai.co` (role `viewer`, org
`org_suraksha`, Suraksha Life) at `https://suraksha-onprem-console.getoffgridai.co`, and
`demo-bank@getoffgridai.co` (role `viewer`, org `org_bharat`, Bharat Union Bank) at
`https://bharatunion-onprem-console.getoffgridai.co`. Routes covered: `/data`, `/data/connectors/[id]`,
`/data/catalog`, `/data/catalog/[id]`, `/data/catalog/governance`, `/data/domains`,
`/data/domains/[id]`, `/data/warehouse`, `/data/warehouse/query`, `/data/warehouse/models`,
`/data/lineage`, `/data/knowledge`, `/data/knowledge/indexes`, `/data/knowledge/indexes/collections`,
`/data/sources`, `/data/lake`, `/data/flows/replication`, `/data/flows/replication/[id]`, plus API
probes of `connectors`, `etl`, `warehouse`, `ingest-jobs`, `data-domains`, `data-assets`,
`masking-rules`, `retention`, `lineage-graph` on both tenants.

## Verdict for this section

This section has the single strongest asset in the whole console — real, populated, click-through
lineage (54 jobs, 100 datasets, 160 edges), a genuinely good Catalog with live PII/freshness/sync
status per dataset, a Governance page that shows exactly which datasets are stale/broken and why,
and Data Domains that read like a real BFSI data dictionary. That is the good news, and it would
build real confidence on its own. But a data-literate investor who does the two things this
audience is explicitly expected to do — open dev tools / hit the obvious API, and click a live
button — finds a third confirmed **cross-tenant data leak** (the insurer viewer can read the bank's
warehouse table names and see the bank's own connector on their own tenant's replication screen),
OSS engine names and raw internal infrastructure (a `.local` hostname, a private IP, three flavors
of loopback connection string) splashed across five different screens, and three different write
controls that fail with a bare "forbidden"/"failed" toast instead of the explained read-only message
the rest of the console promises. Taken together this section currently **costs credibility on
inspection**, even though the underlying feature depth is real and, once these are fixed, would be
one of the most convincing parts of the demo.

## BLOCKERS (cheapest first; the cross-tenant leak is pinned to the top regardless of cost)

### 0. THIRD CONFIRMED CROSS-TENANT LEAK — proof below — ranks above everything else here

`/data/flows/replication` (screenshots `insurer/data_flows_replication.png` and
`bank/data_flows_replication.png`) render **pixel-identical content** on both tenants: a
connection literally named **"CoreBank to Off Grid Warehouse"**, status `active`, "Last run
succeeded", one job row with `76,573` records started `2026-07-17 08:10`, same connection id
`63834d41-f317-4321-9455-c82ba2a3e936`. Confirmed by diffing `GET /api/v1/admin/etl` between the
two live sessions: **byte-for-byte identical response**. This is a real, nav-reachable page (Data →
Flows → Replication), not just an API artifact — a stranger on the insurer tenant sees a banking
connector called "CoreBank" on their insurance company's screen.

**Second-order exposure, same root cause:** `GET /api/v1/admin/warehouse`, hit while signed in as
the **insurer** viewer, returns the **bank tenant's own ClickHouse database/table names with row
counts** — `bharatunion.candidates` (177 rows), `bharatunion.claim_documents` (400 rows),
`bharatunion.employees` (500 rows), `bharatunion.pricing_rate_card` (20 rows), etc. — literally
labelled with the other tenant's org slug. Confirmed identical byte-for-byte between the two live
sessions. Reachable by any signed-in visitor who opens devtools/curls the API, which the brief
puts explicitly in scope ("they can read everything, including admin surfaces").

Root cause (read, not fixed): `src/app/(console)/data/flows/replication/page.tsx` calls
`airbyteEtl.listConnections()` with **no org/tenant scoping**; `src/app/api/v1/admin/etl/route.ts`
calls `airbyteEtl.listConnections()`/`listWorkspaces()` unscoped; `src/app/api/v1/admin/warehouse/route.ts`
calls `clickhouseWarehouse.listTables()` with no scope argument, gated only by `requireAdmin` (which
a demo viewer passes). Contrast with `src/app/(console)/data/warehouse/page.tsx`, which correctly
scopes via `currentWarehouseDatabase()` — the scoping primitive already exists and works; it's just
not applied to these three call sites. Fix: apply the same `currentWarehouseDatabase()` scoping to
all three.

### 1. Viewer write-controls fail with a bare, unexplained error — not the promised "read-only demo" toast — confirmed on 3 separate controls

The brief for this audit states a client-side interceptor now stops a viewer's writes with a
friendly "This is a read-only demo" toast. Tested live (automated clicks, signed in as the insurer
viewer) on three different Data-section controls — **all three instead show a bare, unexplained
error**:

- **PII scanner → "Scan for PII"** on `/data` (`insurer/click_scanforpii.png`): **"Scan failed"**.
- **PII masking-rule toggle switch** on `/data` (`insurer/click_masktoggle.png`): **"Failed to
  update rule"**.
- **Replication → "Run sync"** on `/data/flows/replication` (`insurer/click_runsync.png`): the
  single word **"forbidden"** with an error icon — the rawest possible failure, exactly the
  pattern the brief names as top-severity.

Root cause (read, not fixed): `src/components/ViewerWriteInterceptor.tsx` wraps `window.fetch` and
does call `toast.info('This is a read-only demo', ...)` before short-circuiting a mutating request
— but each of these three components has its own `catch`/`!res.ok` branch that immediately fires
`toast.error('<hardcoded generic message>')` afterward (e.g. `src/components/data/PiiScanner.tsx`:
`if (!res.ok) throw new Error('failed'); ... catch { toast.error('Scan failed'); }` — it never reads
the friendly `reason` field the server/interceptor actually returns). Whichever toast wins the
visible slot, the generic one is what the viewer is left looking at. Not isolated to these three —
the interceptor file's own comments describe ~216 write call sites added before it existed, so this
pattern likely repeats app-wide. Fix: have each component surface `body.reason` when present, or
suppress a component's own error toast when the response is the shared 403 shape.

### 2. `/data/warehouse` says "holds no tables yet" on a genuinely populated warehouse

Screenshot `insurer/data_warehouse.png`: TABLES 0, DATABASES 0, TOTAL ROWS 0, "The warehouse is
online but holds no tables yet. Run a pipeline to move source data in." — a dead end for an
unguided viewer who cannot run a pipeline, and not even true: the same ClickHouse instance holds
20+ tables with real row counts (see BLOCKER #0). The page's tenant-scope lookup
(`currentWarehouseDatabase()` → slug `suraksha`) doesn't match any seeded database name (`bfsi`,
`bharatunion`, `airbyte_internal`, `default`) — a scope mismatch presenting as "nothing exists."
Fix: seed a ClickHouse database actually named for the Suraksha slug, or fix the slug→database map.

### 3. The `/data` hub's own numbers contradict the dedicated Catalog and Knowledge pages, one click apart

- **Datasets**: the hub's "DATASETS" tile reads **0** ("0 cataloged rows"), and its own embedded
  "Data catalog" mini-table (further down the same page) is empty — but `/data/catalog`, one click
  away in the same nav group, shows **4** populated datasets totalling 2,117,099 rows. The hub reads
  a different, empty legacy store (`listDatasets()` → `GET /api/v1/admin/datasets` → `{"data":[]}`)
  from the one Catalog reads (`data-assets`, populated).
- **Knowledge**: the hub's "KNOWLEDGE INDEX" tile reads **3 vectors**; the "Meaning-based search"
  card further down the same page reads "Collection `offgrid-brain` · 3 indexed · **0 source
  doc(s)**" (odd on its own — 3 indexed from 0 available sources); `/data/knowledge` shows a
  collection with **10 documents**. None of 3 vectors / 0 source docs / 10 documents reconcile.

(Evidence: `insurer/data_full.png`, the true full-height capture of `/data` — see the method note
below for why the shared harness's screenshot missed this entirely.) Fix: point the hub's tiles and
embedded widgets at the same stores the dedicated pages use.

### 4. OSS engine names on the face of the screen, in three places

- `/data/catalog` and `/data/catalog/[id]` (`insurer/data_catalog.png`,
  `insurer/data_catalog_da_42dd63d8-4ff.png`): a dataset's "source" line reads `Object store
  (SeaweedFS)` / `Warehouse (ClickHouse)` verbatim — `src/app/(console)/data/catalog/page.tsx:115`
  and `.../catalog/[id]/page.tsx:94` interpolate `asset.source` directly, never through
  `publicLabel()` (`src/lib/lineage-labels.ts`).
- `/data/warehouse/models` (`insurer/data_warehouse_models.png`): "Creating one applies the DDL
  live to **ClickHouse**..." and "Applied live to **ClickHouse** on save."
- `/data` hub's "Vector DB inspector" widget (`insurer/data_full.png`): `KIND: qdrant` in a plain
  dropdown.

Fix: route `asset.source` and these labels through `publicLabel()` — "the warehouse" / "the
document store," never the engine name, on the visible face of a screen.

### 5. Raw internal infrastructure on screen — a `.local` hostname, a private IP, and loopback connection strings

- **`/data` hub's "Vector DB inspector"** (`insurer/data_full.png`): prefilled
  `URL: http://offgrid-s1.local:6333/` — a literal on-prem fleet `.local` hostname and port, sitting
  next to the `qdrant` engine name from #4. The single worst combination in this section: internal
  hostname + OSS name, both on-screen, both prefilled as if normal.
- **`/data/lake`** (`insurer/data_lake.png`): the Object store card shows `192.168.117.4:8080`
  directly next to "21 of 129 slots used" — a private LAN IP and port.
- **`/data/connectors/[id]`** (`insurer/data_connectors_surcon_coreins.png` and equivalents for
  every other connector on both tenants): the raw endpoint string is printed on the Configuration
  card — `postgres://coreins@127.0.0.1:5433/suraksha`, `http://127.0.0.1:9010`,
  `mysql://policyadmin@127.0.0.1:3307/suraksha` on the insurer side; `kafka://127.0.0.1:8948` plus
  three more loopback MySQL/MSSQL/Postgres endpoints and an S3/REST endpoint on the bank side.
  Every single seeded connector on both tenants exposes a raw loopback connection string. (The
  password itself is correctly redacted — see Appropriateness below — but the rest of the string
  reads as "this is a laptop Docker Compose stack," undercutting the exact claim this section exists
  to prove.)

Fix: never render a literal endpoint/URL on a visible card — show a service label; keep the literal
value, if needed at all, behind an admin-only "copy" affordance.

### 6. Ingest jobs table is empty on both tenants

`/data` hub, "Ingest jobs" card (`insurer/data_full.png`): headers "Connector / Status / Records"
with zero rows, even though Catalog shows 4 datasets with real `lastRefreshAt` timestamps implying
ingestion happened. `GET /api/v1/admin/ingest-jobs` confirms `{"data":[]}`. An empty table on a
populated tenant is a named BLOCKER example in the brief. Fix: seed a handful of historical
ingest-job rows consistent with the Catalog's freshness dates — seed data only, no code change.

## RISKS

- `/data/lake`'s "If a disk fails, what happens to these files? ... There is ONE copy of every
  file... nothing else has it," under a red "needs attention" badge, is honest and well-framed, but
  a data-literate investor reading "1 copy / 1 machine / 1 rack / 1 site" on a product pitching
  enterprise data governance may read it as "this isn't resilient" rather than "single-node demo
  box." Not fabricated, so not a BLOCKER — worth a demo-specific caveat if this screen gets shown
  deliberately. (`insurer/data_lake.png`)
- `/data/knowledge/indexes` ("Vector collections") reads "No collections found in the vector
  store," contradicting the hub's own "3 vectors" tile. The same page hit as
  `/data/knowledge/indexes/collections` threw a client chunk-load error (`HTTP 400` on a JS chunk)
  and a `429` on `/api/v1/admin/my-work/count` in the same run — plausibly this audit's own request
  volume tripping a rate limiter on the shared dev box rather than a product bug, but worth a clean
  re-check: if "no collections" is what renders when that fetch throws, it's another
  failure-presents-as-emptiness case. (`insurer/data_knowledge_indexes.png`,
  `insurer/data_knowledge_indexes_collections.png`)
- Bank tenant's Catalog list mixes dataset naming conventions inconsistently — some rows prefixed
  with the warehouse namespace (`bharatunion.dim_branch`), others not (`dim_customer`,
  `fact_transactions`, `kyc_documents`) — cosmetic, reads as unfinished on close inspection.
  (`bank/data_catalog.png`)
- `/data/lineage/[destination]` 404s ("Page not found") for any destination id that isn't one of
  the app's own reserved leaf names (`graph`/`runs`/etc.) — not a real user-facing defect (nothing
  in the product links to an arbitrary id there), but worth a guard against a stray bookmark/typo
  landing on a bare 404 instead of the console's styled not-found page. (Confirmed it does use the
  styled 404 — `Page not found / That route doesn't exist` — so this is genuinely LATER, not a
  BLOCKER: no jarring unstyled crash.)

## Appropriateness findings

- **`GET /api/v1/admin/connectors` password leak — RE-VERIFIED FIXED.** Confirmed live, signed in
  as `demo-insurer@getoffgridai.co` (viewer, `org_suraksha`): the list endpoint now returns
  `postgres://coreins@127.0.0.1:5433/suraksha` — user@host, no password. Also checked
  `POST /api/v1/admin/connectors/:id/test` (returns the read-only-demo 403, no payload) and
  `/api/v1/admin/connectors/:id/resources` (returns only a resource-name array). No secret leaks
  anywhere in the connectors API today — the fix holds. What's still exposed is the rest of the
  connection string (see BLOCKER #5), which is a real but lesser problem than a plaintext password.
- The masking rules, retention policies, and PII classifications in this section **do
  demonstrably do something**, unlike a bare listing — this is a genuine strength, detailed below.
- Seeded PII throughout both tenants reads as correct Indian-BFSI fiction (PAN, Aadhaar, IFSC,
  GSTIN, UPI, `.example` email domains, `claims@suraksha.example` / `data-platform@bharatunion.example`
  owner emails) — nothing that reads as a real person's data, nothing that reads as junk
  (`test`/`foo`/lorem). No issue found here.

## What is genuinely strong here

- **Lineage is real and populated**, not a token graph: `/data/lineage` shows 54 jobs, 100
  datasets, 160 edges spanning connectors → agent runs → chat conversations → retrieval results,
  e.g. `surcon_coreins:premiums` + `surcon_coreins:claim_documents` → `agent:agent_e48f144d` →
  `run_008ec4f1`. This is the single best proof-of-substance in the section and is exactly what a
  data-literate investor is looking for.
- **Data Domains** (`/data/domains` and detail) reads like a real business data dictionary —
  "claim documents," "advisors," "candidates" with aliases, classification, lawful basis, connector
  binding, and "referenced by pipelines" / "read by apps" back-references. Zero jargon on this
  surface.
- **Catalog Governance** (`/data/catalog/governance`) is a standout: live counts of fresh/stale/
  broken-sync/due-for-disposal/holding-PII datasets, a "why" column explaining each freshness alert
  in plain language ("Last refresh 616h ago, over the 6h SLA"), and working retention-policy editors
  per record class with an "Apply retention now" action.
- **PII masking rules are real, not decorative**: 8 rules covering PAN (redact), Aadhaar (mask),
  account number (mask), email (mask), phone (mask), IFSC (allow), GSTIN (redact), UPI (hash) — a
  correct, specific BFSI PII taxonomy, all enabled, with the Catalog cross-referencing which
  datasets hold which PII types.
- **The Catalog dataset detail page** (`/data/catalog/[id]`) is a genuine full management surface:
  governance posture, editable classification, PII tags, retention/disposal controls with a legal
  hold switch, all in one place.
- **The Warehouse Query page** (`/data/warehouse/query`) offers four well-written, business-framed
  starter queries ("Premium persistency by band — the retention health check") with zero engine
  jargon — a good model for what #4 should look like everywhere else.
- Both tenants are genuinely populated with tenant-appropriate data (insurer: policies/claims/
  premiums; bank: accounts/loans/transactions) — this is not a "works for one tenant only" problem
  outside of the specific leak in BLOCKER #0.

## LATER

- `/data/lake`'s bucket list includes a bucket named `provit` — unclear/odd name, low priority.
- Dataset naming is inconsistent within a single Catalog list (dotted-namespace vs bare names) —
  see RISKS.
- `/data/sources` is a re-export of the `/data` hub page (`export { default } from
  '.../data/page'`) rather than a dedicated connectors-only view matching its own nav description
  ("Enterprise systems, connectors, credentials, and connection tests") — works, just not what the
  label promises; low priority since the hub does contain a connectors table.

## Method note (read this before trusting any other section's screenshots from today)

`scripts/audit-shoot.mjs` calls `page.screenshot({ fullPage: true })`, which measures
`document.documentElement.scrollHeight`. This console's shell is a fixed `h-screen` flex layout
with the real scroll region on an inner `[data-og-shell="page"]` div (`overflow-y-auto`), so the
document itself never grows past the 1000px viewport — `fullPage: true` silently produces a
1000px-tall image no matter how long the page actually is. Measured directly: `/data`'s real
content is **2762px tall**; the shared harness's screenshot (`insurer/data.png`) shows only the top
36%. Everything below "Manage the data plane" — the live Connectors table, Ingest jobs, all 8 PII
masking rules, the embedded (and contradictory) data-catalog widget, DSAR erasure search, the
vector-index rebuild control, the Vector DB inspector, and the PII scanner — was invisible to every
agent using this harness today, on every route, in every section. BLOCKERS #1, #3, #5 (the Vector
DB inspector part), and #6 above were only found by re-shooting with a one-off script that forces
`overflow: visible` / `height: auto` up the ancestor chain from `[data-og-shell="page"]` before
screenshotting (see `insurer/data_full.png`). **Any other section's report that calls a page "fine"
based on the shared harness's screenshot has only seen the top ~1000px of it** — worth a second pass
on pages taller than one viewport before trusting a clean bill of health. Recommend fixing
`audit-shoot.mjs` to size `[data-og-shell="page"]` to its `scrollHeight` before capturing, or
screenshot that element directly instead of the page.

---

## Correction (main session, verified live)

**`/work/artifacts` is NOT a cross-tenant leak.** The Operations+Work report listed it as one on the
strength of pixel-identical screenshots on both tenants. Reproduced and traced to the source:

- `GET /api/v1/chat/artifacts` passes `currentOrgId()`, and `listArtifacts(userId, orgId)` filters on
  **both** `chat_artifacts.user_id` AND `chat_artifacts.org_id`. The read path is correct.
- The rows were identical because the SEED wrote every artifact for every user into every org —
  including cross-tenant combinations (`arjun.menon@surakshalife.example` owned rows under
  `org_bharat`). 40 such rows existed and are deleted.
- Separately, 5 of the 7 artifacts the insurer's demo account showed were lending/collections content
  (90-DPD buckets, dunning notices, exposure by bucket) on a **life insurer**. Replaced with life
  equivalents (lapse risk, persistency, premium reminder, IRDAI grievance timelines, sum assured by
  product), created through the product's own `saveArtifact` path.

`/work/prompts` was also cleared: the two tenants return different counts (95 vs 103), and the shared
titles are genuinely org-visible seeded prompts, not another tenant's.

**Lesson for the "identical data on both tenants" heuristic.** It found two real leaks today, so it
earns its place — but it is a *suspicion*, not a finding. Identical rows can equally mean duplicated
seed data or two empty lists. Confirm against the read path and the database before calling it a leak;
reporting one that isn't costs as much credibility as missing one that is.
