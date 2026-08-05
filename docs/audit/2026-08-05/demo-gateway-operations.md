# Demo lens — Gateway / services / devices + Operations observability

Reviewer: conference-demo reviewer (stage lens only).
Scope: `/runtime/gateways`, `/operations/services`, `/operations/devices` (+ `gateway/**` impls);
`operations/health/**`, `operations/metrics/**`.
Inputs: `docs/audit/2026-08-05/gateway.md`, `docs/audit/2026-08-05/operations-observability.md` (re-scored,
not re-derived) + screenshots shot live from `127.0.0.1:3005` and judged as projected 16:9 images.

Severity: **DEMO-BLOCKER** / **DEMO-RISK** / **POST-DEMO**.

## Findings

### 1. [DEMO-BLOCKER] `/operations/services` — every one of ~34 cards reads "⟳ checking", forever
**What the audience sees:** the biggest, most impressive surface in this section — "every service in
your private AI stack, with live health" — and not one green dot. Every card's status line is a
spinner plus the grey word `checking`, next to an internal hostname (`offgrid-s1.local:4000`,
`onprem-console.getoffgridai.co`, `in-process`). Screenshot: `/tmp/audit/demo-ops/operations_services.dark.png`.
**Why:** `ServicesDirectory.tsx:136-144` `if (!res.ok || !alive) return;` + `catch {}` leaves
`health = {}`, so a 403 or any failed batch health fetch is *visually identical to still loading*, and
it re-polls every 30s without ever changing. Same on the detail page (`ServiceDetail.tsx:52,64`:
"Live probe: Checking", "Latency: —", "Collecting first sample…").
**Stage cost:** this is the "here is your own private AI infrastructure, running" screen. If it renders
all-spinners on the conference network (or on any probe failure), the story inverts: it looks like
nothing is running. The correct pattern already exists in this repo
(`WorkerReadinessPanel.tsx:31-38`, `DeviceSoftware.tsx:31-33`) and is simply not applied here.

### 2. [DEMO-BLOCKER] The service cards' gate chips are ellipsized to noise — `DEPLOY… REACHA… FUNCTI… SEEDED CONSOL…`
**What the audience sees:** five tiny pill badges per card, four of them truncated mid-word, in ~9px
uppercase. Illegible on a laptop; pure texture from row 10. Beside them a second unreadable line,
`CAPABILITY AUDIT  6/7 in workflow` — and on several cards `0/1 in workflow`, `1/4`, `1/7`,
`4/10`. A ratio with no stated denominator meaning, mostly reading as "mostly not done".
**Stage cost:** a wall of truncated jargon chips and bad-looking fractions is the single strongest
"work in progress" signal on any screen in my scope. Either widen/relabel the chips to 2–3 readable
words, or hide the gate chips and the `n/m in workflow` line on the LIST and keep them on the detail.

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

### 5. [DEMO-BLOCKER] The preset platform-health charts: half the panels can never populate, and one legacy URL shows the wrong surface entirely
Re-scored from `operations-observability.md` BLOCKER #1/#2 and MAJOR "targets up" / "alerts renders traces".
**Precision correction to the prior report:** it is **2 of the 4** chart specs whose metric names do not
exist, not three — `victoria-metrics.ts:51` `otelcol_receiver_accepted_spans_total` and `:57`
`otelcol_exporter_send_failed_spans_total` (live VM has the un-suffixed `..._accepted_spans` and **no**
`send_failed_spans` series at all). The other two specs (`otelcol_processor_batch_batch_send_size_sum`,
`otelcol_exporter_queue_size`) are correct names and should paint.
**What the audience sees** on `/operations/health/metrics`: a 2×2 grid where **"Request rate" and
"Error rate" are dashed empty boxes reading "Not emitting yet"**, plus the panel band
**`Targets up: awaiting emission`** — permanent, because `sum(up)` is empty on a push-fed VM that nothing
scrapes (`victoria-metrics.ts:112`, `PlatformHealthDestination.tsx:60-64`). Two dead panels and a dead
counter next to two live ones is worse than four dead ones: it looks like the platform is half-broken.
And the "Error rate" hint literally reads *"No export failures reported (good)"* — a reassurance the
panel would print identically if every span were being dropped.
**Also on this URL family:** `/operations/health/alerts` renders **the traces table** (`PlatformHealthDestination.tsx:41-43`
handles `metrics`/`logs`, then falls through to `<TracesDestination/>`; `alerts` never matches). Both
legacy URLs are still linked from the capability map (`data-quality-observability.ts:632,696,711`;
`runtime-governance-operations.ts:297`) — a plausible off-script click lands on a page whose tab says
Alerts and whose content is traces.
**Value of the cheap fix:** two string edits (`- _total`, and swap the error-rate query for
`otelcol_receiver_refused_spans`) + `sum(up)` → drop or relabel. That converts a half-dead monitoring
grid into a live one, and it is the single highest ratio of stage-value to effort in my whole scope.
Do it.

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

