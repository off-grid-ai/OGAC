# Insights — audit findings

Team: AI Engineer · Data Engineer · CISO/assurance + Principal UX / UI / Usability / QA / QC.
Scope: `src/app/(console)/insights/**` (40 pages), `src/lib/*eval*|*drift*|*quality*|*metric*|*score*`, `src/lib/qa/**`.
Status: **complete**.

## Section verdict

No — the numbers in this section cannot currently be trusted, and it is demonstrable on the live box
rather than arguable: three of four retained drift runs say "drift, engine proven" when the only thing
that changed between the compared windows is WHICH EVALUATORS RAN (mean 90.3 → 32.3 by evaluator mix),
and six live `pii_leakage` runs at score 0 — a *perfect* result on a lower-better metric — are averaged
into the org quality mean. The engine-attribution work is genuinely good and `quality-plain.ts` /
`eval-score-scale.ts` are the right abstractions, but each was applied at one seam while the surfaces
rendering the headline numbers bypass them — so the console now attributes a meaningless figure very
precisely. **Fix the score column (scale, direction, null-for-unmeasured) first: five of the six
blockers collapse into that one root cause.**

---

### [BLOCKER] Live "drift detected" verdicts are artifacts of which evaluator happened to run
**Persona:** AI Engineer / Principal QC
**Where:** `src/lib/adapters/drift.ts:172-175` (`scoreHistory`), `:129-147` (window split + `statusFromDelta`)
**What:** The drift signal is `listEvalRuns(40).map(r => r.score)` — the **raw aggregate score column, unnormalized, unfiltered by evaluator**, split into "current" (newest n) and "baseline" (next n). Read live (`eval_runs`, org `default`, n=15/window): BASELINE `{ragas:8, golden:6, geval:1}` mean **90.3**; CURRENT `{ragas:2, golden:6, faithfulness:heuristic:3, faithfulness:ragas:4}` mean **32.3**. Delta −58 → `drift`. `drift_runs` on the box: **3 of 4 retained runs say `status=drift` with `engineProven=true`.** Nothing about the model changed; a different set of evaluators ran. The window boundary is a row-count offset, so adding one `pii_leakage` run reshapes both windows.
**Why it matters:** This is the section's headline verdict, persisted with a provenance badge saying it is proven, and it feeds `evaluateThresholdAlerts`. The engine-attribution work certifies *which code computed a meaningless input*.
**Fix:** Group history by `engine` (and `pipeline_id`), run per-metric series normalized via `scorePercent`, direction-aware. Windows must be **time**-based, not row-offset. Refuse a verdict when the two windows' evaluator mixes differ, and say so.

### [BLOCKER] `eval_runs.score` mixes scales AND directions; exactly one call site normalizes it
**Persona:** Principal QC / AI Engineer
**Where:** `src/lib/eval-score-scale.ts` (the fix) vs its only consumer `src/lib/quality-operator-view.ts:38`
**What:** `grep scorePercent|normalizeScore|meanScore` across `src` returns **one** non-test hit; everything else renders raw. Live distribution: `golden` 0–97, `ragas` 37–100, `faithfulness:grounding` 0–23, `faithfulness:heuristic` 0–79, **`pii_leakage:heuristic` 6 runs all `score=0`**. `pii_leakage` is lower-better — 0 means *no PII leaked, perfect* — and `buildQualityPerformance` averages it in as 0% quality. `eval-score-scale.ts` fixed 0-1-vs-0-100 and never addressed direction.
**Why it matters:** "Current mean", "Change −X pts", the `degraded` badge, the release gate and the alert all read this column. A perfect PII result drags quality down.
**Fix:** Normalize at write time, or make `normalizeScore` direction-aware (carry `direction` from the eval def) and route every score display through it. Never aggregate across metrics of differing direction — report per-check, as `quality-plain.ts` already does correctly for the app tab.

### [BLOCKER] A run where the engine returned nothing is recorded and averaged as a genuine 0%
**Persona:** Principal QC / CISO
**Where:** `src/lib/adapters/evals.ts:319` (`const passed = 0`), `src/lib/ragas-run.ts:135-141`
**What:** `ragasScore` prefers the returned metrics' mean; with zero metrics returned it falls back to `passed/total` — and `passed` is hardcoded 0 — so a fully-omitted run persists `score = 0`. Live: `faithfulness:heuristic` has 4 of 6 runs at exactly 0. `eval-score-scale.ts:51-53` states the rule ("never 0, which would read as *everything failed* rather than *nothing was measured*") and the writer breaks it.
**Why it matters:** Unmeasured is indistinguishable from catastrophic, in the same column, feeding the same mean and the same gate — the drift sidecar's unattributed-fallback shape repeated on the eval side.
**Fix:** `score` must be nullable for a degraded run. Exclude `degraded` runs from means and trends; render "not measured", not 0%.

