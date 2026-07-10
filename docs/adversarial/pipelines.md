# Adversarial QA — CONSOLE PIPELINES

Bug hunt against the pipelines feature (build/pipelines, the pipeline entity + lib, the pipeline-as-
callable-API, run-contract enforcement PA-16/PA-16b, governance overlays, gateway binding, consumers).
Role: smart QA adversary — prove the developer wrong. RED tests in `test/pipelines-adversarial.test.ts`
(`.skip`, marked `// ADVERSARIAL`, each proven to fail when un-skipped). Read-only vs live demo.

Worktree note: run off the checked-out HEAD (`7ea13b8`), not literally wave2 HEAD — findings are on
code present in both.

## Axes attacked

- **Lifecycle** × consumer: draft / in_review / published / deprecated / archived × chat / agent / app / public-API
- **Gateway binding**: bound / unbound / (deleted-gateway — see coverage)
- **Governance overlay**: policy / guardrail / eval / drift present-vs-absent
- **Contract enforcement**: data-ceiling (`enforceDataAccess`) × egress leash (`enforceModelCall`) × local-model
- **API provisioning**: key mint / call / cross-org / wrong-pipeline
- **Org-scoping** × role (viewer / writer / admin)

## Confirmed breaks

### G-ADV-PIPE-1 — LOCAL egress leash does NOT enforce a local MODEL (cloud-model leak) — HIGH
- **Repro:** `buildRunPlan(verdict{egress:'local',forceLocal:true}, leashModel=null, pipelineDefault='gpt-4o')`
  → `{ model:'gpt-4o', forceLocal:true, egress:'local' }`.
- **Root cause:** `src/lib/pipeline-run-plan.ts:70` `buildRunPlan` / `:50` `chooseModel` — the model is
  chosen by string precedence (leash model → pipeline defaultModel → platform default) and is NEVER
  classified local-vs-cloud. `forceLocal` is decoupled from the model choice. `pipeline-execute-wiring.ts:61`
  only adds an advisory `metadata:{data_class:'pii',egress:'local'}` HINT to the gateway body — it does not
  force a local model. The gateway (on-prem LiteLLM) is trusted to honour the hint; the console does not
  enforce it.
- **User-visible break:** a pipeline leashed to `local` for a PII data-class, whose routing rule pins no
  explicit local model and whose `defaultModel` is a cloud model, sends the raw prompt to a CLOUD model
  while the API response + audit report `egress:'local'`. Directly contradicts the module's own docstring
  ("the executor never reaches a cloud model", `pipeline-run-plan.ts:12`).
- **Fix direction:** classify the resolved model's egress (a local-model registry / gateway node kind) and,
  under `forceLocal`, either force a local model or refuse (`block`) — never silently plan a cloud model.

### G-ADV-PIPE-2 — DEPRECATED / ARCHIVED bound pipeline STILL governs consumer runs — HIGH
- **Repro (DB):** create a pipeline, `updatePipeline(status:'deprecated')`, then `resolveContract(id, org)`
  returns a full NON-NULL enforceable contract.
- **Root cause:** `src/lib/pipeline-contract.ts:32` `resolveContract` calls `getPipeline(id, orgId)`
  (`src/lib/pipelines.ts:279` — filters only id+org, no status) and builds a contract regardless of
  lifecycle status. `src/lib/pipeline-run-glue.ts:32/71` (`resolveAgentBinding`/`resolveChatBinding`) and the
  app-run route (`admin/apps/[id]/run/route.ts:96`), trigger route, inbound-email route never check status.
- **User-visible break:** `pipeline-lifecycle-model.ts:110/143` deprecate hint PROMISES "consumers fall back
  to the org default" — but a deprecated/archived pipeline keeps enforcing its (possibly stale/looser)
  contract on chat/agent/app runs. The promised fallback never happens. An operator who deprecates a
  pipeline believing consumers now revert to the org default is wrong.
- **Asymmetry:** the PUBLIC provisioned API (`api/v1/pipeline/[id]/run/route.ts:64`) DOES gate
  `status !== 'published'` → 409; the internal consumer paths do NOT. Lifecycle enforcement is inconsistent
  across consumer types.

