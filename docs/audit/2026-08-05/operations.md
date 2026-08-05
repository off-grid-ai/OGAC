# Audit — Operations (excluding observability) — 2026-08-05

**Lens: conference demo.** Scored DEMO-BLOCKER / DEMO-RISK / POST-DEMO per `demo-lens.md`. Every
finding points at a screen, a click, or a projected image. Backend-correctness defects with no visible
symptom are one-liners in **Out of scope for the demo** at the bottom.

Section: `src/app/(console)/operations/**` minus logs/traces/metrics/alerts and minus
`operations/devices` (sibling teams). Mine: capability map, runs, physical nodes, edge, configuration,
backups/DR, admin, and the service-inventory/health libs.

Screenshots: `/tmp/audit/ops/*.png`, `/tmp/audit/ops2/*.png` (dev server :3005, authed, 1600×1000 —
judged as a projected 16:9 from row 10).

## Coverage so far

- [x] `/operations` landing — screenshot judged
- [x] `/operations/runs` — screenshot judged
- [x] `/operations/nodes` — screenshot judged
- [x] `/operations/edge` — screenshot judged
- [x] `/operations/configuration` (settings) — screenshot judged
- [x] `/operations/backups` — screenshot judged
- [x] `/operations/admin` — screenshot judged
- [x] `/operations/services/capability-map` — screenshot judged
- [x] `/operations/services` (43-card grid) — screenshot judged as a demo asset
- [x] `/operations/services/data-quality` (the one down service) — screenshot judged
- [x] capability-gate data counted from source (49 audits, 784 gates, 49 workflow ratios)
- [x] probe/health libs read (now scored POST-DEMO unless visible)
- [x] live health measured (`/api/v1/status`: `degraded`, 42/43, 1 down, 20-37s latency)
- [x] `/operations/clusters` — screenshot judged (near-blank page, one card)
- [x] `/operations/services/agent-worker` — screenshot judged (three `Unknown` gates)
- [x] `report.json` console/HTTP errors reviewed for both runs
- [ ] `/operations/api-docs` — never rendered within the shooter's 90s network-idle wait; judged from
      code only. `/operations/config` and `/operations/messaging` are pure legacy redirects (verified in
      code) and need no separate judgement.

**Status: complete for the demo lens.** 12 blockers + 5 risks below, all screen-anchored.

---

# DEMO-BLOCKERS

## D1 — The FIRST screen of Operations shows "Unavailable" three times
`/tmp/audit/ops/operations.png` · route `/operations`

The section entry point renders three red-bordered tiles side by side:

| tile | value | sub-copy |
|---|---|---|
| SERVICE HEALTH | **Unavailable** | "Service probes did not complete." |
| RUNS IN PROGRESS | **Unavailable** | "Run records did not respond." |
| RUNS NEEDING ATTENTION | **Unavailable** | "Run records did not respond." |

Under "Where things stand". This is the screen he lands on when he clicks **Operations** — the moment
he says "and here's the platform running on your own hardware". Three red boxes saying the console
cannot see anything.

It is not a flake, it is arithmetic. `src/app/(console)/operations/page.tsx:13-16` budgets **1500ms**:

```ts
safeWithTimeout(() => computeStatus(), 1500, null),
safeWithTimeout(() => listAllRuns(orgId), 1500, null),
```

Measured on this server, consecutive calls: `GET /api/v1/status` (which *is* `computeStatus()`)
returned in **20.1s** and **37.3s**. It fans 43 HTTP probes each with a 5s timeout plus a Postgres
pool connect. It can never finish in 1.5s. The runs data plainly exists — `/operations/runs` shows
**Total 173** — so that tile is timing out too.

**Cheapest fix (no refactor):** raise the two budgets to ~8s, or render the tiles from the last-known
`/api/v1/status` snapshot. Either turns three red "Unavailable" boxes into three real numbers.

## D2 — "Physical nodes" shows eight machines with no health at all
`/tmp/audit/ops/operations_nodes.png` · route `/operations/nodes`

Eight cards (g1…g7, s1). Each shows exactly four fields: Role, Host, Model, Routing. **No green dot,
no up/down, no last-seen, no CPU/GPU/memory, no capacity.** From row 10 this reads as a spreadsheet of
hostnames, not a live fleet.

This is the single screen that proves "it runs on your own hardware", and it cannot survive the first
obvious question — *"which of those is actually up right now?"* There is no answer on the screen.
The entry card on `/operations` promises what the page does not deliver: *"Registry-driven node
inventory, roles, **health, and capacity**"*.

Worse for legibility: the "Host" values wrap mid-token — `offgrid-g1.local:7` / `878` on two lines
(`FleetTopology.tsx:22-24`, `break-all`), and `g3` shows `offgrid-g3.local:1` / `234`. On a projector
that reads as broken text.

