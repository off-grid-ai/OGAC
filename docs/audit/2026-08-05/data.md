# Data — audit findings

Section: `src/app/(console)/data/**` (41 pages) + `src/app/(console)/storage/**` and their libs/APIs.
Run: 2026-08-05 (restart after the first run died on a session limit). Read-only audit.

## Coverage so far

- [x] Route inventory (49 page.tsx under data/ + storage/)
- [x] Screenshot harness fired for 27 routes → `/tmp/audit/data` (in progress / read as they land)
- [x] `src/lib/object-store.ts` (pure layer — clean)
- [x] `src/app/(console)/data/governance/page.tsx`, `src/components/data/RetentionPanel.tsx`
- [ ] lake / sources / objects browser
- [ ] etl + etl detail
- [ ] catalog + catalog/[id] + catalog/governance
- [ ] knowledge (+ indexes, collections, memory)
- [ ] lineage (+ [destination])
- [ ] warehouse (+ models, query, [table])
- [ ] domains (+ [id]), connectors/[id]
- [ ] flows (orchestration / replication)
- [ ] admin API routes: lake, connectors, data-domains, catalogue, etl, knowledge

---

### [BLOCKER] A failed retention read tells the DPO "Retention has never been applied"

**Persona:** DPO
**Where:** `src/app/(console)/data/governance/page.tsx:54-57`, rendered by `src/components/data/RetentionPanel.tsx:246-255`
**What:** `listRetentionRules(org).catch(() => [])` and `listRetentionRuns(org).catch(() => [])` swallow every
error into an empty array. `RetentionPanel` then takes `latest = runs[0]` as undefined and renders the
affirmative claim *"Retention has never been applied. Limits above are only a setting until a sweep runs"* —
and the limits block renders as if no limit were configured. A DB outage, a permission error, or a schema
drift is therefore displayed as a definite statement about the org's compliance history.
**Why it matters:** This is the repo's named dominant defect class (failure presenting as emptiness) landing on
the single surface a DPO would screenshot as evidence. It is worse than a blank page: the page positively
asserts the opposite of what may be true, and it asserts it in the exact words of an evidence artifact.
**Fix:** Let the reads throw or return a `{ ok:false, error }` envelope, and give `RetentionPanel` a third state:
"Could not read the retention record — this is not a claim that no sweep ran." Never derive "never applied"
from an empty list that could be an error.

---

### [MAJOR] "Sources" is not a page — the sidebar item, the hero CTA and the stat card all land back on the Data hub

**Persona:** Data Engineer, Principal UX/IA
**Where:** `src/app/(console)/data/sources/page.tsx:1` (`export { default } from '@/app/(console)/data/page'`),
`src/app/(console)/data/page.tsx:64` (fact href `/data/sources`), `src/lib/domain-dashboard.ts:80`
(primaryAction "Manage sources" → `/data/sources`)
**What:** `/data/sources` re-exports the `/data` hub. So: the sidebar's **Sources** entry, the hub's primary
CTA **Manage sources**, and the **Connected sources 8/8** stat card all navigate to the same screen the user
is already on. The console chrome labels it "DATA · Sources — Enterprise systems, connectors, credentials, and
connection tests" while the body's own H1 says "DATA OVERVIEW / Make enterprise context reusable
intelligence", and one of the "Inside data" cards is *Sources* linking to itself.
**Why it matters:** The one entity a data engineer starts from has no list surface of its own. Three separate
affordances promise to take you somewhere and do nothing — the classic "is the app broken?" moment. It also
breaks the list→detail rule at the top of the section: there is no sources list, and the actual source detail
lives under a different path (`/data/connectors/[id]`), which nothing on the hub links to by that name.
**Fix:** Give `/data/sources` a real connectors/sources list page (rows → `/data/connectors/[id]`), or point
the CTA/stat/nav at `/data#connectors`. Do not ship a route whose only content is the page that links to it.
**Screenshot:** `data_sources.png` shows the "Sources" nav item selected while the body renders the Data
overview hub, including a *Sources* card and a *Manage sources* button that both point at the current URL.

