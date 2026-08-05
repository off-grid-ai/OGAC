# Operations — logs / traces / metrics / alerts — audit findings

Team: SRE · Full-stack · CISO + Principal UX / UI / Usability / QA / QC.
Scope: `operations/health/**`, `operations/metrics/**`, the observability libs, `admin/operations` routes.
Status: **complete**. Live box probed read-only.

## BLOCKERS — the surface states something false about the platform

### [BLOCKER] Three of four platform-health charts query metric names that do not exist → "Not emitting yet" while telemetry IS flowing
**Persona:** SRE
**Where:** `src/lib/victoria-metrics.ts:51`, `:57`
**What:** Queries `otelcol_receiver_accepted_spans_total` and `otelcol_exporter_send_failed_spans_total`. Live VM (27 metric names) has **`otelcol_receiver_accepted_spans`** (no `_total`) and **no `send_failed_spans` series at all**. Verified: `sum(rate(..._total[5m]))` → `result: []`; without `_total` → a real series. So `shapeChart` sets `emitting:false` and `MetricChart.tsx:51-57` renders "Not emitting yet" + "No span/request throughput reported yet — awaiting OTel receiver traffic", while Jaeger simultaneously holds 5 instrumented services and real traces. **The chart is broken, not the pipeline.**
**Fix:** Drop the `_total` suffixes and reconcile every spec against `/api/v1/label/__name__/values` (only `otelcol_processor_batch_batch_send_size_sum` and `otelcol_exporter_queue_size` are correct today).

### [BLOCKER] The "Error rate" chart can never fire, and its empty state reads as good news
**Persona:** SRE
**Where:** `src/lib/victoria-metrics.ts:57-58`
**What:** Hint text: *"No export failures reported (good) or the exporter is not emitting counters yet."* The metric does not exist, so this panel shows the identical reassurance whether exports are healthy or dropping every span. This is the one chart an SRE reads to decide nothing is wrong.
**Fix:** Query a name that exists (`otelcol_receiver_refused_spans`/`_failed_spans` are present), and make "query returned no series" visually distinct from "value is zero".

### [BLOCKER] `engineDeployed` is inferred from an endpoint VictoriaMetrics answers with or without a rule engine
**Persona:** SRE / CISO
**Where:** `src/lib/adapters/victoriametrics.ts:120-132`
**What:** A successful `/api/v1/rules` + `/api/v1/alerts` read is treated as proof vmalert exists. Live: `GET /api/v1/rules` → **200** `{"data":{"groups":[]}}`, and `docker ps -a | grep vmalert` → **no vmalert container**. So `engineDeployed:true`, the honest "No alerting engine deployed" state (`MetricsAlerts.tsx:39-53`) is skipped, and the operator sees `Firing 0 · Pending 0 · Alert rules 0` and "No active alerts." **Nothing is being evaluated; the surface says all quiet.** Compounding it, the capability ledger self-reports this as verified (`data-quality-observability.ts:635-636`: "READ from the live vmalert API (verified engineDeployed:true)") — a claim produced by the same flawed inference.
**Fix:** Probe for a rule engine directly (non-empty `groups`, or a vmalert base URL / `/-/healthy`); treat `groups: []` from a bare VM as *not deployed*, not *zero rules*.

## MAJOR

### [MAJOR] "Targets up: awaiting emission" is permanent
`victoria-metrics.ts:112` queries `sum(up)`; live `up` → `[]` and always will — this VM is remote-write/push-fed, nothing scrapes. `PlatformHealthDestination.tsx:60-64` renders the null as "awaiting emission", implying it is on its way.

### [MAJOR] LogsExplorer crashes outright on any non-2xx from its admin routes
`LogsExplorer.tsx:92` does `r.json()` with no `r.ok` check. `requireAdmin` returns `{error:'forbidden'}`/403, which has no `rows`. Line 200 is guarded; **line 203 is not** — `result && result.rows.length === 0` throws before the `!result.error` arm. The page gate is `requireModuleForUser('platform-health')`, not an admin gate, so a non-admin with the module renders the page and then blanks it.