**And its sibling is worse.** `/tmp/audit/ops/operations_clusters.png` (route `/operations/clusters`,
one click below Physical nodes) is **a single small card in the top-left corner of an otherwise
completely blank page** — `g7` / *"3 nodes · 2 workers"*. Roughly 95% of the projected 16:9 image is
empty white. Nothing else on the screen. This is the most "unbuilt" surface in the section; it must
never be opened on stage, and the fix is not cosmetic (it needs per-node health + the cluster's
serving model/throughput to justify a page).

The console already has live node health — `/api/v1/gateway/nodes` proxies the aggregator whose shape
includes `health` (documented at `src/app/api/v1/gateway/nodes/route.ts:18`) and `GatewayNodesCard`
renders it. `FleetTopology` instead reads `/api/v1/gateway/fleet`, whose `FleetNode`
(`src/lib/fleet.ts:16-30`) is a DB registry row with **no health field**. Two fleet surfaces; the one
filed under Operations got the one that cannot go green.

**Cheapest fix:** point `FleetTopology` at `/api/v1/gateway/nodes` (or merge its `health` in) and add
a status dot + "last seen" to `NodeFacts`. Also drop `break-all` so hosts stop splitting.

## D3 — A "SOON" badge sits in the left nav on EVERY Operations screen
Visible in all 7 screenshots · `src/modules/registry.ts:124`

**Managed devices** carries a `SOON` pill in the Operations nav. It is on screen for the entire
Operations segment of the demo, at the same size as every live item. The demo lens names a
"coming soon" badge on a surface he'd show as a blocker, and this one cannot be avoided — it is
persistent chrome, not a page he can skip.

**Cheapest fix:** hide the item behind the same flag that gates the badge for the demo tenant, or drop
the pill. One line in `src/modules/registry.ts`.

## D4 — Admin → Organization is an empty box with `e.g. …` placeholder copy
`/tmp/audit/ops/operations_admin.png` · route `/operations/admin/organization`

The primary card is an empty textarea whose placeholder is visible on screen:
*"e.g. Always answer in British English. Never disclose internal financials. Cite sources."*
Below it, roughly half the card is blank white. It is the default Admin destination, so it is what
loads when he clicks **Admin**.

Two problems at once: an unconfigured surface reads as unbuilt, and the visible example copy is
British-English/generic — it undercuts the Indian-BFSI story the rest of the demo data tells.

The right column ("Owned elsewhere") is four cards that only link away — *"…in Governance"*,
*"…in Configuration"* ×3. So the page's own content is one empty box.

**Cheapest fix (seed data, ~5 min):** save a real org instruction for the demo tenant, e.g.
*"Answer in Indian English. Never reveal a customer's PAN, Aadhaar or full account number. Cite the
policy clause or circular you relied on."* That single row turns a blank surface into the governance
story.

## D5 — The Runs table's three rightmost columns are 100% em-dashes
`/tmp/audit/ops/operations_runs.png` · route `/operations/runs`

The runs table has 8 columns. On every one of the ~12 visible rows, **Duration = "—", Actor = "—",
Data = "—"**. Three empty columns occupy the right third of the projected table, next to a
`Pipeline` column whose values are all truncated mid-token
(`agent_system_ai_qualit…`, `agent_30e80f87`).

So the most data-rich Operations screen reads as: a wall of identical rows, an unreadable pipeline id,
and three blank columns. A prospect asks *"how long do these take?"* and the column that should answer
is empty for all 173 runs.

Compounding it, in the stat band: **Failed 56** rendered in red beside **Total 173** — a visible 32%
failure rate, with no explanation on screen and no failing row shown among the visible rows (all
"Succeeded"). A CISO in the audience reads "56 failed" faster than anything else on the slide.

**Cheapest fixes:** (a) hide the three all-empty columns when every row is null — they cost width and
give nothing; (b) if durations exist anywhere, backfill them; (c) either explain the 56 (mostly old
autotest/dev failures?) or scope the default view to a recent window so the red number reflects the
demo period rather than all history.

## D6 — The capability map lands with 60% of the projected area empty, filled with jargon
`/tmp/audit/ops2/operations_services_capability-map.png` · route `/operations/services/capability-map`

The **good news first, because this is a genuinely strong asset:** the stat band reads
**INVENTORY 49 · CURRENT AUDITS 49 · STALE AUDITS 0 · PENDING AUDITS 0**, there is a green
*"49-entry contract matched"* pill, the family tabs carry real counts (Data 11, AI runtime 7,
Governance 6, Observability 8, Operations 11, Enterprise sources 6), and the rows show green `current`
+ `verified`. Counted from source: **49 audits, 784 gates — 563 verified / 161 partial / 60 gap**, and
**zero** stale or pending. That band is the single best "this whole platform is real" visual in the
section.

