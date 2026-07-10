# Adversarial break-test — CONSOLE BUILDER / STUDIO

Scope: the plain-language + canvas builder for agents/apps, the AppSpec model + validator, the
multi-step executor (inline + durable), triggers (webhook/email/whatsapp/schedule), HITL
review/resume, org-context/pipeline binding. Base: wave2 HEAD (`2d54f5d`), worktree off HEAD,
no push/merge/deploy. Live probes were READ-ONLY (unauthenticated gate checks only; no writes to the
seeded demo).

Mindset: BREAK it, don't confirm it. Each confirmed break below has a runnable repro and asserts the
TERMINAL artifact (the persisted run status / the number of side-effects the operator gets), reached
from the real seam (`validateAppSpec`, `runApp`, `resumeAppRun`, `buildTriggerInput`).

RED tests (all `.skip`-gated so the shared suite stays green; each proven RED with skip removed → 8/8 fail):

- `test/adversarial-builder-cycle.test.ts` — G-ADV-BUILD-1 / -2
- `test/adversarial-builder-resume-drift.test.ts` — G-ADV-BUILD-3
- `test/adversarial-builder-payload.test.ts` — G-ADV-BUILD-5

---

## Axes enumerated

- **entity kind:** agent (single-step app) × app (multi-step)
- **build mode:** NL-generated (compose / studio-builder) × manual canvas × text-editor × direct POST/PATCH
- **tools:** composable apps (`app:<id>`) × primitives (`prim:web_search`/`read_url`/`http`) × registry (`tool:<id>`)
- **triggers:** on-demand × webhook × email × whatsapp × schedule
- **lifecycle:** build → input → runs → review → reports
- **run mode:** inline × durable (Temporal `offgrid-apps`) × durable-requested-but-degraded-to-inline
- **HITL:** resume(approve) × resume(reject) × never-resumed × resume-after-spec-edit × concurrent-resume
- **org-context:** rules/connectors/policies/pipeline auto-inherited; tenant isolation
- **pipeline binding:** bound × org-default × missing/deleted
- **data-domain:** bound × unbound (save-with-gap) × missing connector
- **role:** admin/writer × viewer × machine (webhook)
- **graph shape:** linear × fan-out × fan-in/diamond × **cycle (reachable)** × **self-loop** × unreachable-orphan
- **payload:** well-formed × malformed JSON × bare string × oversized top-level × **oversized nested** × deeply nested

## Journeys / pairs run

1. Build a cyclic app (reachable cycle + self-loop) via a spec that passes the validator → run it. **[BREAK-1/2]**
2. Save app with no data domain / unbound connector-query → run. **[OK — honest error]**
3. HITL run, edit the app while paused, then approve. **[BREAK-3]**
4. HITL run, approve via the real persisted-row path (single reviewer). **[OK — 1 send]**
5. HITL run, concurrent approves (check-then-act on the inline path). **[⚠️ RACE — no transition lock]**
6. Webhook with malformed JSON / bare string / oversized nested payload. **[OK malformed; BREAK-5 nested]**
7. App-as-tool composition cycle + depth. **[OK static guard; ⚠️ depth not propagated]**
8. Unauthenticated builder create/run/trigger. **[OK — 401 fail-closed, live-verified]**
9. Out-of-order lifecycle (review a run not awaiting_human). **[OK — canReview → 409]**

---

## Coverage ledger

