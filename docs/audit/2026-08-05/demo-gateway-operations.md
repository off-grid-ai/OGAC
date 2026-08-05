# Demo lens — Gateway / services / devices + Operations observability

Reviewer: conference-demo reviewer (stage lens only).
Scope: `/runtime/gateways`, `/operations/services`, `/operations/devices` (+ `gateway/**` impls);
`operations/health/**`, `operations/metrics/**`.
Inputs: `docs/audit/2026-08-05/gateway.md`, `docs/audit/2026-08-05/operations-observability.md` (re-scored,
not re-derived) + screenshots shot live from `127.0.0.1:3005` and judged as projected 16:9 images.

Severity: **DEMO-BLOCKER** / **DEMO-RISK** / **POST-DEMO**.

## Findings

### 1. [DEMO-RISK] `/operations/services` — a **6–9 second wall of "⟳ checking" spinners** on every arrival (and permanent if the fetch fails)
**What the audience sees:** the biggest, most impressive surface in this section — "every service in your
private AI stack, with live health" — and for the first several seconds **not one green dot**. Every card's
status line is a spinner plus the grey word `checking`, next to an internal hostname
(`offgrid-s1.local:4000`, `onprem-console.getoffgridai.co`, `in-process`).
Screenshot: `/tmp/audit/demo-ops/operations_services.dark.png` (taken 3.5 s after load — all 34 cards
spinning).
**Measured live, not inferred:** `GET /api/v1/services/health` took **8.67 s, 5.75 s and 7.91 s** on three
consecutive reads. Nothing paints until that one batch call returns, so the spinner wall is ~6–9 s long
every time he opens the page or navigates back to it.
**Good news that changes the verdict:** when it *does* land, the payload is **43 services — 34 `up`,
8 `optional`, 1 `embedded`, ZERO `down`** (`checkedAt 2026-08-05T06:23:31Z`). The grid goes fully green.
This screen is worth showing; it just needs to not be blank while he is talking over it.
**The tail risk is code-certain:** `ServicesDirectory.tsx:136-144` `if (!res.ok || !alive) return;` plus
`catch {}` leaves `health = {}`, so a 403 or any failed batch call is *visually identical to still
loading* and re-polls every 30 s without ever changing. Same on the detail page (`ServiceDetail.tsx:52,64`:
"Live probe: Checking", "Latency: —", "Collecting first sample…"). The correct pattern already exists in
this repo (`WorkerReadinessPanel.tsx:31-38`, `DeviceSoftware.tsx:31-33`) and is simply not applied here.
**Fix for the demo:** render the last-known/registry state immediately (or a skeleton with a "checking
live health…" line at the *page* level, not 34 times), warm the endpoint on navigation, and give the
failure its own state. Opening this page ~15 s before he speaks also works as a rehearsal-level mitigation.

### 2. [DEMO-BLOCKER] The service cards are built out of 9px type, and the gate chips are ellipsized to noise — `DEPLOY… REACHA… FUNCTI… SEEDED CONSOL…`
**What the audience sees:** five tiny pill badges per card, four truncated mid-word, in 9px uppercase.
Illegible on a laptop; pure coloured texture from row 10. Beside them a second unreadable line,
`CAPABILITY AUDIT  6/7 in workflow` — and on other cards `0/1 in workflow`, `1/4`, `1/7`, `4/10`. A ratio
with no stated denominator, mostly reading as "mostly not done".
**Hard numbers, not opinion:** `ServiceReadiness.tsx:62` renders each chip
`truncate … text-[9px] uppercase tracking-tight` inside a `grid-cols-5`; `ServicesDirectory.tsx:87` the
"Capability audit" label is `text-[10px]` and `:93` its ratio badge `text-[9px]`. There are **41**
`text-[9|10|11]px` occurrences across `src/components/services/`. Every card also carries a `host:port`
line in mono at the same scale.
**Stage cost:** a wall of truncated jargon chips and bad-looking fractions is the strongest "work in
progress" signal on any screen in my scope, and it is the one that survives every other fix.
**Fix (class change only):** chips to `text-xs`, show **two** gates on the card (Reachable + Functional)
instead of five, and move the `n/m in workflow` ratio to the detail page.

### 3. [DEMO-BLOCKER] Raw engine and infra names are the user-visible labels across services
**Where:** `services-directory.ts` labels/descriptions — "LiteLLM Router", "PostgreSQL + pgvector",
"LLM Guard through the sharded guardrail aggregator", "Cloudflare Tunnel", "SeaweedFS", "LanceDB",
"Qdrant", "Redis", "Keycloak", "Open Policy Agent", "Caddy", "Prometheus", "FleetDM (osquery)";
plus `ServiceDetail.tsx:250` renders `dependency.serviceId` **verbatim**, so `postgres`, `redis`,
`opensearch`, `litellm`, `keycloak`, `qdrant`, `openbao`, `temporal`, `langfuse` appear as chips.
Internal hostnames and ports (`offgrid-s1.local:8800`, `:4000`, `:8010`) are on the card face.
**Stage cost:** to a technical audience this is fine and even credible. To the business half of the
room it is a screenshot of somebody's docker-compose. The founder should either state up front
"these are the open-source engines we run for you" (turning it into an asset) or the list should lead
with the capability name and demote the engine to the detail page. This is a copy change, not a refactor.

### 4. [DEMO-BLOCKER] "Platform health" opens on an EMPTY PromQL query box
**Route chain:** `/operations/health` → `redirect(legacyHealthHref())` → **`/operations/health/metrics/explorer`**
(`operations-destinations.ts:156-162`, default = `HEALTH_DESTINATIONS[0]`).
**What the audience sees:** a form labelled **"PromQL / MetricsQL"**, a `Range` button row, a `Run`
button, and a 220px dashed empty box saying *"Enter a query or load a saved one / Start typing a metric
name to autocomplete from the live catalogue, then Run."* Beside it, "No saved queries yet" (the saved-
query load swallows failures — `MetricsSavedQueries.tsx:48` `.catch(() => {})`). **Zero pixels of live
telemetry.** The nav item is called "Platform health"; the page is a developer query prompt.
**Then it gets worse if he uses it:** the input placeholder is
`sum(rate(otelcol_receiver_accepted_spans_total[5m]))` (`MetricsExplorer.tsx:129`) — a metric name that
**does not exist on the live VM** (live has `otelcol_receiver_accepted_spans`, no `_total`). So the one
example query the product hands him returns the flat grey box **"No data"**. He types the suggestion and
his own monitoring says nothing.
**Cheapest fix (two lines, huge payoff):** drop `_total` from the placeholder AND make this route land
on charts instead of a prompt — e.g. default `?q=` to a metric that IS emitting
(`otelcol_processor_batch_batch_send_size_sum` or `otelcol_exporter_queue_size`) so the page paints a
live emerald area chart on arrival.