The problem is the default state. The right-hand ~60% of the screen is an empty panel reading:

> **Choose a service to inspect its evidence.**
> The detail view separates upstream availability, production integration, UI exposure, and seeded
> workflow use. Pending audits stay unscored instead of being rounded down to zero.

That second sentence is unreadable to a business audience and *defensive* — "rounded down to zero"
invites the question it is pre-empting. And he will land here on a bare URL, so the majority of the
projected image is empty prose.

**Cheapest fixes:** (a) deep-link the demo to `?service=<a fully-verified one>` so the evidence panel
is populated on arrival — the route already supports it (`serviceCapabilityMapHref`,
`service-inventory.ts:453`); (b) replace the empty-state paragraph with one plain sentence
("Pick a service to see the evidence behind its status."); (c) change the page subtitle — it currently
says *"See exactly what each service provides and **where work remains**"*, which primes the room to
hunt for gaps.

## D7 — Six raw engine/product names are on the projected service list
`/tmp/audit/ops2/operations_services_capability-map.png` (LiteLLM Router visible) ·
`src/lib/services-directory.ts`, `src/lib/operational-services.ts`

Almost every service label is beautifully abstracted for a business audience — *Content Guardrails,
Identity & SSO, Vector Search, Console Database, Log Search & SIEM, Secrets Vault, Data Lineage,
PII Detection & Redaction, Durable Workflows, Policy Engine, Drift Monitoring, Organizational Brain*.
That work is already done, which makes the exceptions stand out badly. The labels that still ship the
engine name to the screen:

| id | label on screen | suggested |
|---|---|---|
| `litellm` | **LiteLLM Router** (visible in the screenshot) | Model Router |
| `litellm-forwarder` | **LiteLLM Forwarder** | Model Router Bridge |
| `lancedb` | **LanceDB** | Embedded Vector Store |
| `redis` | **Redis** | Response Cache |
| `seaweedfs` | **SeaweedFS** | Object Store |
| `cloudflared` | **Cloudflare Tunnel** | Public Access Tunnel |

Six string edits in two files. This is the cheapest high-value win in the section: it makes the
49-row capability map read as one product instead of a list of other people's software.

It is not only labels — the card **descriptions** on `/operations/services` leak engine names too, and
they are set in readable body text, not tiny badges (`operations_services.png`): *"Caddy reverse proxy,
WAF, rate limiting"* (Network Gateway), *"PostgreSQL + pgvector system of record"* (Console Database),
*"LLM Guard through the sharded guardrail aggregator"* (Content Guardrails). Those three sentences are
larger and more legible on the projector than anything else on the card.

**Safe to leave:** the filter labels *"Both IA owners" / "Any audit state" / "Any readiness"* are ugly
but small and off to the side — except **"IA owners"**, which is internal vocabulary (information
architecture) that means nothing to anyone in the room. Rename to "Managed by". Also safe to leave:
raw backup directory names (`20260805-020001`) and the settings page's env-var names — see D8.

## D8 — Configuration → Settings is a wall of 45 `OFFGRID_*` env var names
`/tmp/audit/ops/operations_configuration.png` · route `/operations/configuration/settings`

The page is well built — grouped sections, a "45 settings" count, secret masking with a reveal
toggle, a `secret (write-only)` legend, and "changes apply on restart". As an *operator* screen it is
good. As a *projected* screen to a business audience it is 45 tiles each headed by a raw variable
name: `OFFGRID_GATEWAY_API_KEY`, `OFFGRID_LITELLM_MASTER_KEY`, `DATABASE_URL`,
`OFFGRID_INFERENCE_PROVIDER`…

**Verdict: mostly safe to leave** — an audience will read it as "this is real infrastructure config",
which helps. Two things on it are not safe:

1. The very first tile is titled **"Legacy gateway URL"** with the sub-copy *"Backwards-compatible
   default … until their explicit…"* (truncated). The word **Legacy** in the top-left corner of the
   configuration screen reads as technical debt. Rename for the demo.
2. **"Gateway control URL" renders as an empty box** while "Gateway control API key" beside it says
   *"not set"* — two different renderings of the same absence, side by side
   (`ConfigManager.tsx:44-52`: secrets get the "not set" placeholder, plain values get none). Worse,
   the value is not actually absent: `getOperationalServices` resolves it as
   `OFFGRID_GATEWAY_CONTROL_URL ?? OFFGRID_GATEWAY_URL ?? http://127.0.0.1:7878`
   (`src/lib/operational-services.ts:38-39`), and `OFFGRID_GATEWAY_URL` *is* set to
   `http://offgrid-s1.local:8800/` (visible in the same screenshot) — which is why `gateway-control`
   probes UP. So the screen shows an empty field for a setting that is live and working. If he clicks
   into Settings and a prospect asks "is that one configured?", the honest answer contradicts the
   screen. **Cheapest fix:** show the effective resolved value with an "inherited from
   OFFGRID_GATEWAY_URL" hint, or at minimum give plain fields the same "not set" placeholder.