| Intersection | Result | Note |
|---|---|---|
| reachable cycle × validator | ❌ BREAK-1 | `validateAppSpec` accepts it (reachability ≠ acyclicity) |
| reachable cycle × inline run | ❌ BREAK-2 | run wedges → terminal `running`, cycle steps stuck `queued` |
| self-loop × validator/run | ❌ BREAK-1/2 | same, minimal case |
| cycle × compile | ❌ BREAK-1 | `app-compile.ts` has no DAG check either |
| cycle × canvas addEdge | ✓ | `wouldCreateStepCycle` blocks it at edit time (the ONLY guard) |
| HITL resume × spec edited while paused | ❌ BREAK-3 | added output step re-fires sink up to maxIterations× |
| HITL resume × single reviewer (persisted-row path) | ✓ | sends exactly once |
| HITL resume × concurrent approves (inline) | ⚠️ G-ADV-BUILD-4 | check-then-act, no row transition lock → double side-effect risk |
| webhook × malformed JSON / bare string | ✓ | falls back to `{input: rawBody}` |
| webhook × oversized nested payload | ❌ BREAK-5 | `sanitizeBody` clamps top-level strings only |
| webhook × unknown/unsigned token | ✓ | 401 fail-closed (live-verified) |
| unbound data-domain × run | ✓ | validator blocker + runtime honest error, no fabrication |
| missing connector × run | ✓ | honest error (`connector … which is missing`) |
| app→app composition cycle | ✓ | static `detectAppToolCycles` over org apps blocks it |
| app→app depth cap | ⚠️ G-ADV-BUILD-6 | `depth` never threaded across the recursive boundary → cap inert (static guard still holds) |
| viewer × builder writes | ✓ | `requireAdmin` on all admin routes (401 live; viewer 403 by gate) |
| cross-tenant × run | ✓ (code) | `currentOrgId` + org-scoped store; covered by security-wave2-runs-isolation |
| out-of-order review (not awaiting_human) | ✓ | `canReview` → 409 |
| missing/deleted pipeline × run | ✓ | null contract → additive legacy allow (documented behaviour) |

---

## Confirmed breaks (severity-ranked)

### BREAK-1 (HIGH) — the validator accepts a cyclic app; the cycle guard lives only in the canvas editor
**Repro:** `validateAppSpec` on `entry e → a → b → a` (or self-loop `a → a`) returns `ok:true`.
**Root cause:** `src/lib/app-model.ts:129` `validateAppSpec` checks single-entry + reachability
(BFS from the entry) but NOT acyclicity. The only cycle guard is `src/lib/app-builder.ts:60/90`
`wouldCreateStepCycle`/`addEdge` — the CANVAS path. But `apps-store.createApp`/`updateApp`
(`src/lib/apps-store.ts:135,229`) and the executor (`src/lib/app-run-plan.ts` header) trust the
validator as the authority. So a cyclic spec via **direct POST/PATCH** `/api/v1/admin/apps[/id]`, the
NL compose path, or `workflowToAppSpec` saves clean (201). `src/lib/app-compile.ts` has no DAG check
either. This is a DRY/SOLID violation: one rule (acyclicity) enforced in one surface, omitted in the
authority the other surfaces depend on.
**Terminal artifact:** a persisted `apps` row that is a non-runnable graph, accepted with no error.

### BREAK-2 (HIGH) — a cyclic app WEDGES into a terminal `running` status (never done, never error)
**Repro (proven):** `runApp` on the reachable cycle returns `status: 'running'`; only the entry step
ran (`e:done`); `a`/`b` stay `queued`. The persisted `app_runs` row is
`{status:'running', steps:[e:done, a:queued, b:queued]}` — permanently.
**Root cause:** `nextRunnableSteps`/`isStepReady` (`app-run-plan.ts:142,151`) require ALL predecessors
`done`; a node in a cycle can never satisfy that. `driveRunnableSteps` (`app-run.ts:819`) has a bounded
loop (`maxIterations = steps.length + 1`) so it does not hang, but it exits with `runnable.length === 0`
and `finalize` (`app-run.ts:859`) returns the derived aggregate `running` (`deriveRunStatus`,
`app-run-plan.ts:181` — some done, not all done, no error). The run route returns that status verbatim.
**Impact:** the operator sees a run stuck "running" forever — no honest failure, no completion. Depends
on BREAK-1 to reach it (fixing the validator closes both).

