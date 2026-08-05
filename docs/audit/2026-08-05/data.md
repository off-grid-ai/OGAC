# Data + Storage — conference-demo audit

Section: `src/app/(console)/data/**` + `src/app/(console)/storage/**`.
Run: 2026-08-05. Read-only. Re-scored on the **demo lens**: DEMO-BLOCKER / DEMO-RISK / POST-DEMO.
Every screenshot judged as a projected 16:9 image seen from row 10. Shots in `/tmp/audit/data/`.

## Coverage so far

- [x] Route inventory: 49 page files, but **8 of those paths 308-redirect away** (`/data/etl`,
      `/data/governance`, `/data/query`, `/data/pipelines`, `/data/retrieval`, `/data/integrations`,
      `/data/tool-catalog`, `/storage`) — the live surface is smaller than the count suggests.
      `/storage` is entirely unreachable (→ `/work/files`), so Storage has no screen of its own here.
- [x] Shot + judged: `/data`, `/data/sources`, `/data/domains`, `/data/lake`, `/data/etl`(→flows/orchestration),
      `/data/catalog`, `/data/catalog/governance`, `/data/knowledge`, `/data/knowledge/indexes`,
      `/data/knowledge/indexes/collections`, `/data/knowledge/memory`, `/data/lineage`
- [x] Live DB checks on the box: the two dataset registries, connector credential storage
- [x] Shot + judged: `/data/warehouse`, `/data/warehouse/models`, `/data/warehouse/query`, `/data/flows`,
      `/data/flows/replication`, `/data/flows/orchestration/{namespaces,catalog}`, `/data/lineage/{datasets,runs}`,
      `/data/connectors/con_erp`
- [ ] Not covered: `/data/sources/[id]/objects` browser, `/data/warehouse/[table]`, `/data/domains/[id]`,
      `/data/catalog/[id]`, `/data/knowledge/[id]`, `/data/flows/orchestration/[id]`

---

### [DEMO-BLOCKER] The Catalog — the whole "governed data" story — is a grid of zeros on this box

**Persona:** every persona; this is the surface the governance narrative needs
**Where:** `src/app/(console)/data/catalog/page.tsx:35-36` and `src/app/(console)/data/catalog/governance/page.tsx`
(both read `data_assets` via `src/lib/data-catalog-store.ts:129`)
**What:** `/data/catalog` renders **DATASETS 0 · HOLDING PII 0 · FRESHNESS ALERTS 0 · TOTAL ROWS 0** and one
sentence: *"No datasets catalogued yet."* `/data/catalog/governance` renders **six zero tiles** (Datasets,
Fresh, Stale, Broken sync, Due for disposal, Holding PII) plus "No stale or broken datasets" and "Nothing past
its retention window". Cause is seed placement, verified live on the box: `data_assets` holds 12 rows for
`org_bharat` and 4 for `org_suraksha`, but **zero** for the org the console signs into (`default`) — while the
legacy `datasets` table's 4 rows all sit under `default` and are read by a *different* surface.
**Why it matters:** Two of the most quotable Data screens are a wall of `0`s; on a projector that reads as "not
built". Worse, the Data hub one click earlier claims **"DATASETS 4 · 3,60,759 cataloged rows"** and links that
very tile to this page — so the first obvious click contradicts the number he just said out loud. A CISO in the
audience spots that in two seconds.
**Fix (cheap):** seed `data_assets` + `data_classifications` + `retention_policies` for the demo org (clone the
Indian-BFSI assets that already exist for `org_bharat`), or run the demo signed in as `org_bharat`. Pressing
"Seed from connectors" live would populate names but leaves rows/PII/freshness at 0 — not enough.
**Screenshot:** `data_catalog.png`, `data_catalog_governance.png` — grids of zeros; `data_sources.png` shows the
contradicting "DATASETS 4 / 3,60,759 cataloged rows" tile.

### [DEMO-BLOCKER] A live database password is printed on the connector detail page