### G-ADV-PIPE-3 — DRAFT / IN_REVIEW pipeline governs+runs on internal consumers (release-gate bypass) — MEDIUM/HIGH
- **Repro (DB):** create a pipeline (defaults to `draft`, never published, gate never run), then
  `resolveContract(id, org)` returns a full enforceable/runnable contract.
- **Root cause:** same as G-ADV-PIPE-2 — no lifecycle-status gate in `resolveContract` / consumer resolvers.
- **User-visible break:** M1's release gate (publish only if evals pass) + the public route's `published`
  check are bypassed for chat/agent/app consumers. An app bound to a still-in-draft pipeline runs its
  un-approved, un-gate-passed contract live. Governance is applied from a config that was never signed off.

## SOLID / DRY / SoC observations

- **DRY (positive):** contract enforcement is genuinely one seam — `enforceDataAccess`/`enforceModelCall`
  (pure, `pipeline-enforcement.ts`) are reused by chat, agent (`agentrun.ts`), app (`app-run.ts`),
  public API (`pipeline/[id]/run`), email-sink (`email-sink-governance.ts`) and both worker activities.
  No `type===` consumer switch on the enforcement decision. Good.
- **SoC gap (the actual defect surface):** LIFECYCLE STATUS is enforced in exactly ONE place (inline in the
  public run route, `route.ts:64`) instead of living in the shared resolver seam (`resolveContract`) that
  ALL consumers share. Because the status gate wasn't put on the DRY seam, the four internal consumer paths
  silently skip it (G-ADV-PIPE-2/3). The fix belongs in `resolveContract` (or a pure `isConsumable(status)`
  rule the resolver + route both call), not duplicated per route.

## Reviewed & OK (no break found)

- **Provisioned-key auth / cross-org / wrong-pipeline:** SOLID. `verifyPipelineKey` (`pipeline-api-keys.ts:178`)
  is a SHA-256 hash lookup (shape never authenticates), returns the key row's own `orgId`; the run route
  rejects `binding.pipelineId !== id` (403) and scopes `getPipeline(id, binding.orgId)`. The mint route
  (`keys/route.ts`) verifies `getPipeline(id, currentOrgId())` before minting and takes org from the
  session, never the client — no cross-org mint or call.
- **Public API data-ceiling:** the public executor is a direct completion (no retrieval/data read), so
  `enforceDataAccess` correctly does not apply there; the data ceiling is enforced where reads happen
  (chat RAG, agent retrieval, app data step) via `enforceDataAccess`. Not a bug.
- **Egress overlay tightening:** `enforceModelCall` correctly demotes egress by the policy `maxEgress`
  ceiling (least-permissive-wins) and a `block` verdict denies (403). The DECISION is sound — the gap is
  the MODEL choice (G-ADV-PIPE-1), not the egress verdict.

## Coverage ledger

| Intersection | Status | Note |
|---|---|---|
| published pipeline × public API | ✓ | status gate + full contract enforce |
| draft/in_review × public API | ✓ | 409 (route.ts:64) |
| deprecated/archived × public API | ✓ | 409 |
| published × chat/agent/app | ✓ | enforced via shared seam |
| **deprecated/archived × chat/agent/app** | ❌ | G-ADV-PIPE-2 — still governs, no org-default fallback |
| **draft/in_review × chat/agent/app** | ❌ | G-ADV-PIPE-3 — runs un-gate-passed |
| local egress leash × model choice | ❌ | G-ADV-PIPE-1 — cloud model under local leash |
| data-ceiling × chat/agent/app | ✓ | enforceDataAccess on all read paths |
| provisioned key × cross-org / wrong-pipeline | ✓ | hash auth + org+id gates |
| deleted GATEWAY × bound pipeline (run) | ⚠️ | not exercised — gateway echoed as metadata only; executor calls `GATEWAY_URL` env, not the bound gateway's URL. Worth a follow-up: does a bound-then-deleted gateway change routing at all, or is the binding cosmetic? |
| concurrent edit vs publish/deprecate | ⚠️ | not exercised (version bump is last-write-wins; no optimistic lock observed) |
| role viewer/writer vs lifecycle transition | ⚠️ | pure `allowedTransitions` RBAC is sound; live route-level role gating not re-probed this pass |

Legend: ✓ verified safe · ❌ confirmed break (RED test) · ⚠️ untested / open question (logged as gap).