### BREAK-3 (HIGH) — HITL resume re-executes an added step N times when the app is edited while paused
**Repro (proven):** run a 3-step HITL app inline → pauses at the human step (row: s1:done,
s2:awaiting_human, s3:queued). Append `s4` (a second email sink) to the app while paused. Approve. The
sink fires **6 times** (`deps.sendEmail` called 6×; run steps show `s4:done ×5`).
**Root cause:** the review route (`apps/runs/[id]/review/route.ts:112,125`) rebuilds run state from the
OLD persisted row but drives `driveRunnableSteps` over the CURRENT (edited) spec (`getApp` at resume).
`driveRunnableSteps` (`app-run.ts:820`) schedules over `spec.steps`, tracks completion in `state.steps`.
`applyStepResult` (`app-run-plan.ts:202`) matches by step id → a step present in the edited spec but
absent from the old row's state is NEVER recorded `done`, so `nextRunnableSteps` returns it every
iteration until the loop bound. No reconciliation of `state.steps` vs `spec.steps` on resume.
**Terminal artifact:** N duplicate emails/reports for a single approve (bounded by `steps.length + 1`).

### BREAK-5 (MEDIUM) — webhook payload clamping is top-level-only; nested oversized content passes unbounded
**Repro (proven):** `buildTriggerInput('webhook', {wrap:{deep:"y"×5_000_000}})` → `input.body.wrap.deep`
is 5,000,000 chars (the 100k cap does not apply). A 200k-element array under a key passes whole;
5000-deep nesting passes whole.
**Root cause:** `sanitizeBody` (`src/lib/trigger-dispatch.ts:132`) only `clampText`s TOP-LEVEL string
values; non-string values (arrays, nested objects) are assigned as-is. The module docstring claims the
input "stays small and typed" — false below depth 0. The public webhook route (`triggers/[token]/route.ts:41`)
also reads the full body via `req.text()` before HMAC, so an unsigned oversized body is buffered
pre-auth (secondary DoS surface; HMAC still rejects the run).
**Terminal artifact:** the `input.body` fed to `submitAppRun` still carries the oversized/nested blob.

---

## Reviewed-and-noted (⚠️ untested/partial — logged, not fully confirmed as breaks)

### G-ADV-BUILD-4 (MEDIUM, ⚠️) — concurrent HITL approve is a check-then-act race on the inline path
The review route reads the row (`getAppRunView`, line 55), checks `canReview`, then resumes
(`resumeAppRun`, line 126). Two concurrent approves both observe `awaiting_human` before either
persists, so both resume → the inline path has NO row-level transition lock / optimistic version, so
downstream side-effecting sinks can fire twice. The durable (Temporal signal) path is idempotent; the
inline path is not. Not yet proven end-to-end against the real DB with true concurrency — logged as a
gap to add a `WHERE status='awaiting_human'` compare-and-set before resume.

### G-ADV-BUILD-6 (LOW, ⚠️) — app→app depth cap is inert on the real execution path
`invokeAppTool` (`adapters/tool-primitives.ts:269`) only enforces `MAX_APP_TOOL_DEPTH` when
`ctx.depth !== undefined`, and the recursive `submitAppRun` (line 295) passes neither `depth` nor
`callerAppId` into the child run. `agentrun.ts:288` passes `callerAppId: agentId` (agent id, not app
id) and no `depth`. So the depth cap never arms across the boundary. The org-wide static
`detectAppToolCycles` still blocks a mutual A↔B reference (so no hard infinite loop), but the
belt-and-braces depth bound for a long acyclic chain is not effective. Defense-in-depth only.

## Positives verified (✓)

- Unbound data-domain / missing connector → honest runtime error, never a fabricated row.
- Malformed / bare-string webhook body → graceful `{input: rawBody}` fallback.
- Unknown/unsigned webhook token → 401 fail-closed (live-verified, read-only).
- Builder create/run routes require admin → 401 unauth (live-verified); viewer writes 403 by gate.
- Out-of-order review (run not `awaiting_human`) → `canReview` 409.
- App→app composition cycle → static graph guard refuses (`refused: … would create a cycle`).
- Missing/deleted pipeline → null contract → additive legacy allow (documented, additive-only).
