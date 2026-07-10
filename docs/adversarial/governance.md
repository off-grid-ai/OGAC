# Adversarial hunt — Governance / Guardrails / PII

QA adversary sweep of the CORE product promise: policy, LLM-Guard guardrails, PII
detection/masking, provenance, audit. Worktree off wave2 HEAD. READ-ONLY vs the live demo; all
mutation attacks are LOCAL RED tests. Do NOT fix — identify, prove, log.

RED tests: `test/adversarial-governance-failopen.test.ts` (`.skip` + `G-ADV-GOV-*` refs). Each was
verified to FAIL when un-skipped (captures a real break, not a tautology) and to SKIP in the suite.

---

## Axes exercised

| axis | values probed |
|---|---|
| guardrail type | injection, PII/DLP |
| direction | inbound, outbound |
| engine state | up, configured-but-down (fail-closed seam), **thrown error** |
| verdict | allow, block, redact |
| enforcement path | chat, agent-run, app-run, pipeline-execute, prompts-playground |
| provenance | signed, tampered, key-mismatch |
| audit | emitted, **dropped** |

## Journeys walked

1. **chat/stream** → `runInboundGuardrails().catch(()=>null)` → block/redact decision → model call → stream → `runOutboundGuardrails().catch(()=>[])`.
2. **agent-run** (`agentrun.ts`) → mandatory `runChecks('pre')` step-2 → `outcomeFromChecks==='blocked'` refuse.
3. **app-run** (`app-run.ts`) → step dispatch; guardrail is an OPTIONAL step; PII-mask branch `try/catch` sends unmasked on detector outage.
4. **pipeline-execute** (`pipeline-execute.ts`) → mandatory `runGuardrail('pre')` → blocked refuse; PII-mask branch same fail-open-to-unmasked pattern.
5. **provenance verify** (`provenance-ops.ts` + `provenance-verify.ts`) → rebuild signed payload → `signing.verify` → tamper classification.

## The guardrail seam (context for the verdicts)

`adapters/guardrail-provider.ts` is DESIGNED fail-closed: LLM Guard configured-but-unreachable →
`scan()` catches its own network error and returns `{ blocked:true }` (it does NOT throw). So under
the intended failure mode, `runChecks('pre')` returns a `blocked` verdict and every mandatory-floor
path (agent, pipeline) correctly denies the run. **The break is on the paths that wrap the whole
call in a swallowing `.catch`, which defeats fail-closed for any *thrown* error that does escape.**

---

## Ledger

| id | severity | flow | break | file:line | proof |
|---|---|---|---|---|---|
| G-ADV-GOV-1 | HIGH | chat inbound guardrail | **FAILS OPEN on a thrown engine error.** `.catch(() => null)` → `inbound===null` → `inbound?.blocked` falsy (injection block bypassed) AND `inbound?.text ?? content` → RAW prompt (incl. unredacted PAN) sent to the model. | `src/app/api/v1/chat/stream/route.ts:156` (+158, 182) | RED test G-ADV-GOV-1 |
| G-ADV-GOV-2 | MED | chat outbound guardrail | Verdicts silently **DROPPED to `[]`** on engine error → run/audit record reads as a clean outbound screen that never ran. (Compounded: tokens already streamed before this scan, so chat egress DLP is observational-only.) | `src/app/api/v1/chat/stream/route.ts:677` | RED test G-ADV-GOV-2 |
| G-ADV-GOV-3 | LOW/SoC | app-run inbound floor | **No MANDATORY guardrail floor.** The `guardrail` step is OPTIONAL (only fires if the app author adds it); injection/PII screening on the app boundary exists only transitively via a nested `runAgent` step. A `connector-query → output` (or inline-model) app can carry the untrusted app `input` without an injection screen — inconsistent with the agent/pipeline paths, which screen every run. | `src/lib/app-run.ts:399-434` (dispatch; no floor) | code-read; consistency gap |
| G-ADV-GOV-4 | LOW | app-run + pipeline PII mask | PII-mask branch is `try { … } catch { /* send unmasked */ }` — a detector *throw* sends the prompt to the model **unmasked** (comment: "leash guarantees still hold"). Distinct from the seam's fail-closed block: the masking substitution is best-effort by design, so an escaping throw = raw PII to the (local) model. | `src/lib/app-run.ts:503-504`, `src/lib/pipeline-execute.ts:201-203` | code-read |

## Verified SOUND (attacked, held)

- **Fail-closed block (engine down, not thrown).** `guardrail-provider.ts` returns `{blocked:true}`;
  `piiVerdict` maps it to `'blocked'`; `outcomeFromChecks` → `'blocked'`; agent/pipeline paths refuse.
  Killing the engine does NOT bypass the mandatory-floor paths. (`checks.ts:57-77`, `agentrun.ts:531`, `pipeline-execute.ts:171`.)
- **Provenance tamper detection.** `rebuildRunPayload` reconstructs the EXACT signed shape
  (`{runId, agentId, query, answer, refs}`, order-matched to `agentrun.ts:741`); `provenanceRef === runId`
  (`correlation.ts:76`), so a tampered `answer`/`query`/`refs` changes the HMAC and `verify` returns
  false → `classifyVerification` → `'tampered'`. `timingSafeEqual` with a length pre-check. Held.
- **Provenance verify is org-scoped** (`getAgentRun(runId, orgId)`) — not a cross-tenant IDOR.

## Root cause (DRY)

G-ADV-GOV-1/-2 are the SAME defect the task flagged: guardrail invocation is duplicated per run-path
and the chat copy alone wraps the call in a swallowing `.catch`. The agent + pipeline paths do NOT
swallow (they let a throw propagate → run errors = fail-closed). The DRY fix is ONE enforced
guardrail seam whose contract is "a failed screen is a BLOCK, never null/[]" — so no caller can
re-introduce fail-open by choosing its own `.catch` default. Un-skip the RED tests after that lands.

## Repro (headline, G-ADV-GOV-1)

1. Configure `OFFGRID_HTTP_GUARDRAIL_URL` so the engine is "configured".
2. Make the pre path THROW (not the seam's caught network error) — e.g. a recognizer-config load or
   `applyPiiEscalation` that escapes on the masking branch (`chat-run.ts:135-142`).
3. POST a chat turn with an injection + PII prompt (`ignore all previous instructions … PAN ABCDE1234F`).
4. Observe: no `pipeline.guardrail.block` audit, no redaction; the raw prompt reaches the model.
   Expected: hard refusal (block) or at least a fail-closed error — never a clean allow.