## D9 — Every one of the 43 service cards carries a row of 5 badges TRUNCATED MID-WORD
`/tmp/audit/ops2/operations_services.png` · route `/operations/services`

The coordinator asked whether the services grid reads as a healthy, complete platform on a projector.
It does not, and the loudest reason is typographic. Every card shows a readiness row rendered as:

> `DEPLOY…`  `REACHA…`  `FUNCTI…`  `SEEDED`  `CONSOL…`

Four of the five labels are **ellipsised mid-word** at roughly 9-10px uppercase mono. Multiply by 43
cards and the projected image is a mesh of ~200 unreadable truncated tokens. From row 10 they are
visual noise; from row 3 they are gibberish. Nobody can tell that these are the five readiness gates —
which is a shame, because that concept is the grid's whole argument.

**Cheapest fix (CSS/copy only):** shorten the five labels so they fit (`Deployed · Reachable ·
Working · Seeded · In use`), or drop to icon+tooltip, or widen the chip row. No logic change.

## D10 — 39 of 49 services project an "in workflow" fraction that reads as incomplete; 6 read as zero
`/tmp/audit/ops2/operations_services.png` · counted from `SERVICE_CAPABILITY_AUDITS`

Each card ends with `CAPABILITY AUDIT · <n>/<m> in workflow`. Visible in the captured frame:

> Console **6/7** · Network Gateway **6/6** · LiteLLM Router **4/10** · Gateway Control **0/1** ·
> Cloudflare Tunnel **1/2** · AI Gateway **3/4** · Console Database **1/4** ·
> Content Guardrails **1/7** · Identity & SSO **2/3**

Counted across all 49 audits: only **10 of 49** are `N/N`. **Six read `0/N`** — `lancedb 0/4`,
`kestra 0/4`, `enterprise-source-kafka 0/3`, `gateway-control 0/1`, `unleash 0/2`, `fleetdm 0/3` — and
eight more are under 50% (`llm-guard 1/7`, `postgres 1/4`, `data-quality 1/4`, `opensearch 1/4`,
`litellm 4/10`, three enterprise sources at `1/3`).

A business audience does not know what "in workflow" means, but it reads a fraction instantly, and
**Content Guardrails 1/7** next to **Console Database 1/4** next to **Gateway Control 0/1** says
*"most of this platform is not actually being used."* On the projector this is the most damaging thing
in the section: it is an honest internal engineering metric that, unlabelled, reads as a completeness
score the platform fails. A CISO in the room will ask what the denominator is and the answer
("upstream capabilities we have audited, most of which we deliberately don't use") takes ninety seconds
he does not have.

**Cheapest fix (copy/visibility only — do NOT change the numbers):** hide the `n/m in workflow` line
on the card and keep it on the detail view, where there is room to explain it; or relabel it to
something that cannot be read as a score, e.g. *"3 capabilities in production use"* with no
denominator. The stat that belongs on the card is the one that already looks great:
**49/49 audits current, 0 stale**.

Two smaller items on the same screenshot, same class:

- The header stat reads **`42/43 probes non-failing`** *in amber*, and the INTERNAL SERVICES section
  header reads **`35/36`** in amber. A defensive double-negative ("non-failing"), in a warning colour,
  advertising that something is broken, at the top right of the screen. Say `42 of 43 responding` in
  the normal foreground colour. (Credit: `checked 11:30:14 AM` beneath it is exactly the freshness
  stamp Edge is missing — see R2.)
- **AI Gateway: `Up 2967ms`.** Nearly three seconds, above the 1500ms `SLOW_MS` threshold, printed
  next to the word "Up". "Why does your AI gateway take three seconds?" is a question he does not want.

## D11 & D12 — see the dedicated section below (the one genuinely-down service)

---

# DEMO-RISKS

## R1 — "Off-box replication: Enabled" is a DR claim nothing verifies, showing an internal hostname
`/tmp/audit/ops/operations_backups.png` · route `/operations/backups`

The Backups page is the **best surface in this section** (see Strengths) — but its fourth stat tile
reads **OFF-BOX REPLICATION / Enabled**, sub-labelled `admin@offgrid-g6.local:/Users/admin/offgrid/b…`.

"Enabled" is decided by a non-empty string, nothing more:

```ts
// src/lib/backups-view.ts:103
offBoxEnabled: Boolean(config.offBoxTarget && config.offBoxTarget.length > 0),
```