### 5. [DEMO-BLOCKER] `/operations/health/metrics` — I have the screenshot, and it is worse than the code review said: two dead panels, one flat-zero chart, and one chart destroyed by a legend of raw Prometheus label sets with UUIDs
Screenshot: `/tmp/audit/demo-ops/operations_health_metrics.png`. **Read this one before anything else.**
**What is actually on the projector, top to bottom:**
- A pill: **`Targets up: awaiting emission`**.
- **Request rate** — a large dashed empty box, *"Not emitting yet / No span/request throughput reported
  yet — awaiting OTel receiver traffic."*
- **Error rate** — an identical dashed empty box, *"Not emitting yet / No export failures reported (good)
  or the exporter is not emitting counters yet."*
- **Data points processed** — a chart that *does* render, as a **flat line pinned to zero** on a 0–4 axis.
  Technically live; visually a dead chart.
- **Collector queue size** — the worst object in this audit. The card is consumed by **three wrapped,
  multi-line, coloured monospace legend labels** reading
  `otelcol_exporter_queue_size{data_type=logs,exporter=otlp_http/victorialogs,service.instance.id=675a7cb5-d276-4d7e-b97a-9b805c3e9064,service.name=otelcol-contrib,service.version=0.156.0}`
  ×3 — **clipped off the right edge of the card**, with a UUID and a version string in each. The chart
  itself is squeezed to a bare time axis.
**So on one screen: 2 "not emitting", 1 flat zero, 1 chart replaced by raw telemetry label sets, and a
counter that says "awaiting emission".** The page header reads *"Explore live PromQL metrics from
VictoriaMetrics and save named queries."* This is the single most damaging screen in my scope. Do not open
it, and if it is fixed, the legend must be collapsed to a short series label (`data_type=logs` etc.) —
that is a `Legend formatter` on `MetricChart.tsx`, not a refactor.
**Root cause of the two empties, string-exact:** `victoria-metrics.ts:51` queries
`otelcol_receiver_accepted_spans_total` and `:57` `otelcol_exporter_send_failed_spans_total`; the live VM
has `otelcol_receiver_accepted_spans` (no `_total`) and no `send_failed_spans` series at all.
**Precision correction to the prior report:** it is **2 of 4** names that don't exist, not three — the
other two resolve, and now that I have looked at them, they render badly for different reasons (flat zero;
legend explosion). Fixing the names alone gets you two live charts and leaves two ugly ones.