### 9. [DEMO-RISK] One service tile is genuinely red, and its label reads "Great Expectations Core 1.19"
`data-quality` (`services-directory.ts:329-338`, `http://127.0.0.1:8944`) has no backend and no container
on the box — 502. So the services grid legitimately renders a **red `Down` tile** whose description is
*"Data-quality engine (Great Expectations Core 1.19) — persistent expectation suites…"*. A single red tile
is survivable ("that's a service we're mid-migration on") but it will be the first thing a technical eye
locks onto, and the copy hands the audience a third-party product name and version number. **Cheapest
demo fix: mark it `probe:'optional'` for the conference build, or stand the container up.**
Related, same grid: because `isHealthy` treats `optional` as healthy, absent optional services count
toward the green numerator — invisible on stage, listed in Out of scope.

### 10. [DEMO-RISK] A registry read failure prints a curl command on the projector
**Where:** `GatewaysManager.tsx:419-420`, reached via `registry/page.tsx:22` +
`withTimeout(..., 5000, [])` (`with-timeout.ts:26-28` collapses reject AND timeout into `[]`).
**What the audience sees** if the DB hiccups or the 5s budget is blown on conference wifi — and note the
dev server was answering a cached page in **21 s** during this audit, so a 5 s timeout is a live risk:

> **No gateways registered yet. Add one, or seed the samples with `POST /api/v1/admin/gateways/seed`.**

An infrastructure failure stated as a fact about his data, plus an internal API path in monospace, on
the screen where he has just said "here are the model endpoints your pipelines run on". There is no
ERROR/PARTIAL/retry state on this surface, and `registry/page.tsx:18` claims a `loading.tsx` skeleton
that does not exist. **Cheapest fix: raise the timeout and change the copy to two sentences that do not
contain a route** — e.g. "Couldn't read the gateway registry just now. Retry." with a Retry button.

### 11. [DEMO-RISK] Every observability tab is one failed fetch away from either a raw error string or a confident wrong "nothing here"
All four Platform-health tabs share this shape, and each failure mode is a distinct bad projection:
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

### 12. [DEMO-BLOCKER] Projector legibility: the services grid is built out of 9–11px type
Hard numbers, not opinion: `ServiceReadiness.tsx:62` gate chips are `text-[9px] uppercase` + `truncate`
inside `grid-cols-5`; `ServicesDirectory.tsx:87,93` the "Capability audit" label is `text-[10px]` and its
ratio badge `text-[9px]`; there are **41** `text-[9|10|11]px` occurrences across `src/components/services/`.
At 1600px logical width projected 16:9, 9px type is sub-pixel from row 10 — the audience sees coloured
smudges. Every card also carries a host:port line in mono at the same scale.
**Fix for the demo:** bump the chip/ratio scale to `text-[11px]`/`text-xs` and drop from five gates to
two on the card (Reachable + Functional). Nothing structural; a class change.

---

## Safe to show / not safe to show

| Surface | Verdict |
| --- | --- |
| `/runtime/gateways` (list) | **SAFE — the best screen in this scope.** Fix the two `not configured` tiles first. |
| `/runtime/gateways/[id]` (detail) | **SAFE with one caveat** — do not narrate the node count out loud; if a node is degraded the header contradicts the pool below it. |
| `/operations/services` (list) | **NOT SAFE AS-IS, but the highest-upside screen he has.** All-spinner health + 9px truncated chips + one red tile. Two small fixes make it the centrepiece. |
| `/operations/services/[id]` (detail) | **NOT SAFE** — "Live probe: Checking", "Latency: —", "Collecting first sample…" can sit there indefinitely, and the dependency chips are raw ids (`postgres`, `litellm`, `qdrant`). |
| `/operations/devices` | **DO NOT OPEN.** Coming-soon card, zero interactive elements. Detail route 404s. |
| `/operations/health` → `/…/metrics/explorer` | **NOT SAFE** — lands on an empty PromQL box; the suggested query returns "No data". |
| `/operations/health/metrics/alerts` | **DO NOT OPEN** — `Firing 0 · Pending 0 · Alert rules 0 · No active alerts` with no rule engine running. |
| `/operations/health/metrics` (legacy) | **NOT SAFE** — 2 of 4 panels permanently "Not emitting yet" + `Targets up: awaiting emission`. Worth fixing, see below. |
| `/operations/health/alerts` (legacy) | **DO NOT OPEN** — the tab says Alerts and renders the traces table. |
| `/operations/health/logs` | **CONDITIONALLY SAFE** — good when VictoriaLogs answers; a 403 blanks the page and a hits-endpoint failure prints "No matching log volume" over real rows. Rehearse it on the venue network. |
| `/operations/health/traces` + `traces/[traceId]` | **PROBABLY THE BEST OBSERVABILITY PROOF HE HAS** — real spans, real waterfall, a real deep-linked detail route. Risk is the raw "Could not reach Jaeger" error string if it fails. |
| Any `/gateway/*` URL | **AVOID** — duplicate mount with no redirect; every in-page link exits to the canonical space, so it is a one-way trapdoor. |

## Demo readiness

### The story (2 minutes, in this order)

"This is your own private AI infrastructure — and here it is running."