### [BLOCKER] An unreachable trace/metrics store renders as confident zeros
**Persona:** Data Engineer / Principal QA
**Where:** `src/lib/analytics.ts:70-72`, `:78-82`; `src/app/(console)/insights/ai/overview/page.tsx:29-43`
**What:** `gatewayEvents` swallows every error (`catch { return [] }`) and `computeAnalytics` maps empty → `emptyAnalytics()` (`p95: 0`, `totalEvents: 0`, `egressRate: 0`). The comment at `:78-79` endorses it: *"OpenSearch unreachable — gatewayEvents returns [] → real zeros"*. Zeros are not real when nothing was read. Separately `safeListTraces`/`safeLangfuseRegistry` return `{traces: [], error}` and `ai/overview` renders `traces.traces.length` while **never reading `.error`** — a tracing outage displays "Trace records: 0".
**Why it matters:** The exact defect class already fixed for the log surface. An operator reads "0 events, p95 0 ms" as a quiet system rather than a blind console.
**Fix:** Return a `{data, error}` envelope from `gatewayEvents`/`computeAnalytics` (the pattern `readDriftView` already uses) and render "Unavailable — the metrics store did not answer" per tile. Surface `traces.error`/`registry.error`.

### [BLOCKER] The drift page reports a crash as "not enough runs yet"
**Persona:** Principal QA / QC
**Where:** `src/app/(console)/solutions/quality/drift/page.tsx:63-67`, `:74`, `:78-82`
**What:** When `readDriftView` fails, `data === null`; the page renders Baseline window **0** and Current window **0** as plain numbers (`data?.baseline ?? 0`) and the body says *"At least four recorded evaluation runs are required…"* — asserting a data-volume cause for a thrown adapter error. `error` appears only as a `CardDescription` fallback at `:74`, out-competed by `data?.note` whenever partial data exists.
**Why it matters:** Textbook failure-as-emptiness that actively misdirects: the operator goes and runs more evals to fix a broken adapter.
**Fix:** Branch on `error` before `features.length === 0`; render window counts as "—" when nothing was measured.

### [BLOCKER] "Performance degradation" fires by construction under two days of traffic, and p95 may be measuring cache hits
**Persona:** AI Engineer / Data Engineer
**Where:** `src/lib/analytics-aggs.ts:244` (`recentP95 > baseP95 * PERF_FACTOR`), `:256-261` (`percentile([]) → 0`), `:34` (`RECENT_MS = 2 days`); rendered `src/components/insights/UsageInsightsView.tsx:69-75`
**What:** (a) `percentile([])` returns 0, so a tenant whose traffic is all newer than 2 days gets `baseP95 = 0` and the flag fires unconditionally — the banner reads "Performance degradation: p95 812 ms recent versus **0 ms** baseline" as stated fact. Same shape for `drift.flagged` with `baseBlocked = 0`. (b) There is no cache dimension anywhere in the event mapping (`analytics.ts:60-68` reads only `ms`, `tokens`, `status`), and response caching is on at the proxy — so p95, the per-day latency chart and this comparison silently blend cache hits with real inference.
**Why it matters:** A false alarm presented as measurement, plus a latency figure that cannot be reproduced or acted on.
**Fix:** Require a minimum sample in both windows before flagging; render "no baseline yet" instead of 0. Capture the proxy's cache-hit header and either exclude hits from percentiles or report cached/uncached separately.

### [MAJOR] Engine names are the primary vocabulary of the quality surfaces
**Persona:** Principal Usability Expert
**Where:** `solutions/quality/drift/page.tsx:128-129,137-138,174,190`; `drift-monitoring/[id]/page.tsx:116,167`; `quality/runs/[id]/page.tsx:186`; `src/components/drift/DriftCatalog.tsx:50,150,157,245`; `quality/performance/page.tsx:118,181`; `src/lib/drift-run.ts:90`
**What:** Rendered verbatim: "Evidently is selected and configured", the `Evidently proven` / `PSI fallback` badge, the Evidently library version, `Engine: ragas 0.2.x`, a placeholder reading "e.g. PSI, KS, chi-square", `item.evidentlyName` as a mono badge on every catalog card, a link to `/operations/services/evidently`, and `title={run.engine}` putting `answer_relevancy:ragas` in a tooltip. `drift-run.ts:90` hardcodes `engineLabel: 'Evidently' | 'Off Grid PSI'` — the label helper IS the leak. **Three** competing label helpers exist (`eval-engine-label`, `lineage-labels.publicLabel`, this one) — a DRY violation on the exact rule they exist to enforce.
**Why it matters:** The rule is absolute, and the provenance distinction (real engine vs fallback) is the most important thing on the page — it must be sayable without the vendor name.
**Fix:** Collapse to one helper. Express provenance as outcome: "Full statistical test suite" vs "Built-in approximation — reduced confidence"; raw identifier only under a debug affordance.