### [MAJOR] Authorization refusal is reported as a backend outage
The same 403 surfaces as "VictoriaLogs error: forbidden" (`LogsExplorer.tsx:183-187`), "Could not reach Jaeger: forbidden" (`TraceSearch.tsx:238-242`, `TraceDetail.tsx:78-81`). An operator is sent to debug a service that is up.

### [MAJOR] Histogram read failure presents as emptiness — and can contradict the table beside it
`LogsExplorer.tsx:93` fetches `/logs/hits`; `:98` takes `hits.series ?? EMPTY_SERIES` and **discards `hits.error`** (the adapter does populate it, `adapters/victorialogs.ts:166`). `LogsHistogram.tsx:22-25` prints "No matching log volume in this window." Since `/select/logsql/hits` and `/query` are separate endpoints, a query accepted on one and rejected on the other yields "0 matches" above a table of real rows.

### [MAJOR] `/operations/health/alerts` renders the traces table; `/operations/health/metrics` renders a second, legacy metrics surface
`PlatformHealthDestination.tsx:41-43` handles `metrics` and `logs` then `return <TracesDestination/>` — `alerts` falls through. There is no `health/metrics/page.tsx`, so that URL resolves to the `[destination]` preset-chart page while the rail points at `/metrics/explorer`. Both legacy URLs are actively linked from the capability map (`data-quality-observability.ts:632,696,711`, `runtime-governance-operations.ts:297`). Two metrics surfaces, different data, one dead-end `alerts` id.

### [MAJOR] TraceSearch shows the error and the reassuring empty state together
`:238-242` renders "Could not reach Jaeger: …", then `:288-294` still renders "No traces in this window. Widen the time range or clear filters." — advice that cannot help, beside the reason it cannot.

### [MAJOR] Saved-query CRUD swallows its failures
`MetricsSavedQueries.tsx:48` `.catch(() => {})` → a 403 or DB error renders "No saved queries yet." `:100-101` `if (res.ok) load();` → a failed DELETE is a silent no-op and the row just stays. (Writes themselves are properly audited and org-scoped.)

## MINOR

- **There is no incident surface at all.** Every `incident` hit in `src/` is prose or DR-drill copy. No incident entity, route, list, detail or CRUD exists in Operations.
- `TraceSearch.tsx:60-67`, `:70-80` call `res.json()` with no `res.ok` and no try/catch — a 403/500/HTML response is an unhandled rejection and the service dropdown silently stays empty (reads as "no instrumented services").
- `MetricsExplorer.tsx:129` placeholder is the non-existent metric, so an operator's first Run returns "No data".
- `logs/page.tsx:16` double-insets (`PageFrame` inside `ContextualModuleShell`, which `PageFrame.tsx:11-13` warns already owns padding); sibling tabs render bare `w-full` divs. Inconsistent gutters.

## What holds up

- **Width discipline is clean** — zero page-level `mx-auto`/`max-w-2xl|3xl|4xl` across `components/operations/`, `components/platform-health/`, `operations/health/**`; grids are `lg:grid-cols-2/3/4`; tables sit in `overflow-x-auto`.
- **URL-driven nav is real** — `TraceSearch.tsx:33-37`, `LogsExplorer.tsx:47-50`, `MetricsExplorer.tsx:33-34`, `PlatformControls.tsx:11-23` read filters from `useSearchParams`; only genuinely ephemeral state is local (row expansion, open span) — correctly so.
- **List → detail is a real route.** `traces/[traceId]/page.tsx` is a page, not a modal, and rebuilds the search filters into `backHref` so Back returns to the same search.
- **Read-only is stated with a reason, not left looking unfinished** — Jaeger span TTL, VictoriaLogs `-retentionPeriod`, vmalert file-provisioned rules. These are the deliberately-deployment-owned cases handled correctly.
- **The pure/I-O seam is genuinely clean** — `jaeger-trace.ts` is zero-IO and does the real error detection (covers `error`, `otel.status_code`, `http.status_code≥500`), with the fetcher isolated and injectable.
- Langfuse-backed per-entity trace resolution is org-scoped against cross-tenant reads (`trace-entity.ts:19-22`).
- **Backend attribution is correct throughout**: logs→VictoriaLogs, metrics/alerts→VictoriaMetrics, trace search/detail→Jaeger, per-entity→Langfuse; each surface names the one it actually reads.