1. **`/operations/services`** (~40 s). Open on the full grid. This is the only screen in the product that
   shows the *whole* stack at once, grouped Console → Gateway → Internal services. Say the line: "every
   one of these is open source, running on your hardware, and the console watches all of them."
   *Precondition: health must paint green within ~2 s and the chips must be readable. Today it does not.*
2. **`/runtime/gateways`** (~35 s). "Here is where the models actually run." Point at the two chips:
   green **data stays on-prem** vs amber **data leaves (cloud)**. This is the single most persuasive
   pixel-level asset in my scope — one glance communicates the entire residency pitch.
3. **Click Open on On-Prem Cluster** (~25 s). Node pool + model catalog: "three nodes, this is the model
   they serve, and no request leaves the building." Don't dwell on the node ratio.
4. **`/operations/health/traces`** → **click one trace** (~30 s). "And every single request through it is
   traced end to end, on your own box." The trace detail is a real route with a real waterfall — the
   strongest 'this is a real platform' beat available here.
5. **Stop.** Do not continue into Metrics, Alerts or Managed devices.

### What to avoid on stage
- The `Managed devices` nav item (and the `SOON` badge that sits in the rail on every Operations page).
- The Alerts tab in either of its two URLs.
- The Metrics tab, until the metric names are fixed — it opens on an empty query prompt.
- Typing the placeholder query in the metrics explorer; it returns "No data".
- Any capability-map link that points at `/operations/health/metrics` or `/operations/health/alerts`.
- Narrating "N of N nodes up" as a fact.
- Zooming a service card — the gate chips are 9px and truncated.

### Cheapest wins, ranked

1. **Fix three strings in `src/lib/victoria-metrics.ts` and one in `MetricsExplorer.tsx:129`** —
   `otelcol_receiver_accepted_spans_total` → `otelcol_receiver_accepted_spans` (`:51`),
   `otelcol_exporter_send_failed_spans_total` → `otelcol_receiver_refused_spans` (`:57`), and
   drop/replace the `sum(up)` "Targets up" tile (`:112`). Then give the explorer route a default
   `?q=otelcol_processor_batch_batch_send_size_sum` so it lands on a chart, not a prompt.
   **Worth:** four to five lines converts the section's *default landing page* from zero live pixels into
   a live emerald time series, takes the legacy preset grid from 2-dead-of-4 to 4-live-of-4, removes a
   permanent "awaiting emission" label, and makes his first Run in the query box return real data. Nothing
   else in my scope buys as much stage credibility per line. **Do this one even if you do nothing else.**
2. **Make a failed service-health fetch render as a state, not as an eternal spinner**
   (`ServicesDirectory.tsx:136-144`, `ServiceDetail.tsx:52,64`). The correct pattern is already in
   `WorkerReadinessPanel.tsx:31-38` — copy it. **Worth:** the difference between "34 services, all live"
   and "34 services, all thinking about it".
3. **Two class changes on the service card** — chips `text-[9px]`→`text-xs`, and show 2 gates instead of 5
   (or hide the `n/m in workflow` ratio on the list). **Worth:** the grid stops reading as debug output.
4. **Data-only, zero code:** configure keys for the OpenAI/Anthropic gateway rows (or delete them) so all
   gateway tiles are live; stand up or `optional`-ise `data-quality` so the grid has no red tile and the
   words "Great Expectations Core 1.19" leave the screen.
5. **Hide the `Managed devices` module for the conference build** (`comingSoon` entry in
   `modules/registry.ts:127-146`). One line removes a dead section *and* the `SOON` badge from every
   Operations screen. If you'd rather keep it, fix the alerts probe instead
   (`adapters/victoriametrics.ts:120-132`) so the genuinely good "No alerting engine deployed — deploy
   vmalert and point it at this instance" card renders in place of `Alert rules 0`.
6. **Registry empty-state copy** (`GatewaysManager.tsx:419-420`): delete
   `POST /api/v1/admin/gateways/seed` from user-facing text and raise the 5 s `withTimeout` budget.

## Method / confidence

- Screenshots shot at 1600px against the shared dev server (`/tmp/audit/demo-ops/`): `runtime_gateways`,
  `operations_services`, `operations_devices` — read and judged as projected images. **The `--dark` copies
  rendered light**: the shell theme is attribute-driven, so `prefers-color-scheme` emulation does not flip
  it; all judgements above are on the light theme.
- The remaining routes could not be captured: the shared server degraded to **~21 s for a cached page**
  (six audit teams running Playwright at once) and the run stalled after three routes. Findings 4, 5, 6,
  10 and 11 are therefore **code-confirmed and string-exact but not pixel-confirmed** — every quoted
  string is read from the component that renders it, and the route chain for each was traced by hand.
  Re-shoot `/operations/health/metrics/explorer`, `/operations/health/metrics/alerts`,
  `/operations/health/{logs,traces}`, `/operations/nodes`, `/operations/edge` and a service detail when
  the server is quiet.
- Screenshots are viewport-height only (1000px): the console shell scrolls internally, so `fullPage`
  captures one screen. Cards below the fold on `/operations/services` (including the red `data-quality`
  tile) are inherited from `docs/audit/2026-08-05/gateway.md`, not seen by me.

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

