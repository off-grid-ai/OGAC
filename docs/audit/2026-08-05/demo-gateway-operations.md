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