### [MAJOR] The drift catalog offers per-column, per-type tests the data path structurally cannot run
**Persona:** Principal QC / AI Engineer
**Where:** `src/lib/adapters/drift.ts:232-246` vs `src/components/drift/DriftCatalog.tsx:157,245` and `src/lib/drift-catalog.ts`
**What:** The catalog lets an operator pick a stat test scoped to `numerical`/`categorical`/`text` **columns**, set per-column overrides, and set how many **columns** must drift. What ships to the collector is `{reference: number[], current: number[]}` — a single unnamed series of aggregate eval scores. No columns, no types, no text. The run still returns a verdict and the route persists it (`src/app/api/v1/admin/drift/route.ts:59-90`) with the selection recorded in `attribution.method`.
**Why it matters:** The operator configures a measurement, gets a confident answer, and the answer has no relationship to what they configured. The drift-share threshold is applied to a share over 2 synthetic metrics.
**Fix:** Either feed real per-column production data, or restrict the catalog to what the input supports and say plainly what is being compared. Never offer a control the path ignores.

### [MAJOR] One configured threshold is compared against whichever quantity the last engine produced
**Persona:** CISO / assurance
**Where:** `src/app/(console)/solutions/quality/performance/page.tsx:40-43`
**What:** `driftScore: status?.drift.metrics[0]?.value` — `metrics[0]` is `score_psi` (unbounded) on the native path and `share_drifted` (a 0–1 proportion) on the Evidently path. The same operator-set threshold means two different things depending on which engine ran, with no indication. `evalPassRate: performance.latestScore / 100` is a **single run's** score labelled as a pass rate — and per finding 2 that run may be a lower-better PII metric.
**Why it matters:** "Threshold breached" renders as a hard alert (`:81`) and is the artifact an auditor would be shown as evidence that quality is gated. It cannot be defended.
**Fix:** Alert on named, engine-stable quantities; store metric identity alongside the value and reject a threshold whose metric does not match.

### [MAJOR] Metrics shown as raw internal ids with no explanation, beside a module that already writes them in plain language
**Persona:** Principal Usability / UX
**Where:** `solutions/quality/drift/page.tsx:88,96`; `quality/runs/[id]/page.tsx:205-210`
**What:** The drift table is headed "Metric or feature" and lists `score_psi`, `mean_delta`, `share_drifted` with a bare number — no unit, direction or threshold; the 0.25/0.1 and −15/−7 cut-points that decide the verdict (`adapters/drift.ts:23-33`) appear nowhere. The run-detail card lists `faithfulness`, `answer_relevancy`, `context_precision` in mono with a percentage. `src/lib/quality-plain.ts:19-33` has a written plain-language sentence for **every one of those ids** plus `passingRule()`, and neither surface imports it.
**Why it matters:** The reader cannot tell a regression from noise without the direction or the band, and the vocabulary assumes an ML background.
**Fix:** Route every metric id through `checkDescription()` + `passingRule()`; show the threshold band inline with the value.

### [MAJOR] Query limits presented as totals
**Persona:** Data Engineer / Principal QC
**Where:** `src/app/(console)/insights/ai/overview/page.tsx:30-43`
**What:** "Trace records" = `safeListTraces(100).traces.length`; "Governed runs" = `listAgentRuns(100).length`; "Registry records" = three lists each capped at 100. A busy tenant sees exactly `100`, `100`, `300` forever, as headline counts with no "showing first 100". `analytics.ts:42` caps at `size: 5000` but at least labels it. `insights/page.tsx:25-26` does this correctly ("in the recent window") — `ai/overview` is the outlier. "Online scoring: `local`" (`:42`) is a config flag in engine vocabulary, not a measurement.
**Why it matters:** A number that silently saturates is worse than no number; it looks like a plateau.
**Fix:** Query counts, not page lengths, or label the window.

### [MAJOR] A second, divergent eval-run detail page survives behind a 308, and Insights→Quality nav points only at redirect stubs
**Persona:** Principal UX
**Where:** `src/app/(console)/insights/evals/[id]/page.tsx` (137 lines); `src/modules/route-migrations.mjs:93`; `src/modules/contextual-navigation.ts:529-535`
**What:** `next.config.mjs:76-77` 308s `/insights/evals/:path*` away, yet the full page remains with `{run.score}%` raw at `:51` and `<Progress value={run.score}>` at `:52` — a stored 0.087 renders "0.087%" with an empty bar while `/solutions/quality/performance` shows the same run as 9% — no engine-attribution card, no re-run, and a Back link labelled "Observability". `insights/finops` and `insights/copilot` are likewise unreachable and unreferenced. `INSIGHTS_QUALITY_DESTINATIONS` still names `/insights/quality/{scorecards,drift,thresholds}` as the module's tabs — all `redirect()` stubs, so `/insights/quality` takes three hops and the `insights-quality` shell can never render. `isInsightsQualityEntityDetailPath` guards a path that no longer resolves.
**Why it matters:** Two implementations of one entity detail, one carrying the score bug this section is trying to fix, is how the score bug comes back. And the section has no working nav into quality.
**Fix:** Delete the dead pages (keep the live `AuditLogSurface`/`SiemSurface`/`ReportsSurface` exports). Repoint `INSIGHTS_QUALITY_DESTINATIONS` at the real `/solutions/quality/*` routes or retire the module.