…and that string has a hardcoded default (`src/lib/backups.ts:29-31`
`?? 'admin@offgrid-g6.local:/Users/admin/offgrid/backups-from-s1'`). Nothing checks the peer is
reachable or that a single byte ever landed there. The model even *has* the honest number —
`offBoxReplicatedCount` (`backups-view.ts:104`) — but `readEntries` never sets `offBox` on any entry
(`backups.ts:84` pushes only `{name, timestampMs, sizeBytes}`), so it is permanently **0** and is not
displayed.

Demo risk: he says "and it replicates off-box", a prospect asks "how do you know?", and the only
evidence on screen is a config string. Second-order: the tile projects an internal hostname and a
Unix home path (`admin@offgrid-g6.local:/Users/admin/…`) onto the screen.

**Cheapest fix:** relabel the tile *"Off-box target configured"* (true, and unattackable), or show
`offBoxReplicatedCount / total` once the reader sets it.

## R2 — Edge is a lone "Loading edge status…" card, and stale data is shown as live
`/tmp/audit/ops/operations_edge.png` · route `/operations/edge` → `/operations/edge/overview`

The captured frame is a single centred card reading **"Loading edge status…"** on an otherwise empty
page — no skeleton, no stat band — and it was still loading when the shooter's wait expired. If he
clicks **Edge** on stage and it sits like that for several seconds, the surface looks broken.

Then the truth problem. `useEdgeSnapshot` (`src/components/edge/EdgePanel.tsx:70-96`) polls every 15s
and tracks `failed`, but `failed` is consumed on exactly one line — inside `if (!snapshot)`
(`:106`). After the first successful load, every later failure changes **nothing on screen**: the
`StatusBand` keeps rendering the last-known *requests / allowed / blocked / WAF blocks /
rate-limited* counts (`:120-129`) as if live. And
`grep -n 'checkedAt|updatedAt|lastChecked' EdgePanel.tsx` → **zero hits**: there is no "as of"
anywhere on the surface. On stage, "0 blocked" could be a quiet edge or a reader that died 40 minutes
ago, and the screen looks identical.

**Cheapest fix:** render a skeleton stat band instead of the bare "Loading…" card, and add
`as of HH:MM:SS` + an amber "reconnecting" chip when `failed` is true with a snapshot present.

---

# Two more DEMO-BLOCKERS found on the one genuinely-down service

## D11 — Opening `Data Quality` shows two giant red "Fail" tiles and an amber "Unknown"
`/tmp/audit/ops2/operations_services_data-quality.png` · route `/operations/services/data-quality`

Confirmed live: exactly one of 43 services is `down` — `data-quality` (:8944, the Caddy-bound port
answering 502 with no backend). Overall rollup is **`degraded`** at `up 42 / total 43`.

The detail page renders a five-tile gate band across the full projected width:

> **DEPLOYED** `Unknown` (amber) · **REACHABLE** `Fail` (red) · **FUNCTIONAL** `Fail` (red) ·
> **SEEDED** `Not Applicable` (grey) · **CONSOLE-USED** `Pass` (green)

Two large red **Fail** words in red-tinted boxes, at the top of the page, above the fold. Below,
three evidence rows repeat *"Live health probe could not reach the service or it returned 5xx
(2157ms)."* Also on the same frame: **"Health history … (0 samples)"** — an empty panel — and
**"Dependencies · No dependencies are registered."** — a second empty panel.

`/operations` currently hides all of this behind D1's "Unavailable" tiles. **The moment D1 is fixed,
"degraded" and a red tile become visible on the landing page.** Fix D1 and D11 in the same pass or the
D1 fix makes the demo worse.

**Cheapest fix:** stand the data-quality sidecar up before the conference (it is a compose service), or
for the demo build mark it `probe: 'optional'` with an honest `fallbackLabel` so it reads as a calm
"not deployed on this fleet" instead of a red outage — the pattern `services-directory.ts:27-33`
already establishes for exactly this case.

Jargon on the same screen, in body text under the heading: *"Data-quality engine (**Great Expectations
Core 1.19**) — persistent expectation suites…"*. An engine name **and version number** in the subtitle
of a page with two red Fails on it.

## D12 — On that same screen, the console claims a "verified production workflow" through a service it cannot reach
`/tmp/audit/ops2/operations_services_data-quality.png` · `src/lib/live-service-readiness.ts:41`

The fifth tile reads **CONSOLE-USED · Pass**, and the evidence row spells it out:

> *"A production workflow through this service is verified in the capability audit."*

…sitting six inches to the right of **REACHABLE Fail** and **FUNCTIONAL Fail**, under a header that
says *"A gate is only green when registered evidence proves it; missing proof stays unknown."*