**Persona:** anyone in the audience who can read a URL; a CISO especially
**Where:** `src/app/(console)/data/connectors/[id]/page.tsx:132-138` renders `{c.endpoint}` raw in a `<code>`
**What:** The Configuration card prints the endpoint verbatim. Verified on the box, three of the demo org's
connectors carry the credential inline: `postgres://corebank:corebank@127.0.0.1:5433/corebank`,
`mssql://sa:Offgrid!Erp2026@127.0.0.1:1433/erp`, `mysql://policyadmin:policyadmin@127.0.0.1:3307/policyadmin`.
Opening any core-system source therefore projects a **plaintext password and a localhost port**.
**Why it matters:** The pitch is "governed, private, on your own hardware". A password in monospace on the slide
is the most damaging single thing a security-minded audience can see, and `127.0.0.1:5433` makes the
"enterprise core banking system" look like a laptop process. Clicking a connector is a first-obvious-click.
**Fix (cheap):** strip `user:pass@` before render (`toDisplayHost` already exists in `src/lib/display-host.ts`)
and show "Credential stored in the vault" beside it. One render-site change.

### [DEMO-BLOCKER] "Sources" — the first sidebar item under Data — goes nowhere

**Persona:** the founder on his first click
**Where:** `src/app/(console)/data/sources/page.tsx:1` re-exports `/data`'s page;
`src/app/(console)/data/page.tsx:64` stat href `/data/sources`; `src/lib/domain-dashboard.ts:80` primary CTA
"Manage sources" → `/data/sources`
**What:** `/data/sources` **is** the Data hub. The sidebar's **Sources**, the hero's green **Manage sources**
button, and the **CONNECTED SOURCES 8/8** tile all navigate to the screen you are already on. The chrome says
"DATA · Sources — Enterprise systems, connectors, credentials, and connection tests" while the body headline
says "DATA OVERVIEW · Make enterprise context reusable intelligence", and one of the "Inside data" cards is
*Sources*, linking to itself.
**Why it matters:** The most likely opening move of a Data demo is "let me show you the sources" → click →
nothing changes. Three affordances that visibly do nothing reads as a broken build.
**Fix (cheap):** point the nav item, the CTA and the tile at `/data#connectors` (the connectors table already
lives further down the hub), or give `/data/sources` that table as its own page.
**Screenshot:** `data_sources.png` — "Sources" highlighted in the sidebar, Data-overview hub in the body.

### [DEMO-BLOCKER] The knowledge index says "TOTAL VECTORS 0" while the same row says 3 points, green

**Persona:** technical operator, and any prospect who can read
**Where:** `src/lib/retrieval-view.ts:70-72` (`asCount` turns `null` → `0`), `:115`, `:122`; rendered
`src/components/retrieval/RetrievalManager.tsx:228,293`
**What:** Qdrant returns `vectors_count: null`; the code coerces that to `0`. `/data/knowledge/indexes` shows
**TOTAL VECTORS 0** and a row `offgrid-brain · Vectors 0 · Points 3 · green`. The sibling
`/data/knowledge/indexes/collections` reads the same field and correctly renders **"—"**. The Data hub calls the
points count **"3 vectors"**. Three surfaces, three answers (0 / — / 3) for one number.
**Why it matters:** A zero on the retrieval index during the "your documents become answers" beat says the
feature is not working, in a tile big enough to read from the back of the room.
**Fix (cheap):** render unknown as "—", or show `points_count` labelled "items indexed"; use one formatter so
hub / indexes / collections agree.
**Screenshot:** `data_knowledge_indexes.png` vs `data_knowledge_indexes_collections.png`.

### [DEMO-BLOCKER] The retrieval screen shows the engine name three times, an internal host:port, and an internal codename

**Persona:** business audience
**Where:** `src/components/retrieval/RetrievalManager.tsx:183,216,242` (`view.adapterId` → `qdrant`), `:219-221`
+ `src/lib/retrieval-view.ts:163-171` (returns the raw host)
**What:** On one screen: a `qdrant` pill next to `reachable`, an **ADAPTER · qdrant** field, `(qdrant)` in body
copy, **ENDPOINT · http://offgrid-s1.local:6333/**, and the collection named **offgrid-brain** — the internal
codename the project already scrubbed from the neighbouring page (`src/app/(console)/data/page.tsx:263-264`
documents that exact cleanup).
**Why it matters:** Four pieces of infrastructure jargon in the top third of a slide, on the surface that is
supposed to say "your documents, private, searchable". `:6333` even tells the room which OSS vector DB it is.
**Fix (cheap):** replace the adapter id with a product label ("Meaning-based search index") plus a
reachable/unreachable state; hide the endpoint behind an admin disclosure; give the default collection a display
name ("Organisation knowledge").
**Screenshot:** `data_knowledge_indexes.png`.