### 5b. [DEMO-BLOCKER] The legacy URL family, verified in pixels: `/operations/health/alerts` shows a page titled "Metrics" containing the TRACES table
Screenshot: `/tmp/audit/demo-ops/operations_health_alerts.png`.
**Three things disagree on one screen:** the URL says `/alerts`, the page heading says **"Metrics"** with
the subtitle *"Explore live PromQL metrics from VictoriaMetrics and save named queries"*, and the body is
**the traces table** — a `Service` dropdown, a "Open full waterfall in Jaeger UI" link, and eight rows of
Root operation / Service / Spans / Duration / Trace.
**Why:** `PlatformHealthDestination.tsx:41-43` handles `metrics` and `logs` then `return <TracesDestination/>`;
`alerts` never matches and silently falls through. Both legacy URLs are still linked from the capability
map (`data-quality-observability.ts:632,696,711`; `runtime-governance-operations.ts:297`), so this is one
plausible off-script click away.
**Also verified:** `/operations/metrics/explorer` — the URL in circulation for the metrics workbench —
**404s** ("Page not found / That route doesn't exist, or the module isn't enabled for this deployment").
The real route is `/operations/health/metrics/explorer`. Check any deck, doc or capability-map row that
carries the short form before he demos from it.
**Fix:** make `alerts` route to `MetricsAlerts` (or redirect both legacy ids to their canonical routes) and
give `[destination]` an explicit exhaustive switch so a new id can never silently render a sibling surface.

### 5c. [DEMO-BLOCKER] The traces table's default view is **Jaeger tracing itself** — eight 1-span requests to `/api/traces`
Same screenshot as 5b. With no `?svc`, the Service dropdown defaults to **`jaeger-all-in-one`**, and every
row is the console polling Jaeger: root operations `/api/services`, `/api/traces`, `/api/traces/{traceID}`,
**Spans = 1** on all eight rows, durations 1–13 ms.
**What the audience takes away:** the platform's flagship "every request is traced end to end" screen is
showing the monitoring tool watching itself, with single-span traces measured in milliseconds — no AI call,
no pipeline, no app, nothing recognisable as business work. A technical viewer will notice immediately that
`Spans: 1` cannot be an end-to-end trace of anything.
**This changes the demo plan:** I had this route pencilled in as the strongest observability beat. It only
works if he *first* selects a real instrumented service (Langfuse-backed app/agent runs, or the gateway) and
that service has recent spans. **Rehearse it with `?svc=` pinned in the URL, or default the dropdown to the
platform's own service rather than to whatever sorts first.** Un-pinned, this is a DEMO-BLOCKER.

### 6. [DEMO-BLOCKER] The alerting page says "all quiet" while nothing is evaluating anything
**Where:** `src/lib/adapters/victoriametrics.ts:120-132` + `src/components/operations/MetricsAlerts.tsx:55-70`,
route `/operations/health/metrics/alerts`.
**What the audience sees:** three big tiles — **`Firing 0` · `Pending 0` · `Alert rules 0`** — and a card
"Active alerts" containing **"No active alerts."** It reads as: we built alerting, and your platform is
healthy.
**Reality:** there is no rule engine. `engineDeployed` is inferred from a 200 on `/api/v1/rules`, which a
bare VictoriaMetrics answers `{"data":{"groups":[]}}` with no vmalert container running — so the module's
own honest empty state ("**No alerting engine deployed** — deploy vmalert and point it at this instance",
which is well-written and would be perfectly respectable on stage) is **skipped**.
**Stage cost:** this is the one screen where a CISO in the room asks the killer question — "so if that
error rate spiked, who gets paged?" — and the honest answer contradicts the three zeros he is pointing
at. `Alert rules 0` is also self-defeating on its own: zero rules means zero coverage, which is not a
number to project.
**Two ways out, both cheap:** (a) fix the probe so the existing honest "No alerting engine deployed"
card renders — that is a *good* screen, it names the next step; or (b) don't open this tab.

### 7. [DEMO-RISK] `/runtime/gateways` — half the wall reads "not configured / unavailable", and the on-prem tile can print a false "3 of 3 nodes up"
Screenshot: `/tmp/audit/demo-ops/runtime_gateways.dark.png`.
**What holds up (and it is the best screen in my scope):** four cards in a full-width row, and the egress
chips do the storytelling for him — a green **`data stays on-prem`** on the On-Prem Cluster against amber
**`data leaves (cloud)`** on the three providers. That single visual is the pitch. Health, model, base URL,
an Enabled toggle, Open / edit / delete per card. Nothing looks unbuilt.
**What hurts:** Anthropic and OpenAI render `not configured` + grey `unavailable` (no keys in this env),
so **2 of 4 tiles are dead greys** — a projected "half our gateways aren't set up". Fix by seeding keys
for the demo org, or by deleting those two rows so the wall is all-live (the seed also ships DeepSeek and
Zhipu, currently absent, so the set is already curated).
**The self-contradicting badge:** `gateways.ts:305-313` counts degraded nodes into the `up` numerator, so
three degraded nodes render green `up` + `detail: "3 of 3 nodes up"`. On stage this *hides* a problem
rather than inventing one — until he clicks Open and the node pool on the detail page lists nodes as
`degraded` under a header that says 3 of 3 up. One click, visible contradiction. Numerator fix is one line.
**Layout note:** the cards occupy the top ~35% of a 1600px-wide screen and the remaining ~600px is blank.
It reads fine, but a stat band (nodes, models served, requests today) would fill it and make the screen
feel like infrastructure rather than four cards.