### [MAJOR] Engine names are shown to users on six Data surfaces

**Persona:** Principal UX / brand; every persona
**Where:** `src/components/lake/DataLakeManager.tsx:139` ("no SeaweedFS endpoint");
`src/components/data/ConnectionScheduleManager.tsx:310` ("How often Airbyte replicates …");
`src/components/warehouse/WarehouseModelsManager.tsx:82,116` ("applies the DDL live to ClickHouse",
"Applied live to ClickHouse on save."); `src/components/warehouse/WarehouseModelDetail.tsx:61,88`
("New version applied to ClickHouse", "The object is dropped from ClickHouse");
`src/components/lineage/LineageGraph.tsx:24` ("Configure the Marquez lineage store…");
`src/components/integrations/KafkaSourceForm.tsx:152` ("Connect Kafka or Redpanda")
**What:** User-facing strings — an empty state, a form hint, two card descriptions, a success toast and a
delete confirmation — name the underlying OSS components. `/data/catalog/page.tsx:108` carries a comment
saying a "(SeaweedFS)" leak was already removed from that surface, so the rule is known and these are misses.
**Why it matters:** Explicit project rule (no OSS engine names in user-facing copy). Worse, the two that
matter most are a *delete confirmation* and a *failure* message: the moments a non-expert most needs to
understand what is about to happen are the moments the console switches to infrastructure jargon.
**Fix:** Replace with outcome language — "the object store isn't set up on this deployment yet", "How often
{name} is refreshed", "Applied live to the warehouse", "Delete this model? The table is dropped from the
warehouse", "Set up the lineage store to inspect…", "Connect an event stream".

### [MAJOR] The object-store bucket list turns an outage into "No buckets yet."

**Persona:** Technical operator, Data Engineer
**Where:** `src/components/lake/DataLakeManager.tsx:48-53,75,168`; route
`src/app/api/v1/admin/lake/buckets/route.ts:14-18`
**What:** The GET route has no try/catch around `store.listBuckets()`, so an object-store failure becomes an
unhandled 500. Client-side, `loadBuckets` never checks `res.ok`, has no try/catch and no error state:
`setBuckets(j.buckets ?? [])` (or a rejected `res.json()` inside `void loadBuckets()`) leaves `buckets = []`
with `configured` still `true`, and the panel renders **"No buckets yet."** Note the sibling
`loadObjects` in the SAME file (lines 55-73) gets this exactly right, with a comment explaining why — the
bucket list was simply not given the same treatment.
**Why it matters:** "No buckets yet" on the data lake tells an operator their storage namespaces are gone.
It is the repo's most-repeated defect class, sitting one function above a correct implementation of the fix.
**Fix:** `if (!res.ok) throw`; add a `bucketsError` state and render it in place of the empty row, mirroring
`loadObjects`. Wrap the route's `listBuckets()` in try/catch returning `{ error }` + 502.

### [MINOR] Buckets can be created but never deleted from the UI, and internal node addresses are printed

**Persona:** Technical operator
**Where:** `src/components/lake/DataLakeManager.tsx:97-110` (create only; no bucket delete anywhere in the
component) vs `src/app/api/v1/admin/lake/buckets/route.ts:36-49` (DELETE exists);
`src/components/lake/DurabilityPanel.tsx:64-70`
**What:** The API supports bucket delete; the management surface offers no affordance for it — objects have
`del`, buckets do not. Separately, the durability panel prints each storage node's raw address
(`192.168.117.4:8080` in the screenshot) to every console viewer.
**Why it matters:** Rule 1 (full CRUD) is unmet for the lake's top-level entity, so removing a bucket
requires a curl. Printing internal host:port to any viewer is gratuitous in a repo that deliberately scrubbed
infra coordinates out of the public tree.
**Fix:** Add a delete-with-confirmation on each bucket row (guarding non-empty buckets with the S3 error).
Label nodes "Storage node 1/2/3" and keep addresses to an admin-only detail.
**Screenshot:** `data_lake.png` shows the bucket list (`media`, `provit`) with no per-row actions, and the
node row rendering a raw private IP and port.
