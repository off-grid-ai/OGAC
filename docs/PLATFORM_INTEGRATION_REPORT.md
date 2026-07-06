# Platform Integration Report — builder epic + evals sweep

Date: 2026-07-06 · Method: adversarial read-and-verify with file:line citations (no live deploy).
Scope: the 5-screen app lifecycle (build → input → running → review → reports), the connector rule
engine, triggers, and the evals revamp.

## Verdict — does the builder lifecycle cohere?

**YES, it coheres — with two honest, documented seams (both about the durable path).** One AppSpec
threads cleanly from NL compile → dual-mode refine → save → input → run → (durable) review →
reports. Canvas and text builders share the *same* pure reducers, so they cannot drift. Governance
(policy/guardrails/grounding/signing) is applied per agent step verbatim. The two seams — (1) the
console test-run is always inline (HITL only pauses/resumes on the durable path, which needs the
`offgrid-apps` worker enabled), and (2) an inline agent step needs a materialized agent id to run —
are both surfaced *honestly* in code and UI, not hidden. Nothing fabricates data, connectors, or
scores.

## Per-screen / per-subsystem

### BUILD — NL→AppSpec + dual-mode editing — PASS
- `compileAppSpec` (`src/lib/app-compile.ts:84`) runs an LLM decompose path then re-binds/gap-checks
  every step itself (`assembleFromPlan:121`), falling back to a deterministic heuristic
  (`heuristicDecompose:191`). The LLM plan is treated as untrusted — every connector-query phrase is
  re-resolved through `resolveDomain` (`bindDataPhrase:291-311`); an unbindable phrase is **dropped
  with a gap**, never fabricated (`:302`).
- Both editors call the SAME pure reducers: `AppBuilder.tsx:29-44` and `StudioCanvas.tsx:31-41` both
  import from `src/lib/app-builder.ts`; edges are always re-chained (`rechainEdges:34`). No drift.
- Both POST to `/api/v1/admin/apps/compile` and save via `/api/v1/admin/apps`
  (`AppBuilder.tsx:137,165`; `StudioCanvas.tsx:211,256`). Save re-validates server-side
  (`validateAppSpec`).
- CONCERN (minor): `apps/compile` route has no audit entry — acceptable, it's a read-only transform
  that persists nothing.

### INPUT — AppSpec.inputForm → run — PASS
- `AppInputForm.tsx:33` renders `app.inputForm` (fallback single free-text field `:174`) and POSTs to
  `/api/v1/admin/apps/[id]/run` (`:45`). The saved-app input page is deep-linkable (`studio/new/[id]`).

### RUNNING — live per-step trace — PASS
- `AppRunStatus.tsx:80` polls `GET /api/v1/admin/app-runs?appId=…` (`:87`) every 2s while
  `shouldPoll(status)` (`:101`), stopping at terminal. It renders per-step status/output/refs/detail
  from persisted rows. Wired to real pages: `apps/runs`, `apps/runs/[id]`, `apps/reports`. The GET
  route is admin-gated and org-scoped (`app-runs/route.ts`). The executor persists per-step state via
  `upsertAppRunState` (`app-run.ts:174-186`).

### REVIEW (HITL) — durable pause/resume — PASS (with the inline seam, honest)
- The durable workflow pauses on a human step with `condition(() => pendingResumes.has(step.id))`
  (`src/worker/app-run.workflow.ts:145`), buffers races, resolves approve→done / reject→error
  (`resolveHumanStep:181`). Signal path: `AppReview.tsx:43` → review route
  (`apps/runs/[id]/review/route.ts`) → `signalAppRun` (`adapters/apprun.ts:172`) →
  `handle.signal('resumeStep', …)` (`:183`).
- **The inline case is handled honestly.** An inline run terminates at the pause with no workflow to
  signal; `signalAppRun` returns `not_configured`/`not_found`, the route returns **409
  `resumable:false`** with a clear message (`review/route.ts:73-84`), and `AppReview.tsx` surfaces it.
  The console test-run route (`apps/[id]/run/route.ts:32`) calls `runApp` inline directly — it does
  NOT go through `submitAppRun`, so HITL resume from the console test path is never available. Only
  the published/trigger path (`app/[slug]/run/route.ts:78` → `submitAppRun`) can run durably.