A verified production workflow through a service the console cannot reach at all. This is the fastest
thing in the room to spot — a CISO reads a green "Pass" next to two red "Fail"s and stops trusting
every other badge in the product. It is also a real defect, not just optics:
`consoleUsedEvidence(provenWorkflow.has(id), observedAt)` is derived purely from the **static**
`SERVICE_CAPABILITY_AUDITS` table and merged into the live readiness regardless of liveness
(`live-service-readiness.ts:38-45`), so it stays green forever.

**Cheapest fix:** suppress the `console-used` pass (fall back to `unknown`) whenever the live probe for
that service is `down`/`unverified`. One condition in `listLiveServiceTopologies`. It is also the right
fix — a workflow cannot be *currently* in production through an unreachable service.

---

# DEMO-RISKS (continued)

## R3 — Minor off-script risks
- **`/operations/api-docs`** claims *"OpenAPI for **every integrated service**"*
  (`operations/api-docs/page.tsx:52-54`) over a hand-written 12-entry array
  (`src/lib/service-specs.ts:19-32`) against a 43-service registry; 3 of the 12 render only grey
  "no spec" note text. Drop the word "every".
- **`/operations/nodes/[nodeId]`** (`FleetTopology.tsx:78-107`) renders the **same four facts** as the
  card it came from, plus a "Configure node" button that navigates **out of Operations** to
  `/runtime/models/fleet-control`. The obvious "let me drill into g5" click yields a near-identical,
  mostly empty screen and then ejects him from the section.
All three: avoid on stage, do not fix before it.

## R4 — Two rendering faults the shooter caught that a live audience could also catch
From `/tmp/audit/ops/report.json`:

- **`/operations/runs` throws a React hydration mismatch** — *"Hydration failed because the server
  rendered text didn't match the client. As a result this tree will be regenerated on the client."* On
  the flagship Runs screen. The visible symptom is a flash/re-render of the table right after load —
  survivable, but it is the screen he opens second.
- **From `/operations/admin`, prefetching `/operations/backups` fails**: `net::ERR_EMPTY_RESPONSE` then
  *"Failed to fetch RSC payload for …/operations/backups. Falling back to browser navigation."* So
  clicking **Backups** from **Admin** does a full-page browser reload instead of a client transition —
  a white flash and a multi-second wait on the path to his strongest screen. Navigate to Backups from
  a different route, or from a fresh URL.
- Four Operations routes (`/edge`, `/config`, `/messaging`, `/api-docs`) never reach network-idle
  within 90s, which corroborates R2's slow first paint. `/operations/api-docs` produced no screenshot
  at all within 90s — R3's copy claim is code-verified, not screenshot-verified.

## R5 — Two Operations screens disagree about the same worker, in the same demo
`/tmp/audit/ops2/operations_services_agent-worker.png` vs `/tmp/audit/ops/operations_runs.png`

On **`/operations/runs`** the worker-readiness panel is green and specific: *"3/3 queues ready"*,
`offgrid-agents · Ready · 1 poller · 10184@offgrid-s1 · 11:17:57 AM`. It is the best proof-of-life in
the section and step 2 of the recommended demo.

Open **`/operations/services/agent-worker`** — one click from the same nav — and the gate band reads
**DEPLOYED `Unknown` · REACHABLE `Unknown` · FUNCTIONAL `Unknown`**, three times over, with the
evidence *"Optional dependency — not asserted by the liveness probe."* Plus, again, a green
**CONSOLE-USED `Pass`** claiming a verified production workflow (the D12 pattern).

So the console proves the agent worker is running on one screen and says it knows nothing about it on
the next. If a prospect follows up on the green 3/3 panel by clicking through to the worker, that is
the screen they land on. (Cause: the three workers are registered as `indirect://` + `probe:
'optional'` so the liveness probe never touches them — see Out of scope. The live evidence
`readWorkerReadiness()` already exists and is not wired into the gates.)

Subtitle jargon on the same screen: *"**Temporal** worker that executes durable agent runs."*

**Cheapest fix:** none that is copy-only. Treat as avoid-on-stage — do not click from the readiness
panel into a worker's service page.

---

# Strengths worth putting ON stage

These are already good and should carry the Operations segment:

- **`/operations/backups`** (`operations_backups.png`) is the strongest surface in the section and one
  of the strongest governance stories in the console. Four big legible stat tiles
  (**Latest backup 9h ago · Total size 139 MB · Within retention 14 · Off-box replication**), a
  Schedule card that *explains itself in plain English* — *"Backups have landed on 7 of the last 7
  days — the newest 9h ago — so the nightly job is running. Its status could not be read from here:
  … is a system-domain daemon and this process is unprivileged, which is deliberate."* — and a clean
  17-row table with Age / Size / `kept` / **Restore · Delete** actions per row plus **Prune (3)** and
  **Run backup now**. Real data, real actions, honest about what the console deliberately does not
  control. That paragraph is the answer to "what happens when it breaks", pre-written.