### [DEMO-BLOCKER] Flows → Orchestration is one empty box saying "No ETL jobs yet"

**Persona:** business audience; the "we move your data, governed" beat
**Where:** `src/app/(console)/data/etl/page.tsx:68-86`, surfaced at `/data/flows/orchestration`
**What:** A single bordered card in the top eighth of a 1600px frame: *"No ETL jobs yet. Create one to move data
from a source into your warehouse — pick a source connector, choose the destination table, and decide what to
redact on the way."* Everything below is blank. The heading says "Orchestration", the button says "New data job",
the empty state says "ETL jobs" — three names for one thing, one of them jargon.
**Why it matters:** A whole nav section rendering as one empty box with ~85% white frame. Reads unbuilt, and
"ETL" is not language a business audience uses.
**Fix (cheap):** seed two or three plausible jobs ("Core banking → warehouse: daily transactions", "Policy admin
→ warehouse: employee quota") so the card grid renders; settle on one name ("Data jobs") across heading, button
and empty state.
**Screenshot:** `data_etl.png`.

### [DEMO-BLOCKER] Lineage is richly populated but reads as a debug dump of hashes

**Persona:** business audience; projector legibility
**Where:** `/data/lineage` — `src/app/(console)/data/lineage/page.tsx`, `src/lib/lineage-view.ts`,
`src/components/lineage/*`
**What:** The data is genuinely rich (4 namespaces · 54 jobs · 100 datasets · 160 edges) but almost every node
is a raw id: `agent:agent_e48f144d`, `run_008ec4f1`, `doc:d6cf9eed-5bcd-41e1-8454-06c71b6d6ce2`,
`con_f5c959:expense_claims`, `chat:conv_proof_msektf9o`, `agent:agent_system_ai_quality_judge`, plus an
`offgrid-console` badge top-right. Fifteen near-identical grey rows, many labelled **NO INPUTS**, one labelled
**UNKNOWN → NO OUTPUTS**. One row proves the fix is available: it renders "Knowledge base (knowledge)".
**Why it matters:** This should be the "we can trace any answer back to the row it came from" moment. Projected,
it is unreadable hex; a dozen "NO INPUTS" labels and a visible "UNKNOWN" badge look like errors, and
`conv_proof_…` smells like test data.
**Fix (cheap):** use the human label everywhere it exists, truncate ids behind a tooltip, and filter
`NO INPUTS`/`NO OUTPUTS` rows out of the default view.
**Screenshot:** `data_lineage.png`.

### [DEMO-BLOCKER] Warehouse → Models: "ClickHouse" twice on screen, three stacked headings, empty list, disabled button

**Persona:** business audience
**Where:** `src/components/warehouse/WarehouseModelsManager.tsx:82,116`;
`src/components/warehouse/WarehouseModelDetail.tsx:61,88`; page shell
`src/app/(console)/data/warehouse/models/page.tsx` + `src/app/(console)/data/warehouse/layout.tsx`
**What:** Four separate problems on one screen. (a) The engine is named twice before any click: *"Creating one
applies the DDL live to ClickHouse and freezes v1…"* and *"Applied live to ClickHouse on save."* — plus "DDL" and
the raw database name `offgrid_warehouse` in the form. The toast (*"New version applied to ClickHouse"*) and the
delete confirmation (*"The object is dropped from ClickHouse"*) fire on the two actions he'd demo. (b) The list
is **empty** — "No analytical models yet". (c) The page renders **three stacked headings saying the same thing**:
"Models / Define governed views, materialized views, and tables…", then "DATA · WAREHOUSE / Analytical models /
Governed views + tables materialized over the warehouse…", then a card titled "Analytical models" with the
sentence a third time. (d) **Create + apply is greyed out/disabled** on arrival.
**Why it matters:** Every failure mode the lens names, on one slide: engine jargon, an empty list, a duplicated
header block that looks like a layout bug, and a disabled primary button.
**Fix (cheap):** replace "ClickHouse" with "the warehouse" in all four strings and drop "DDL"; delete the
duplicated heading block (keep one); seed one credible model (`analytics.transactions_masked`) so the list
renders. Or simply keep the **Models** sub-tab out of the demo and stay on Tables + Query.
**Screenshot:** `data_warehouse_models.png` shows all four at once.

### [DEMO-BLOCKER] The warehouse table list shows an `AIRBYTE_INTERNAL` database and 22 amber "18d ago" badges

**Persona:** business audience
**Where:** `/data/warehouse` — `src/app/(console)/data/warehouse/page.tsx`, `src/lib/warehouse-scope.ts`
**What:** Otherwise the single strongest screen in the section (22 tables · 5 databases · **801,826** total rows ·
20.5 MB, grouped by database, with believable BFSI facts and dims: `fact_transaction` 600,000 rows,
`fact_account`, `fact_kyc_event`, `dim_customer`, `fact_loan`, `fact_claim`, `dim_branch`). But: a group header
reads **AIRBYTE_INTERNAL** with three tables named `public_raw__stream_corebank_transactions` /
`…_accounts` / `…_customers` (truncated mid-word in the cards), a **BHARATUNION** group appears while signed into
the demo org, and **every one of the 22 tables carries an amber "18d ago" badge**.
**Why it matters:** The engine name is a section header — unmissable at projector size. Twenty-two amber staleness
badges say "nothing has run here for three weeks" during the "your data keeps flowing" beat. A second tenant's
database name on screen invites exactly the wrong question.
**Fix (cheap):** hide internal staging databases (`airbyte_internal`, and any `_raw__stream_` tables) from the
list, or relabel the group "Staging (raw)"; touch the demo tables so freshness reads hours not 18 days; scope the
list to the signed-in org's databases so `bharatunion` doesn't appear.
**Screenshot:** `data_warehouse.png`.

### [DEMO ASSET — rehearse it] `/data/warehouse/query` is one of the best screens in the console

**Where:** `/data/warehouse/query`
**What:** A clean two-column layout: read-only SQL box with Run, and four **Starter queries** written in business
language — "Flagged transactions by channel", "Non-performing loans by product", "KYC events over the last 30
days", "Accounts by branch". Exactly the BFSI framing the demo wants, and it fills the width properly.
**Why it matters:** This is the payoff screen for "your data, queryable, governed, on your hardware".
**Action:** rehearse click-starter → Run and confirm a result table renders (not verified in this audit — no
interaction was performed). If it renders rows, put it at the end of the Data story.
**Screenshot:** `data_warehouse_query.png`.

### [DEMO-RISK] "Retention has never been applied" is an amber warning card on the governance screen

**Persona:** DPO story
**Where:** `src/components/data/RetentionPanel.tsx:246-255`, fed by
`src/app/(console)/data/governance/page.tsx:54-57`
**What:** With no sweep recorded, the panel renders an amber-bordered card: *"Retention has never been applied.
Limits above are only a setting until a sweep runs."* All four limits render **0 days** ("Zero means kept
forever"). Separately, both reads are wrapped in `.catch(() => [])`, so a DB hiccup mid-demo would produce that
same confident "never applied" sentence instead of an error.
**Why it matters:** Honest engineering, but on stage it is a yellow warning box saying the control being
described has never run, with every limit at zero. First follow-up question — "so is anything actually being
deleted?" — is answered "no", visibly.
**Fix (cheap):** set real limits and press **Apply retention now** once before the demo, so the card turns green
with a timestamp and a per-class outcome list. That artifact is far stronger than the amber state.
**Screenshot:** `data_catalog_governance.png`.

### [DEMO-RISK] Every data domain is badged "unclassified · No basis recorded"

**Persona:** DPO story
**Where:** `src/components/data-domains/DomainCard.tsx:162-187`; data on the box
**What:** `/data/domains` is the best-looking screen in the section — five clean cards, real BFSI names (claims,
customer data, invoices, reimbursement quota, transactions), a "Test resolve" box, live usage counts ("Routed to
by 3 apps"). But every card carries a dashed **unclassified** pill and an amber **No basis recorded** pill,
because nothing has been filled in. The editors for both fields already exist
(`src/components/data-domains/DomainFormPanel.tsx:131-172`).
**Why it matters:** Ten amber "No basis recorded" badges across the grid is the visual opposite of "governed" —
on the one screen that could prove the claim outright.
**Fix (cheap):** set classification + lawful basis + purpose on all five domains (claims → confidential /
contract / claims assessment, etc.). Two minutes of clicking; the same screen then proves the story.
**Screenshot:** `data_domains.png`.

### [DEMO-RISK] The object store's headline is a red "needs attention" badge plus a raw private IP

**Persona:** business audience
**Where:** `src/components/lake/DurabilityPanel.tsx:47-59,64-70`
**What:** `/data/lake` leads with a red **needs attention** badge and red body text: *"There is ONE copy of every
file. If the disk holding a file fails, that file is gone — nothing else has it."* Below, the storage node prints
as **192.168.117.4:8080**. The bucket list holds two buckets, `media` and `provit`, with no per-row action, and
40% of the frame is empty.
**Why it matters:** Right for production, wrong for a stage: the "your data on your own hardware" screen opens
with red text saying the data is not safe, beside an internal IP. `provit` reads as a leftover, not a business
bucket.
**Fix (cheap):** for the demo box, either raise replication so the panel goes green, or reword to a neutral
"Single-copy demo appliance" note in muted rather than destructive tone; label nodes "Storage node 1"; hide or
rename `provit` and add one credible bucket (`claims-documents`).
**Screenshot:** `data_lake.png`.

---

## Demo readiness

### The root cause of most of it: the demo org is the wrong org

Verified on the box — the rich Indian-BFSI seed lives under `org_bharat` / `org_suraksha`, but the console signs
in as `default`, and the two seeds cover **different tables**:

| table | `default` | `org_bharat` | `org_suraksha` |
|---|---|---|---|
| `connectors` | 8 | 7 | 3 |
| `data_domains` | 5 | 23 | 14 |
| `datasets` (legacy) | **4** | 0 | 0 |
| `ingest_jobs` | **7** | 0 | 0 |
| `data_assets` (catalogue) | **0** | 12 | 4 |
| `data_classifications` | **0** | 23 | 4 |
| `org_knowledge_collections` | **0** | 6 | 1 |
| `etl_jobs` | **0** | **0** | **0** |

So `/data/catalog`, `/data/catalog/governance` and `/data/knowledge` are empty purely because their tables were
never seeded for `default`. **Do not fix this by switching the demo to `org_bharat`** — that would empty the hub's
Datasets and Ingest tiles instead. Copy the missing rows INTO `default`. `etl_jobs` is empty for every org and
needs new rows.

### The story — strongest 2 minutes in Data, in order

1. **`/data`** (the hub) — open here. Four real tiles, an "Inside data" card grid. Say the positioning sentence
   over this screen. **Do not click "Manage sources" or the "Connected sources" tile** (both no-op) and **do not
   scroll past the Data-catalog card** — the Vector-DB-inspector debug panel is below it.
2. **`/data/domains`** — the money screen, and the best-looking one in the section. Five plausible BFSI domains,
   then the **Test resolve** box: type *"check the employee reimbursement quota"* and show it binding
   deterministically to Policy Admin → `employee_quota`. "Your language, routed to the right system, by rule,
   never a guess." Needs the classification / lawful-basis seed first, or the grid is ten amber gap badges.
3. **`/data/warehouse`** — 22 tables · 5 databases · **801,826 rows**, grouped, with credible fact/dim names.
   The "and it all lands in your own warehouse" beat. Needs the `AIRBYTE_INTERNAL` group hidden and the amber
   "18d ago" badges refreshed.
4. **`/data/warehouse/query`** — finish here. Click the **"Non-performing loans by product"** starter query and
   Run it. Business-language SQL over the customer's own data on their own hardware. *Rehearse this: I did not
   verify that a result table renders.*
5. **`/data/catalog/governance`** — ONLY after the seed + one **Apply retention now** run. Then it becomes the
   compliance close: classified assets, PII count, a green "Last applied <timestamp>" card with per-class
   outcomes. Today it is six zeros and an amber warning.
6. *(optional)* **`/data/lineage`** — read only the counts band aloud (4 namespaces · 54 jobs · 100 datasets ·
   160 edges) and do not scroll into the rows.

### What to avoid on stage

- **`/data/catalog` and `/data/catalog/governance`** (pre-seed) — six zero tiles, "No datasets catalogued yet".
- **Any connector detail page** (`/data/connectors/con_erp`, `con_corebank`, `con_policyadmin`) — projects a
  plaintext database password and `127.0.0.1` ports.
- **The "Browse objects" button** on either S3 source — always dead-ends on "Approve an object scope first".
- **`/data/knowledge`** (empty: "No collections yet") and **`/data/knowledge/memory`** (three amber "Nobody
  holds this" + "change it on the host").
- **`/data/knowledge/indexes`** — "TOTAL VECTORS 0", `qdrant` ×3, `offgrid-s1.local:6333`, `offgrid-brain`.
- **`/data/flows`** (two empty link cards) and **`/data/flows/orchestration`** (one empty box).
- **`/data/warehouse/models`** — "ClickHouse" ×2, three stacked headings, empty list, disabled button.
- **Scrolling the bottom of `/data`** — the "Vector DB inspector" debug panel with a `qdrant/lancedb` dropdown
  and an api-key field.
- **Clicking any lineage row** — raw hashes, `NO INPUTS` ×12, an `UNKNOWN` badge.
- **The "Sources" sidebar item and the "Manage sources" button** — they navigate to the page you are on.

### Cheapest wins, ranked

1. **Copy the catalogue + knowledge seed into `default`** (`data_assets`, `data_classifications`,
   `retention_policies`, `org_knowledge_collections` + `org_knowledge_docs`, cloned from `org_bharat`). One SQL
   script, no code. This alone converts THREE dead screens (`/data/catalog`, `/data/catalog/governance`,
   `/data/knowledge`) into the governance story, and unlocks demo beat #5.
2. **Mask the connector endpoint** — strip `user:pass@` at
   `src/app/(console)/data/connectors/[id]/page.tsx:132-138` using the existing `toDisplayHost`. One line, and it
   removes the only genuinely damaging thing on any Data screen.
3. **Fill in classification + lawful basis on the five data domains** (existing UI, ~2 minutes of clicking) and
   press **Apply retention now** once. Turns the best screen from ten amber gap badges into proof, and turns the
   governance panel's amber "never applied" card green.
4. **Copy/visibility sweep, ~10 small edits:** drop `qdrant`/`:6333`/`offgrid-brain` on the retrieval screen;
   `ClickHouse` ×4 in the warehouse-model strings; render unknown vector counts as "—" not `0`; hide the
   `airbyte_internal` database group from `/data/warehouse`; hide the Vector-DB-inspector panel; remove the
   duplicated heading block on `/data/warehouse/models`.
5. **Make the dead links live and fill the empty boxes:** point Sources / "Manage sources" / the sources tile at
   `/data#connectors`; add one S3-bound data domain so "Browse objects" works; seed 2–3 `etl_jobs`; bring the
   data-quality sidecar up (or drop it from the health band) so the hub has no red "Offline" badge; clear the one
   failed ingest job so "INGEST ATTENTION" is not a red tile.

---

## Out of scope for the demo

- `src/components/lake/DataLakeManager.tsx:48-53` — `loadBuckets` has no `res.ok` check or error state, so an
  object-store outage would render "No buckets yet."; the sibling `loadObjects` (same file, :55-73) does it
  correctly. Store is up, so no demo symptom.
- `src/app/api/v1/admin/lake/buckets/route.ts:14-18` — GET has no try/catch; a failure becomes an unhandled 500.
- Bucket **delete** exists in the API (`:36-49`) but has no UI affordance; objects have one, buckets don't.
- Seven Data page files plus `src/app/(console)/storage/page.tsx` are shadowed by permanent redirects
  (`src/modules/route-migrations.mjs:8,78-84`) — dead code; two are still used as content components.
- Two parallel dataset registries (`datasets` in `src/lib/store.ts:1067` vs `data_assets` in
  `src/lib/data-catalog-store.ts:129`) with no migration path — "Seed from connectors"
  (`src/app/api/v1/admin/data-assets/seed/route.ts:19-28`) derives from connectors/domains and can never bridge
  them, so anything registered as a legacy `dataset` stays outside classification, retention and erasure.
  Visible symptom is the 4-vs-0 contradiction already logged as a DEMO-BLOCKER; the structural half is post-demo.
- `src/lib/data-catalog-store.ts` exposes `orgId: string = DEFAULT_ORG` defaults on ~18 functions; every call
  site in this section passes an explicit org, so no visible leak.
- Collection rows on `/data/knowledge/indexes` don't link to their existing detail route and offer only Delete.
- Engine names only reachable when a service is unconfigured: `SeaweedFS`
  (`src/components/lake/DataLakeManager.tsx:139`), `Marquez` (`src/components/lineage/LineageGraph.tsx:24`).
- `Airbyte` in a replication schedule hint (`src/components/data/ConnectionScheduleManager.tsx:310`) and
  `Kafka or Redpanda` in a source form title (`src/components/integrations/KafkaSourceForm.tsx:152`) — only
  visible inside edit/create dialogs.

### [DEMO-BLOCKER] `/data/knowledge` — the first screen under Knowledge — is empty: "No collections yet"

**Persona:** business audience; the "your documents become answers" beat
**Where:** `src/app/(console)/data/knowledge/page.tsx`
**What:** Clicking **Knowledge** in the sidebar lands on Collections, which renders one bordered box —
*"No collections yet. Create one to start curating the org knowledge base."* — occupying the top eighth of the
frame, ~90% white below. Meanwhile the retrieval index on the next tab reports 3 stored points and the Data hub
claims "3 vectors", so documents exist but no collection surfaces them.
**Why it matters:** The default landing page of a whole nav section is blank. It is also the section the AI story
depends on — "we ground answers in your own documents" told over an empty screen.
**Fix (cheap):** seed two collections with a handful of realistic documents (e.g. "Claims handling policy",
"KYC procedure", "Credit policy 2026") so the grid renders and "Search everything" returns something.
**Screenshot:** `data_knowledge.png`.

### [DEMO-BLOCKER] `/data/knowledge/memory` says nobody may use it, and that it can only be changed by SSH

**Persona:** business audience; a prospect asking "so who can see this?"
**Where:** `src/app/(console)/data/knowledge/memory/page.tsx:36-47` and its access-grant panel
**What:** The page renders *"No access grants exist for this organisation, so nobody can search or add to its
memory."* followed by three capability rows each reading **"Nobody holds this."** in amber — "Search the
organisation's memory and read what it returns", "Add documents…", "Connect, sync, or remove the sources…" —
and closes with *"Set in the deployment configuration, not here. Changing who may read the organisation's memory
is an operator action on the host — deliberately not a form on this page."* The search placeholder is also
truncated mid-sentence ("…a policy, a decision, a custom").
**Why it matters:** Three amber "Nobody holds this" lines say the feature is switched off, and the footnote says
the console cannot switch it on — you must go to the host. On stage that is both a dead feature and an admission
that the product needs a terminal. This is the same anti-pattern the project already rejected elsewhere ("never
ask the operator for a component login").
**Fix (cheap):** set the grants in the deployment config before the demo so the three rows name real
teams/roles; shorten the placeholder so it doesn't clip. Longer term the grants belong in the console.
**Screenshot:** `data_knowledge_memory.png`.

### [DEMO-BLOCKER] A "Vector DB inspector" debug panel sits on the main Data page — with a qdrant/lancedb dropdown, a URL field and an API-key box

**Persona:** business audience; anyone watching him scroll the hub
**Where:** `src/components/data/VectorDBInspector.tsx:118-170`, mounted on the hub at
`src/app/(console)/data/page.tsx:279-281`
**What:** Scrolling `/data` reaches a card titled **"Vector DB inspector"** whose subtitle is *"Connect a vector
store and project sampled embeddings to 2D (PCA) — inline scatter, no chart libs."* It exposes a **kind**
dropdown with the options `qdrant` and `lancedb`, a free-text **url** field pre-filled with the vector-store
host, an **api key** password field, and a **Connect** button. Immediately below it sits a `PiiScanner` panel.
**Why it matters:** This is an engineer's debug console on the primary Data page. Two OSS engine names in a
dropdown, an internal URL, an API-key input, and the phrase "no chart libs" — implementation trivia — in one
card. He will scroll this page while talking; it undoes the "finished product" impression instantly.
**Fix (cheap):** hide the inspector behind a dev flag or move it under Operations; the hub's story is
Connectors → Ingest → Masking → Catalog, and it should end there.

### [DEMO-RISK] The hub's own "Data catalog" card lists 4 classified datasets that `/data/catalog` says do not exist

**Persona:** business audience; the contradiction is on adjacent screens
**Where:** `src/app/(console)/data/page.tsx:215-245` (hub card, reads `listDatasets`) vs
`src/app/(console)/data/catalog/page.tsx` (reads `data_assets`)
**What:** Further down the hub there is a card literally titled **"Data catalog"** with a populated table —
dataset name, source, row count and a coloured **classification** badge (pii/phi/public) for each of the 4
datasets. The nav item called *Catalog* leads to a different, empty page that says "No datasets catalogued yet."
**Why it matters:** He can point at classified datasets on one screen and then land on "no datasets" one click
later. Two things named "Data catalog", one populated, one empty.
**Fix (cheap):** covered by the catalogue seed fix above; also rename the hub card ("Recently ingested
datasets") so the two are not the same noun.

### [DEMO-RISK] `/data/flows` is a two-link hallway page with no data on it

**Persona:** business audience
**Where:** `src/app/(console)/data/flows/page.tsx:17-31`
**What:** Clicking **Flows** in the sidebar lands on a page whose entire content is two link cards
("Replicated syncs", "Orchestrated jobs") on an otherwise blank 1600px frame — no counts, no status, no data.
**Why it matters:** A projected screen with two grey boxes on it. Also a wasted click in the middle of the story.
**Fix (cheap):** either surface the counts/last-run state on those two cards, or make the Flows nav item jump
straight to `/data/flows/replication` (the populated one).
**Screenshot:** `data_flows.png`.

### [DEMO-BLOCKER] The Data hub's health band shows "Data quality — Offline" in red

**Persona:** business audience; it is on the section's front page
**Where:** `src/components/data/DataPlaneHealthBand.tsx:10-34` + `src/lib/dataplane-ui.ts:279-318`
(`data-quality` probes the Great Expectations sidecar on :8944, which is down — 502, no container)
**What:** The four-card band at the top of "Manage the data plane" reads Pipelines **Online**, Streaming
**Online**, Warehouse **Online**, **Data quality — Offline** in destructive red.
**Why it matters:** A red "Offline" badge on the front page of the Data section, on the one capability whose
name a business audience understands best ("data quality"). It is also the first thing the eye goes to in that
row because it is the only coloured-differently badge.
**Fix (cheap):** bring the data-quality sidecar up before the demo, or drop `data-quality` from
`DATA_PLANE_ENGINES` for now so the band is three green cards instead of three green and one red.
**Screenshot:** `data.png` — bottom row, fourth card.

### [DEMO-RISK] The hub's own tiles carry a red-bordered "INGEST ATTENTION 1" and a "0 source documents"

**Persona:** business audience
**Where:** `src/app/(console)/data/page.tsx:57,76-88`
**What:** In the top stat band, **INGEST ATTENTION 1** renders with a red border ("Ingest jobs currently marked
failed or error"), and **KNOWLEDGE INDEX 3 vectors** is subtitled *"0 source documents available for
indexing"* — a zero and a contradiction in the same tile. Below, all four health-card blurbs are truncated
mid-word ("Moves source data into the wareh…", "Real-time change capture between…", "The columnar store your
queries …", "Validates data against expectat…").
**Why it matters:** The opening screen of the Data story has a red failure tile and a zero on it, plus four
clipped sentences in a row. A prospect will ask what failed.
**Fix (cheap):** clear or re-run the one failed ingest job so the tile is 0/green; index the source documents so
the subtitle is non-zero; let the health blurbs wrap to two lines instead of truncating.
**Screenshot:** `data.png`.

### [DEMO-BLOCKER] "Browse objects" on either S3 source dead-ends on "Approve an object scope first"

**Persona:** the founder one click off-script
**Where:** `src/app/(console)/data/connectors/[id]/page.tsx:97-104` (the **Browse objects** button, shown for
every `s3` source) → `src/components/data/SourceObjectBrowser.tsx:255-263`
**What:** The connector detail page shows a prominent **Browse objects** button for S3 sources. Verified on the
box, the demo org's two S3 connectors (`con_b69f05`, `con_warehouse`) have **no data domain bound to them** —
all five of `default`'s domains point at `con_corebank`, `con_2b530a`, `con_erp`, `con_policyadmin`. So the
button always lands on the empty state *"Approve an object scope first — Create a data domain for this source
and enter its resource as bucket/folder."*
**Why it matters:** A visible, inviting button that always dead-ends into homework. This is the exact
"first obvious click fails" case, and the recovery instruction is an internal concept ("enter its resource as
bucket/folder") a business audience cannot act on.
**Fix (cheap):** add one data domain bound to an S3 connector with a resource like `claims-documents/2026`, so
the button opens a populated folder browser — which is a genuinely good screen. Otherwise hide the button when
no scope exists.