### REPORTS — rollups + signed PDF — PASS (with a sink caveat)
- `app-reports.ts` computes outcomes, HITL approvals/rejections + rate, exceptions + rate,
  throughput/day, avg latency, tokens/cost, per-run summary, day-buckets, step-kind breakdown, and
  stat tiles (`computeReportMetrics`, `runCost`, `bucketByDay`, `singleRunSummary`, `buildReportStats`).
- Real signed PDF: `GET /api/v1/admin/app-runs/[id]/report` renders via `pdf.ts` (pdf-lib, no browser)
  and signs a manifest with **ed25519** (or HMAC fallback) via `provenance.ts`/`signing.ts`;
  `X-Provenance-*` headers make it offline-verifiable. Signing is real, not stubbed.
- CONCERN: the `report` output *sink* on a step only records intent (`app-run.ts:348-356` — "delivery
  deferred") — it does not generate/deliver a PDF during a run. The download route is the real path.
  Do not confuse the two. Documented in `docs/user/app-reports.md`.

### Connector rule engine — PASS
- `resolveDomain` (`data-domains.ts:160`) is deterministic + no-guess: exact label/alias trusted
  unless genuinely ambiguous (`:170-177`); fuzzy binds only above `MIN_CONFIDENT_SCORE` and beating
  the runner-up by `AMBIGUITY_MARGIN` (`:180-183`); else null. Pure, zero-IO.
- `connector-query.ts:48` is READ-only; a failed read returns `result:null` → the executor emits an
  honest "No rows returned" step, never a fabricated row (`app-run.ts:300-311`). It's the 4th
  retrieval source with the same rule.

### Triggers — PASS
- Webhook `app/[slug]/run/route.ts` is governed, not wide open: requires a webhook token OR verified
  principal (`:52-61`), app must be published (`:66`), funnels through `submitAppRun` (`:78`). No
  bypass.
- Email/WhatsApp are air-gap-gated and fail-closed: disabled unless `OFFGRID_EMAIL_IMAP_URL`
  (+USER/PASS) / `OFFGRID_WHATSAPP_URL` are set (`trigger-dispatch.ts` config resolvers); both funnel
  through `submitAppRun` when configured (`email-imap.ts:86`, `whatsapp-onprem.ts:87`). No trigger
  runs an app without auth + governance.

### Evals — PASS
- `eval-templates.ts` has **12 templates** (`:51-202`), each declaring its engine (ragas / guardrails
  / presidio / heuristic). `engineAvailability()` (`:228-266`) reports ready / degraded / unavailable
  honestly.
- `eval-runner.ts:127-128` makes a binary real-vs-heuristic decision and tags the result; **no code
  path fabricates a high score** when the real engine is missing (`:23,67`). The engine tag is
  persisted (`:152-159`) and shown in the UI.
- Full CRUD + run backed: `eval-defs` GET/POST + `[id]` PATCH/DELETE + `[id]/run` POST; `evals` GET +
  `evals/run` POST; `eval-templates` GET; `golden-cases` GET/POST + `[id]` PATCH/DELETE. No orphan UI
  actions.

## Cross-cutting

- **Governed agent step**: an agent step runs `runAgent(...)` verbatim (`app-run.ts:256`) — full
  policy/guardrail/budget/grounding/provenance. Prior-step outputs are threaded as context
  (`buildAgentQuery:194`). Denied/blocked → step error → run halts (`:258-266`).
- **Audit**: apps POST/PATCH/DELETE, data-domains POST/PATCH/DELETE, `app.run`, and `app.run.review`
  all write `auditFromSession`. Compile is unaudited (read-only, acceptable).
- **UI actions with no backing route**: none found in the builder/evals surfaces.
- **IP / 127.0.0.1 leaks in new surfaces**: none (the only literal is
  `DEFAULT_TEMPORAL_ADDRESS = '127.0.0.1:7233'` in `app-run-durable.ts:31`, an env-overridable default
  — not a hardcoded prod endpoint).

## Open items (see docs/GAPS_BACKLOG.md → Post-builder-epic sweep)
1. Durable `offgrid-apps` queue/worker not confirmed enabled on the fleet — HITL resume only works
   durably.
2. Console test-run (`apps/[id]/run`) is always inline — a HITL app tested there can't be resumed.
3. Inline agent steps (no agentId) can't execute — need materialization into a customAgent.
4. `report`/`email`/`whatsapp` output sinks defer delivery at run time.