- **`/operations/runs` worker-readiness panel** — *"Durable worker readiness · 3/3 queues ready"* with
  three green **Ready** cards naming real pollers (`14467@offgrid-s1` `dev`, `10184@offgrid-s1`,
  `61595@offgrid-s1` `ed96a823`) and timestamps. Live proof that work is actually being drained, and
  it looks it.
- **Capability-map stat band** — 49 / 49 current / 0 stale / 0 pending + "49-entry contract matched".
- **Configuration → Settings** density and secret handling: no component login is ever requested, and
  secrets are write-only with an explicit legend. Good CISO answer if asked.

---

# Demo readiness

## The story (2 minutes, exact route order)

The through-line: *"everything you just saw runs on hardware you own, and you can see and recover all
of it."*

1. **`/operations/services/capability-map?service=<a fully verified service>`** — 20s.
   Open on the stat band: **49 services · 49 current audits · 0 stale · 0 pending**, "49-entry
   contract matched". Say: *"forty-nine components, every one audited, nothing stale."* The deep-link
   is required so the evidence panel is populated instead of the empty "Choose a service" prose (D6).
   Pick a service whose gates are all verified — **not** one of `streaming`, `data-quality`,
   `llm-guard`, `fleetdm`, `litellm`, `otel-collector` (they carry 4-6 `gap` badges each).
2. **`/operations/runs`** — 40s. Lead with the **Durable worker readiness · 3/3 queues ready** panel
   (real pollers, real timestamps), then the run table for volume. Do not linger on the right-hand
   columns (D5) and have an answer ready for **Failed 56**.
3. **`/operations/backups`** — 50s. The closer. Latest backup 9h ago, 17 dumps, 14-day retention,
   per-row Restore/Delete, Prune, Run backup now. Read the Schedule paragraph aloud — it is the
   best-written copy in the console. If asked about off-box, say "the target is configured" (R1), not
   "it is replicating".
4. Optional 10s: **`/operations/configuration/settings`** — scroll once to show 45 real settings with
   write-only secrets. Sells "on-prem, self-configured" without needing anyone to read it.

Total: 3 routes, all deep-linkable, none of which currently show a red state.

## What to avoid on stage

- **`/operations`** (the section landing) — three "Unavailable" tiles (D1). Navigate straight to a
  child route; never click the Operations parent.
- **`/operations/nodes`** — no health, hostnames wrapping mid-token (D2). Painful, because it is the
  natural "your own hardware" screen; the highest-value engineering fix if there is time.
- **`/operations/clusters`** — one small card in the corner of a blank page (D2). Never open this.
- **Do not reach Backups by clicking it from Admin** — the RSC prefetch fails and it hard-reloads
  (R4). Deep-link or arrive from Runs.
- **Do not click from the green worker-readiness panel into a worker's service page** — that page says
  Unknown/Unknown/Unknown about the worker the panel just proved is running (R5).
- **`/operations/edge`** — slow bare "Loading edge status…" card, and no freshness indicator (R2).
- **`/operations/admin`** — empty textarea with `e.g. …` placeholder (D4). Trivially fixed by seeding
  one row.
- **`/operations/services`** — the 43-card grid. This is the surface that *should* be the section's
  showpiece and today it is the riskiest: truncated badge mesh (D9), 39 of 49 cards showing a fraction
  that reads as a failed completeness score (D10), an amber `42/43 probes non-failing` header, a
  3-second gateway latency, engine names in the descriptions (D7), and one genuinely red tile (R3).
  Use the **capability map** instead — same inventory, better numbers, no fractions on the cards.
- **`/operations/services/data-quality`** specifically — two giant red **Fail** tiles, an amber
  **Unknown**, a green **Pass** contradicting them, two empty panels, and "Great Expectations Core
  1.19" in the subtitle (D11, D12). If he opens *any* service detail on stage, pick one that is up.
- **`/operations/api-docs`**, **`/operations/nodes/[id]`**, **`/operations/clusters`** — thin or
  overclaiming on an off-script click (R3).

## Cheapest wins, ranked

All six are copy, CSS or one-row-of-data — no refactors.

1. **Hide the `n/m in workflow` line from the service cards** (D10). One JSX line. It is the single
   most damaging thing on the grid: 39 of 49 cards currently project a fraction a business audience
   reads as a failing completeness score, six of them as literal `0/N`. Keep it on the detail view
   where it can be explained. This alone turns `/operations/services` from a screen to avoid into a
   screen to show.
2. **Fix the truncated badge row** (D9). Shorten the five gate labels to fit
   (`Deployed · Reachable · Working · Seeded · In use`) so ~200 ellipsised tokens across the grid stop
   reading as noise. CSS/copy only.