### 8. [DEMO-BLOCKER] `/operations/devices` is a "Coming soon" roadmap slide, and the nav rail advertises it
Screenshot: `/tmp/audit/demo-ops/operations_devices.dark.png`.
**What the audience sees:** a pale banner with a **`Coming soon`** pill titled "Device management", then
six cards — Device inventory & health, Enrollment, Remote lock & wipe, Configuration push, Compliance
posture, Governed by the same policy — each a paragraph of *future* tense ("light up here when the
control plane ships"). **Zero buttons, zero inputs, zero data.** It is a well-designed marketing slide
sitting inside a working console, and the footer names `FleetDM/osquery`.
**Worse, it advertises itself:** the left rail renders **`Managed devices  SOON`** on *every* Operations
page (`modules/registry.ts:127-146` `comingSoon: true`). Any screen in this section carries a visible
"not built yet" badge in the founder's peripheral vision, and an audience member will read it and ask.
**And it is not even honest in the other direction:** `EnrollDeviceButton.tsx` (107 lines) and
`FleetTools.tsx` (456 lines) are fully implemented and mounted nowhere, and `/operations/devices/[id]`
renders live device facts, a live policy bundle, an audit table, a working kill switch and role
reassignment — but **nothing anywhere in the app links to it**, and on a fresh install the `devices`
table is empty so **every id 404s**. Two adjacent routes in one module make opposite claims about
whether device management exists.
**Demo call:** hide this nav item for the conference build (one flag), or wire the real detail surface
and seed two devices. Showing a Coming-soon card is strictly worse than not having the menu entry.

### 9. [RESOLVED → now DEMO-RISK only] The red `data-quality` tile is GONE — but 8 grey "Optional" cards remain, explaining themselves with the word "Temporal"
**Verified live, correcting `gateway.md`:** `data-quality` (`services-directory.ts:329-338`) reports
**`up`**. There is **no `down` service on the box** — 0 of 43. Cause (found by the coordinator, recorded
here so it isn't rediscovered): the container was running on the g6 node but bound to a **stale IP from
when that node was on the other office WiFi**, so Caddy's proxy on `:8944` answered 502 with nothing behind
it. Recreated on the current address; 43/43 healthy. **The "there IS a failing tile today" premise is dead —
spend no demo-prep time on it.** (Worth noting for stage safety: this failure class recurs whenever the
office WiFi flips, so re-run the health check on the venue network before he presents.)
**What is still on screen:** 8 cards render the grey `Optional` dot with their fallback sentence as the
visible explanation — `"readiness is reported by Temporal task-queue/run state (optional)"` (×3 workers),
`"in-process cache (optional)"`, `"indirect dependency — verified through the LiteLLM service"`,
`"direct tunnel readiness endpoint not configured (optional)"`. So in an otherwise all-green grid there
are 8 ambiguous grey tiles whose copy names internal engines and reads like a caveat. An audience cannot
tell "deliberately not probed" from "we don't know".
Also still true and still visible: `data-quality`'s own description reads *"Data-quality engine (Great
Expectations Core 1.19) — persistent expectation suites…"* — a third-party product name **and version
number** on the card face.
**Fix:** one copy pass over the ~8 optional fallbacks ("not probed directly — covered by X" in plain
words), and drop version numbers from descriptions.

### 10. [DEMO-RISK] A registry read failure prints an API route on the projector, and every other error state here is either a raw engine name or a confident wrong "nothing here"
**10a — the gateways registry.** `GatewaysManager.tsx:419-420`, reached via `registry/page.tsx:22` +
`withTimeout(..., 5000, [])` (`with-timeout.ts:26-28` collapses reject AND timeout into `[]`).
**What the audience sees** if the DB hiccups or the 5s budget is blown on conference wifi — and note the
dev server was answering a cached page in **21 s** during this audit, so a 5 s timeout is a live risk:

> **No gateways registered yet. Add one, or seed the samples with `POST /api/v1/admin/gateways/seed`.**

An infrastructure failure stated as a fact about his data, plus an internal API path in monospace, on
the screen where he has just said "here are the model endpoints your pipelines run on". There is no
ERROR/PARTIAL/retry state on this surface, and `registry/page.tsx:18` claims a `loading.tsx` skeleton
that does not exist. **Cheapest fix: raise the timeout and change the copy to two sentences that do not
contain a route** — e.g. "Couldn't read the gateway registry just now. Retry." with a Retry button.

**10b — the observability tabs.** All four Platform-health tabs share the same shape, and each failure mode
is a distinct bad projection:
- **Logs** (`LogsExplorer.tsx:92`) does `r.json()` with no `r.ok`; on a 403 the un-guarded line 203
  **throws and blanks the page**. The page gate is `platform-health`, not admin, so a non-admin operator
  with the module gets a white panel. Its histogram discards `hits.error` (`:93,98`) and prints
  **"No matching log volume in this window."** above a table that may hold real rows.
- **Traces** (`TraceSearch.tsx:238-242` + `:288-294`) renders **"Could not reach Jaeger: forbidden"** and,
  directly beneath it, **"No traces in this window. Widen the time range or clear filters."** — a raw
  engine name in a red error box, plus advice that cannot work, stacked. The service dropdown silently
  stays empty on any non-2xx (`:60-80`), which reads as "no instrumented services".
- **Saved queries** (`MetricsSavedQueries.tsx:48,100-101`) swallow load and DELETE failures — "No saved
  queries yet", and a deleted row that just stays on screen if he demos a delete.
- The tab descriptions themselves say "VictoriaMetrics", "PromQL", "LogsQL", "Jaeger"
  (`operations-destinations.ts:1-27`).
**Stage cost:** none of these is guaranteed to fire, but every one of them turns a *service* problem into
a *product* problem in front of the room, and the words the audience reads are engine names.

### 11. [DEMO-BLOCKER] `/operations/edge` contradicts itself on the security screen: **10 WAF blocks** in the stat band, **WAF: off** in the panel directly beneath it
Screenshot: `/tmp/audit/demo-ops/operations_edge.png`. Not in either prior report — Edge was unaudited.
**What the audience sees**, top band, in large numerals: **`1890 requests · 1879 allowed · 11 blocked ·
10 WAF blocks · 1 rate-limited`**. That band is genuinely excellent demo material — real traffic, and
"11 blocked" is a governance proof point he can say out loud.
**Immediately below it**, the "Protection posture" card:

> WAF **`off`** · Rate limit **`not configured`** · Rules **`none`**

**10 WAF blocks with the WAF off and zero rules.** One of those two panels is lying and they are 60px
apart. This is the exact failure mode a CISO in the room spots faster than anything else on a screen, and
it is on the page whose subtitle is *"Inspect and control public routing, WAF, traffic, and blocked
requests."* Beside it, "Public hosts" reads **"No public hosts were found in the active Caddy
configuration."** — an empty panel plus an engine name, on a page about public routing.
**Fix:** reconcile the two reads (the counters are almost certainly historical/log-derived while the posture
reads the current config — say so: "10 blocked by WAF in the last 24 h · WAF currently off"), or suppress
the WAF counters when the posture says the WAF is off. Either way this is a labelling fix, and the band is
worth keeping — it is one of the few places in Operations with real, credible numbers.

---

## Safe to show / not safe to show

| Surface | Verdict |
| --- | --- |
| `/runtime/gateways` (list) | **SAFE — the best screen in this scope.** Fix the two `not configured` tiles first. |
| `/runtime/gateways/[id]` (detail) | **SAFE with one caveat** — do not narrate the node count out loud; if a node is degraded the header contradicts the pool below it. |
| `/operations/services` (list) | **SAFE ONCE IT PAINTS — the centrepiece screen.** Live: 34 up / 8 optional / **0 down**. But it spends the first **6–9 s** as a wall of spinners, and the gate chips are 9px truncated noise. Open it before he starts talking. |
| `/operations/services/[id]` (detail) | **NOT SAFE** — "Live probe: Checking", "Latency: —", "Collecting first sample…" can sit there indefinitely, and the dependency chips are raw ids (`postgres`, `litellm`, `qdrant`). |
| `/operations/devices` | **DO NOT OPEN.** Coming-soon card, zero interactive elements. Detail route 404s. |
| `/operations/health` → `/…/metrics/explorer` | **NOT SAFE** — lands on an empty PromQL box; the suggested query returns "No data". |
| `/operations/health/metrics/alerts` | **DO NOT OPEN** — `Firing 0 · Pending 0 · Alert rules 0 · No active alerts` with no rule engine running. |
| `/operations/health/metrics` (legacy) | **DO NOT OPEN — worst screen in this scope.** 2 dead panels, 1 flat-zero chart, 1 chart buried under raw label sets + UUIDs, `Targets up: awaiting emission`. |
| `/operations/health/alerts` (legacy) | **DO NOT OPEN** — URL says alerts, heading says "Metrics", body is the traces table. |
| `/operations/metrics/explorer` | **404s.** Not a real route (the real one is `/operations/health/metrics/explorer`). Purge the short form from decks/docs. |
| `/operations/health/logs` | **CONDITIONALLY SAFE** — good when the log backend answers; a 403 blanks the page and a hits-endpoint failure prints "No matching log volume" over real rows. Rehearse on the venue network. (Not captured — see Method.) |
| `/operations/health/traces` + `traces/[traceId]` | **ONLY SAFE WITH `?svc=` PINNED.** Default view is Jaeger tracing itself: 8 rows of `/api/traces`, `Spans: 1`, 1–13 ms. With a real service selected the detail waterfall is a genuine strength. |
| `/operations/nodes` | **SAFE — and underrated.** 8 real machines (g1–g7, s1) with role, host, model, routing; fills the width; legible. Two cosmetic dings: no health/status on any card, and `offgrid-g1.local:7` / `878` wraps mid-token on every tile. |
| `/operations/edge` | **NOT SAFE AS-IS** — the stat band (1890 requests · 11 blocked · 10 WAF blocks) is great, but the panel under it says WAF `off` / Rules `none`. Fix the labels and this becomes a strong screen. |
| Any `/gateway/*` URL | **AVOID** — duplicate mount with no redirect; every in-page link exits to the canonical space, so it is a one-way trapdoor. |

## Demo readiness

### The story (2 minutes, in this order)

"This is your own private AI infrastructure — and here it is running."

1. **`/operations/services`** (~40 s). Open on the full grid. This is the only screen in the product that
   shows the *whole* stack at once, grouped Console → Gateway → Internal services. Say the line: "every
   one of these is open source, running on your hardware, and the console watches all of them."
   *Precondition: the page must already be loaded — health takes 6–9 s to paint and until then all 34
   cards are spinners. Open this tab first, then switch to it.*
2. **`/runtime/gateways`** (~35 s). "Here is where the models actually run." Point at the two chips:
   green **data stays on-prem** vs amber **data leaves (cloud)**. This is the single most persuasive
   pixel-level asset in my scope — one glance communicates the entire residency pitch.
3. **Click Open on On-Prem Cluster** (~25 s). Node pool + model catalog: "three nodes, this is the model
   they serve, and no request leaves the building." Don't dwell on the node ratio.
4. **`/operations/nodes`** (~20 s). "And this is the actual hardware it runs on" — eight machines with the
   model each one serves. Real, specific, no empty panels. This is the safest screen in the whole section
   and it is not in anyone's demo script.
5. **`/operations/health/traces?svc=<a-real-service>`** → **click one trace** (~30 s). "And every request
   through it is traced end to end, on your own box." The trace detail is a real route with a real
   waterfall. **Pin `?svc=` in the URL before you go on stage** — un-pinned it defaults to
   `jaeger-all-in-one` and shows the monitoring tool watching itself with 1-span traces (finding 5c).
6. **Stop.** Do not continue into Metrics, Alerts or Managed devices.

If `?svc=` cannot be made to show real spans in rehearsal, cut step 5 and end on `/operations/edge` after
the label fix — "1890 requests, 11 blocked at the edge" is a better closing number than an empty chart.

### What to avoid on stage
- **`/operations/health/metrics`** — this is the one screen that would visibly cost him the room: two "Not
  emitting yet" boxes, a flat-zero chart, and a chart whose legend is three raw label sets containing a
  UUID and `service.version=0.156.0`, clipped off the edge of the card.
- The `Managed devices` nav item (and the `SOON` badge that sits in the rail on every Operations page).
- The Alerts tab in either of its two URLs.
- The Metrics tab, until the metric names are fixed — it opens on an empty PromQL prompt.
- Typing the placeholder query in the metrics explorer; it returns "No data".
- Any capability-map link pointing at `/operations/health/metrics`, `/operations/health/alerts`, or
  `/operations/metrics/explorer` (that last one 404s).
- The traces page without `?svc=` pinned.
- The Protection-posture card on `/operations/edge` while the band above it says 10 WAF blocks.
- Narrating "N of N nodes up" as a fact.
- Zooming a service card — the gate chips are 9px and truncated.

### Cheapest wins, ranked

1. **Four one-line string edits + one legend formatter — this is the whole ballgame for Platform health.**
   In `src/lib/victoria-metrics.ts`: `:51` `otelcol_receiver_accepted_spans_total` →
   `otelcol_receiver_accepted_spans`; `:57` `otelcol_exporter_send_failed_spans_total` →
   `otelcol_receiver_refused_spans`; `:112` drop or relabel the `sum(up)` "Targets up" tile. In
   `MetricsExplorer.tsx:129` drop `_total` from the placeholder, and give the explorer route a default
   `?q=otelcol_processor_batch_batch_send_size_sum` so it lands on a chart instead of a prompt.
   **Then the one that is not a string:** a `Legend`/`formatter` on `MetricChart.tsx` that renders a short
   series key instead of the full label set — without it, "Collector queue size" stays a card full of UUIDs
   even after the names are fixed.
   **Quantified worth:** ~5 lines takes the preset grid from **2 dead panels + 1 flat-zero + 1 unreadable**
   to **4 readable live charts**, removes a permanent "awaiting emission" label, converts the section's
   *default landing page* from an empty developer prompt into a live emerald time series, and makes the
   first query the product suggests actually return data. Nothing else in my scope buys as much stage
   credibility per line. **Do this one even if you do nothing else.**
2. **Kill the 6–9 s spinner wall on `/operations/services`** — paint the registry rows immediately with a
   single page-level "checking live health…" line instead of 34 per-card spinners, and give the failure
   path its own state (`ServicesDirectory.tsx:136-144`, `ServiceDetail.tsx:52,64`; the correct pattern is
   already in `WorkerReadinessPanel.tsx:31-38`). **Worth:** the difference between "34 services, all live"
   and "34 services, all thinking about it" — and the underlying data is already all-green, so this is
   purely a rendering fix.
3. **Two class changes on the service card** — chips `text-[9px]`→`text-xs`, and show 2 gates instead of 5
   (or hide the `n/m in workflow` ratio on the list). **Worth:** the grid stops reading as debug output.
4. **Data-only, zero code:** configure keys for the OpenAI/Anthropic gateway rows (or delete them) so all
   four gateway tiles are live. (No longer needed: `data-quality` is up — the grid has no red tile. Do
   still delete the version number from its description.)
5. **Hide the `Managed devices` module for the conference build** (`comingSoon` entry in
   `modules/registry.ts:127-146`). One line removes a dead section *and* the `SOON` badge from every
   Operations screen. If you'd rather keep it, fix the alerts probe instead
   (`adapters/victoriametrics.ts:120-132`) so the genuinely good "No alerting engine deployed — deploy
   vmalert and point it at this instance" card renders in place of `Alert rules 0`.
6. **Two copy fixes, five minutes each:** the registry empty state (`GatewaysManager.tsx:419-420`) — delete
   `POST /api/v1/admin/gateways/seed` from user-facing text and raise the 5 s `withTimeout` budget; and the
   Edge posture labels so the WAF counters and the WAF switch stop contradicting each other (finding 11).
7. **Pin `?svc=` on the traces link** he demos from, so the traces table shows real work instead of Jaeger's
   own `/api/traces` calls (finding 5c). Zero-code if done in the deck; one line if done as a route default.

## Method / confidence

- Screenshots at 1600px against the shared dev server, in `/tmp/audit/demo-ops/`. **Read and judged as
  projected images:** `runtime_gateways`, `operations_services`, `operations_devices`,
  `operations_health_metrics`, `operations_health_alerts`, `operations_nodes`, `operations_edge`.
- **The `--dark` copies rendered light** — the shell theme is attribute-driven, so `prefers-color-scheme`
  emulation does not flip it. All judgements above are on the light theme.
- **Not captured:** `/operations/health` and `/operations/health/logs` (screenshots failed silently) and
  `/operations/health/traces` (came back a blank white page after `ERR_CONNECTION_RESET` — a saturated-server
  artifact, not a product defect; the same surface *is* pixel-confirmed via `operations_health_alerts.png`,
  which renders it). Findings **4** (empty PromQL landing), **6** (alerting zeros) and **10** (error/empty
  states) are **code-confirmed and string-exact but not pixel-confirmed** — every quoted string is read from
  the component that renders it and each route chain was traced by hand. No gateway or service *detail* page
  was captured: the shared server degraded to **~21 s for a cached page** (six audit teams driving Playwright
  at once) and id resolution timed out repeatedly.
- **Live probe evidence** (read-only, via the console's own API): `GET /api/v1/services/health` →
  **43 services, 34 `up`, 8 `optional`, 1 `embedded`, 0 `down`**, `checkedAt 2026-08-05T06:23:31Z`, response
  time **8.67 s / 5.75 s / 7.91 s** across three consecutive reads. This is what corrected findings 1 and 9.
- Screenshots are viewport-height only (1000px): the console shell scrolls internally, so `fullPage` captures
  one screen. Cards below the fold on `/operations/services` were not seen as pixels — but the health JSON
  above covers all 43 of them, which is why I can still say the grid has no red tile.

### Stale-build caveat (read this before acting on any finding)

The `:3005` dev server these shots came from was **serving partly stale compiled code** (it shared `.next`
with the production build and has since been taken down). So a screenshot may show an **older** build than
the source I quote. Where the two agree I have said so; where only one exists, here is the split:

| Finding | Pixel evidence | Code evidence | Confidence |
| --- | --- | --- | --- |
| 1 spinner wall / all-green data | ✅ + live API timings | ✅ | **High** — the 6–9 s latency and the 34-up payload came from the live API, not the dev build. |
| 2 9px truncated chips | ✅ | ✅ `ServiceReadiness.tsx:62` | **High** — pixels and source agree exactly. |
| 3 engine names / raw `serviceId` chips | ✅ (list) | ✅ | **High** (detail-page chips code-only). |
| 4 empty PromQL landing | ❌ not captured | ✅ route chain traced | Medium-high — **re-shoot after the rebuild.** |
| 5 metrics grid (2 empty, flat zero, UUID legend) | ✅ | ✅ query strings match the rendered hints verbatim | **High** — the hint text on screen is the exact string from `victoria-metrics.ts`, so this build is current for this file. |
| 5b alerts URL → "Metrics" heading + traces table | ✅ | ✅ `PlatformHealthDestination.tsx:41-43` | **High.** |
| 5c traces default = `jaeger-all-in-one`, `Spans: 1` | ✅ | not read | Medium — pixels only; **verify the dropdown default and whether any service has multi-span traces** (`curl` Jaeger via `ssh offgrid-tunnel`). |
| 6 `Firing 0 · Alert rules 0` | ❌ not captured | ✅ + prior team's live `docker ps` (no vmalert) | Medium-high — **re-shoot after the rebuild.** |
| 7 gateways list / false-green rollup | ✅ (list) | ✅ `gateways.ts:305-313` | **High** (the degraded-node contradiction is code-only — no node is degraded right now). |
| 8 devices "Coming soon" | ✅ | ✅ | **High.** |
| 9 `data-quality` red tile is stale | live API | — | **Confirmed and closed.** Coordinator found the cause: the container was bound to a stale IP from the other office WiFi, so Caddy answered 502 with nothing behind it. Recreated; **43/43 healthy, no red tile.** The remaining part of finding 9 (8 grey `Optional` cards + "Great Expectations Core 1.19" in a description) still stands. |
| 10 error/empty states | ❌ not captured | ✅ | Medium-high — failure paths, hard to capture deliberately. |
| 11 Edge: 10 WAF blocks vs WAF `off` | ✅ | **not read** | Medium — **pixel-only. Read the Edge overview components and the counter source before fixing**; it may be a historical-vs-current labelling issue rather than a wrong number, and the shot may predate a fix. |

**Re-check list after the production rebuild** (in priority order): `/operations/health/metrics` (does the
legend still explode?), `/operations/health/metrics/explorer` (empty prompt?), `/operations/health/metrics/alerts`
(the three zeros), `/operations/edge` (the WAF contradiction), `/operations/health/traces` (dropdown default),
plus one gateway detail and one service detail — neither was ever captured.

## Out of scope for the demo (real, invisible on stage — one line each)

- `probeCloud` ignores HTTP status; 401/403/404 render green "up" / "provider reachable" (`gateways.ts:325-331`).
- `isHealthy` counts `optional` (absent) services in the green numerator (`service-health.ts:15-17`).
- `service-readiness-probe.ts:24-38` promotes `functional: 'pass'` from a 401 under copy saying a gate is only green on proof.
- `status.ts:30` treats any `httpStatus < 500` as up.
- No egress enforcement anywhere — `egressClass` feeds badges and `<select>` labels only; the residency lock is a separate axis never joined to gateway selection.
- `gateway/fleet/[id]/page.tsx:145` performs a data-plane WRITE during a GET render and then renders the status it just wrote.
- Probed hosts are Off Grid's own production domains, hardcoded (`services-directory.ts:40,49,58`); malformed `OFFGRID_SERVICES` silently falls back to them.
- `admin/gateways/seed/route.ts:16` writes into `org_bharat` on every call regardless of caller.
- Cloud gateways probe the env provider URL, not the row's `baseUrl` — two rows with different URLs report identical health.
- `GatewayDetail.tsx:217,259` keep navigational/mode state in `useState`, unkeyed on `gateway.id`; `?panel=edit-gateway&id=X` for a missing row silently opens CREATE mode.
- `ServiceDetail.tsx:81` `uptimePct` counts `optional` as up → absent services show 100% uptime.
- `GatewayDetail.tsx:459` a failed pipelines query renders "0 pipelines bound", used to justify deletion.
- No `error.tsx` under `gateway/**`; no incident entity/route/CRUD exists anywhere in Operations.
- `/gateway/{registry,services,fleet}` duplicate mounts have no redirect (nav trapdoor, not a broken pixel).