3. **Seed the org instruction row** for the demo tenant (D4). One INSERT. Turns a blank placeholder
   screen into the governance story, in Indian-BFSI voice.
4. **Rename six service labels + three descriptions** (D7): LiteLLM Router → Model Router, LanceDB →
   Embedded Vector Store, Redis → Response Cache, SeaweedFS → Object Store, LiteLLM Forwarder → Model
   Router Bridge, Cloudflare Tunnel → Public Access Tunnel; and strip *Caddy*, *PostgreSQL + pgvector*
   and *LLM Guard* from the three card descriptions. Also rename the "IA owners" filter to
   "Managed by", and change the amber `42/43 probes non-failing` header to a plain
   `42 of 43 responding`. All strings, two files.
5. **Deep-link the capability map with `?service=…` + replace the empty-state paragraph** with one
   plain sentence, and drop "where work remains" from the subtitle (D6). Copy only.
5b. **Suppress the `console-used` green Pass when the live probe is down** (D12) — one condition in
   `listLiveServiceTopologies` (`live-service-readiness.ts:41`). Removes the single most credibility-
   destroying thing in the section: a green "verified production workflow" badge beside two red "Fail"s
   on the same screen.
6. **Settle `data-quality`** (D11): bring the sidecar up, or mark it `probe: 'optional'` with an honest
   `fallbackLabel` for the demo build. **Then** raise the two `safeWithTimeout` budgets on
   `/operations` from 1500ms to ~8000ms (D1) — one line each. In that order: fixing D1 first would
   trade "Unavailable ×3" for "degraded + a red tile". Hide the `SOON` badge in the same pass (D3, one
   line in `src/modules/registry.ts`).

*(Engineering time, if any: point `FleetTopology` at `/api/v1/gateway/nodes`, add a status dot +
last-seen to `NodeFacts`, drop `break-all` from the Host field — D2. The one fix that converts the
"your own hardware" screen from avoid to show.)*

---

# Out of scope for the demo

Real defects, no visible symptom on a demo screen. One line each; not investigated further.

- `ServiceEntry.expectStatus` is declared, typed and honoured by `judgeProbeStatus` but **never passed**
  by the only live caller (`src/lib/status.ts:80`), so no service can declare what "alive" means for
  its probe; zero call sites, zero tests.
- The new `unverified` state still counts toward the green numerator: `status.ts:133`
  (`healthy = status !== 'down'`) and `service-health.ts:16` `isHealthy` — an all-`unverified` fleet
  would render "43/43 up · operational".
- `npx tsc --noEmit` fails on `main` with exactly 2 errors, both here: `HealthStatus`
  (`service-health.ts:11`) and `OperatorHome.health.items` (`overview-synthesis.ts:329`) lack
  `'unverified'`.
- Three disagreeing definitions of "healthy" (`status.ts:133` / `service-health.ts:16` /
  `overview-synthesis.ts:312` where `up = status === 'up'`), so the operator home would say
  "10 not responding" for the same probe batch `/operations` calls 42/43.
- `agent-worker`, `app-worker`, `chat-worker`, `cloudflared` and the three forwarders use
  `url: 'indirect://…'` + `probe: 'optional'` (`operational-services.ts:15-35`), so 7 of 43 rows are
  permanently non-red by construction — even though `readWorkerReadiness()` can prove the worker case.
- `probeService` builds `new URL(...)` **outside** its try/catch (`status.ts:44-46`), so one malformed
  service URL rejects the whole `Promise.all` and blanks every health consumer at once.
- A `401`/`403` still resolves to `functional: 'pass'` in the readiness gates
  (`service-readiness-probe.ts:26-27`) — the 404 hole was closed, the auth-refusal hole was not.
- All four privileged backup routes audit under the same `action: 'backup.run'` (run / **delete** /
  **prune** / restore-inspect), and the delete route emits only after a successful `rm`.
- `runBackupNow`'s concurrency guard is a module-level `let running` (`backups.ts:139`) — not a lock.
- Fleet-specific defaults hardcoded in library `||` chains: `OFFGRID_BACKUPS_DIR ||
  '/Users/admin/offgrid/backups'`, the `admin@offgrid-g6.local` off-box peer, the backup script path
  and launchd label (`backups.ts:25-31,106-107`), plus the `getoffgridai.co` probe hosts.
- `/api/v1/gateway/nodes` returns `{available:false, nodes:[]}` for a 401, a dead aggregator, a stale
  DNS name and a timeout alike, discarding the reason in both arms (route `:31,:36`).
- `service-specs.ts` and `services-directory.ts` disagree on Presidio's env var
  (`OFFGRID_PRESIDIO_URL` vs the preferred `OFFGRID_PRESIDIO_ANALYZER_URL`).
- `formatRelativeTime` returns `'never'` for both a null and an unparseable timestamp
  (`operations-destinations.ts`).
