# `roadmap-real.md` — audit against the live console

**What this is.** `docs/roadmap-real.md` is the product definition: what OGAC is, the ten-year vision, the
nine user flows, the non-negotiables, the technical table stakes. It is a *specification*, not a task list —
"accomplish everything here" is a multi-quarter program covering deployment topologies, a marketplace, and
partner ecosystems.

This file is the bridge: every CHECKABLE requirement in that document, mapped to a gate, so work is chosen
against evidence rather than against a reading of the spec.

> **THIS FILE IS THE PROGRESS LOG.** Founder instruction 2026-07-30: keep it updated so what has changed and
> what has not is always visible. `docs/roadmap-real.md` stays the untouched SPECIFICATION; every gate, every
> promotion and every dated finding lands here. The Progress log is at the bottom.

## OUT OF SCOPE (founder, 2026-07-30) — "we'll tackle later"

Explicitly descoped until the founder says otherwise. **Do not work these, and do not count them as gaps:**

- **§8A Organizational intelligence / the "organizational brain"** — the permissioned intelligence graph.
  Its ENTITIES exist and are individually gated below; the graph itself is deferred.
- **OGAM / OGAD node sync** — §5 Layer 2 (intelligence at the node) and **Flow 9** (node intelligence
  contribution) in their entirety. These live in the `mobile` / `desktop` repos anyway.
- **B1.4** in `HERO_CLAIMS.md` ("nothing private ever leaves the device") depends on the same capture
  boundary, so it is parked with them rather than counted against the console.

Everything else in the specification remains in scope.

**Gates** (same discipline as `HERO_CLAIMS.md`, which this complements):

| Gate | Means |
|---|---|
| ✅ **VERIFIED** | Exercised on the live box this session and the artifact was read. Evidence in the row. |
| 🔶 **WIRED** | Code exists and is reachable; nobody has run it end to end. |
| 🔴 **GAP** | Missing, broken, or overclaimed. |
| ❓ **UNVERIFIED** | Not exercised. **Treat as unknown, not as broken.** |

**Why ❓ is a first-class gate here.** Five of seven rows in the older ledger turned out stale or
misdiagnosed, and three of my own diagnoses needed correcting mid-session. A row nobody has run is not
evidence of a gap; it is an absence of evidence. Reproduce before building — it changed what got built every
single time.

---

## The nine user flows (§10) — the concrete, checkable core

### Flow 3: Create an application in natural language
The wedge, and the strongest evidence we have.

| Step | Gate | Evidence |
|---|---|---|
| Describe the goal | ✅ | `POST /api/v1/admin/apps/compile` on a plain sentence |
| OGAC asks clarifying questions | ✅ | `compile-clarify.ts` derives questions from facts about the spec (unbound read, limit with no number, "approve" with no human step), returned by the compile API and ASKED as a turn in the Forge conversation. Verified live: an ambiguous brief returned `You described "large" — what value is the cut-off?`; a fully specified one returned none |
| Identifies available data, tools, policies | ✅ | Binds `expense claims` not the insurer's `claims` (`phrase-qualifier.ts`); inserts a missing quota read and *reports* it |
| Proposes a workflow | ✅ | 5-step spec: 2 reads → agent → human → output |
| User reviews the plain-language plan | 🔶 | Spec + gaps render; nobody has watched a non-technical person read it |
| Generates the app and tests | 🔶 | App generated (`app_5803e04b`); **test generation not verified** |
| User tests with examples | ✅ | Case picker offered 11 real open claims |
| User corrects failures | ❓ | Editing an app re-syncs the agent prompt (fixed earlier); the loop is unexercised |
| Generates/updates evaluations | 🔶 | **Evals RUN with real results** (swept live 2026-07-30): `GET /api/v1/admin/evals` → 25 runs, 71 cases, 60 passed / 11 failed, 85% pass. Two suites: `golden` 87% over 69 cases, and **`ragas` 0/2 passing — scores 37 and 39, last run 2026-07-21**. So evaluation is real and one suite is failing badly; what remains unverified is AUTO-generation of evals from a compiled app |
| Submitted for approval / published | 🔶 | Publish + template paths exist; not run end to end |

### Flow 5: Use an application
| Step | Gate | Evidence |
|---|---|---|
| Opens app, loads role-specific context | ✅ | Per-app access + ABAC gate on run; retrieval ACL by asker |
| Employee submits task | ✅ | Case picker → `POST …/run` |
| Pipeline runs | ✅ | Run `apprun_2da37694`, steps executed in order |
| Human approval requested if necessary | ✅ | Reached `awaiting_human` at "Manager Approval" |
| Result returned **with citations** | 🔶 | Answer cites the source row (`id:11 in employee_quota`); inline citation *rendering* on this surface unverified |
| Run is recorded | ✅ | `app_runs` row + audit ledger + signed provenance |
| Feedback is collected | ❓ | Feedback surface exists; not exercised |

### Flow 6: Review and approve
| Step | Gate | Evidence |
|---|---|---|
| Reviewer sees pending item | ✅ | Run pauses; review surface inlines at the human step |
| Understands the action and evidence | ✅ | Step outputs render as tables with the source's own column names humanised (`annual_quota` → "Annual quota"); one shared `StepEvidence` component so the step list and the review panel cannot drift. Verified live: 0 raw JSON payloads on the page |
| Sees risk and confidence | ✅ | `review-risk.ts` — LEVELS WITH REASONS, never a percentage (every input is a discrete fact, so a score would invent precision). Verified live: `RISK MEDIUM — Approving runs the remaining steps, including Send Decision Report. This decision covers 41,346.44.` / `CONFIDENCE HIGH — All 2 sources were read and narrowed to this case.` |
| Approves / edits / rejects / escalates | 🔶 | Approve + reject verified earlier; **edit and escalate unverified** |
| Decision is logged | ✅ | Audit ledger + run history |
| Feedback enters the evaluation system | ❓ | Not exercised |

### Flow 7: Investigate failure
| Step | Gate | Evidence |
|---|---|---|
| Alert shows failed or degraded run | 🔶 | Runs list shows status; alerting path unverified |
| Operator opens execution trace | ✅ | Per-step detail with status + timing |
| Sees data, model, prompt, tool, policy, evaluation stages | 🔶 | Data/model/policy ✅. **Prompt ✅ 2026-07-30** — read from the child agent run so it is the text actually sent (post-masking, post-source-folding), collapsed behind a disclosure with its character count. Verified live on `apprun_76864dd2`: present after a poll cycle, containing the case subject and the folded source rows. **Evaluation stages remain absent** — eval runs now retain per-case evidence (fixed earlier today), so surfacing it here is the follow-on |
| Identifies the failure | ✅ | Failures name their cause, never present as emptiness (`connector-failure.ts`) |
| Compares with previous versions | 🔶 | **Swept live 2026-07-30 — split by entity.** PIPELINES have real version history: `GET /api/v1/admin/pipelines/{id}/versions` → append-only rows with a full `snapshot` per version (verified on `pl_9138b148-290`, v1 `note:"created"`), so comparison is possible there. **APPS have no versions at all** — no `apps/{id}/versions` route and no app-versions table — and an app run is what an operator is usually investigating. That is the gap: version the app, not just the pipeline |
| Fixes and tests | 🔶 | An app's steps and prompts are editable (`updateApp` re-syncs the materialized agent), and a run can be re-run from the original input (`app-runs/[id]/workflow` rerun). The fix→test→compare loop has not been walked as one sequence |
| Rolls out or rolls back | 🔶 | `POST /api/v1/admin/pipelines/{id}/rollback` exists for pipelines. Nothing rolls an APP back, which follows from apps having no versions — same root cause as step 5 |

### Flow 8: Compliance export
| Step | Gate | Evidence |
|---|---|---|
| Select regulation / period / app / incident | 🔶 | Regulatory + evidence-pack surfaces exist |
| Collects runs, policies, approvals, versions, sources, evaluations | 🔶 | `readComplianceActivity` reads the real ledger |
| Generates evidence pack | 🔶 | Exists (B4.11); never generated end to end |
| **Export is signed** | ✅ | Ed25519 verified on a fresh run, and tamper-evident: mutating the record flips the verdict to `tampered` |

### Flows 1, 2, 4, 9
| Flow | Gate | Note |
|---|---|---|
| 1 — Enterprise setup | ❓ | Two tenants exist and work, but nobody has timed a cold setup. The doc's bar is "hours, not months" — that is a measurable claim and it is unmeasured |
| 2 — Connect a data source | 🔶 | Connectors, classification, lineage all exist; the ten-step flow has not been walked as a flow. Sub-step **"test retrieval"** is ✅ (six demo connectors probed live) |
| 4 — Build from a template | 🔶 | Templates + publish exist; adoption never watched (B3.6) |
| 9 — Node intelligence contribution | ⏸ | **OUT OF SCOPE** (founder, 2026-07-30). Also `mobile` / `desktop`, not the console |

---

## Non-negotiables (§11)

| Requirement | Gate | Evidence / what is missing |
|---|---|---|
| **Governance is inherited** — not per-builder | ✅ | A compiled app inherited the data allowlist, PII masking, guardrails and egress leash without the author asking. This is the single best-evidenced claim in the product |
| **Security by enforcement**, not warnings | ✅ | Data ceiling denies before the connector is hit; guardrails fail closed; masking blocks rather than falling open |
| **Human control for consequential actions** | 🔶 | Approval + rejection verified; **escalation, override and reversal are not** |
| **Full observability** — no invisible behavior | 🔶 | Every step records; per-entity OBSERVE closed earlier. **Prompt-level detail is absent from the trace** |
| **Model neutrality** | ✅ | Local + cloud behind one gateway; routing by policy; five models attributed in FinOps |
| **Raw data can remain local** | 🔶 | On-prem throughout, egress leash enforced. The capture-boundary artifact (B1.4) is the unproven half |
| **Honest product state** — the UI distinguishes production / experimental / degraded / not configured / failed open / failed closed / awaiting approval | 🔶 | Strong in places, and **improved this session**: a data-quality 400 now reads "the engine rejected the request" instead of "unreachable"; a read that fails can never present as "no rows"; an unscoped read says so. **But there is no consistent vocabulary for these seven states across surfaces** — each one was fixed individually. That is the gap |
| **Enterprise reliability** — a failed component must not silently corrupt a process | ✅ | A failed read halts the run and audits `pipeline.data.unavailable`; no decision is made on unread data |
| **Customer controls deployment/data/models/policies/access/retention/egress/audit/deletion** | 🔶 | All nine surfaces exist; RTBF/deletion and retention are the least exercised |

---

## What to work next, in order

**Done 2026-07-30** (all verified on the live box, not merely merged): Flow 6's evidence rendering, Flow 6's
risk-and-confidence step, and Flow 3's clarifying questions — pure rule → API → the surface the user is
already on. Two route-level bugs surfaced while proving them: the compile route dropped `questions`, and the
evidence renderer had already been duplicated across two review surfaces within a single commit.

1. **Prompt + evaluation stages on the trace** (Flow 7, and the observability non-negotiable). The trace
   shows data, model and policy; the prompt that produced an answer is absent, which is the one thing an
   operator investigating a bad answer most needs.
2. **One consistent honest-state vocabulary** across surfaces. The doc names seven states; we fixed several
   individually this session (a 400 no longer reads as an outage; a failed read cannot read as "no rows"; an
   unscoped read says so). Seven ad-hoc fixes IS the gap — one vocabulary, applied everywhere.
3. **Time a cold enterprise setup** (Flow 1). The doc's own bar is "hours, not months" and it is unmeasured.
   Cheap to measure, and unmeasurable claims are how the older ledger drifted.
4. **Walk Flow 2 as a flow** — every step exists; nobody has done the ten in sequence.
5. **Reconcile gateway keys with console key rows** (B4.10) — per-subject spend is live; budgets sit on
   objects the traffic never names.
6. **The ❓ sweep.** Everything marked UNVERIFIED above. On this session's record roughly half of what looks
   broken is already working, so this is cheaper than it looks and reorders everything below it.
7. **🔴 EVAL RUNS RECORD A SCORE BUT NOT THE EVIDENCE — 64 of 84.** Chased the `ragas` 0/2 failure into
   something much larger. Per-case `results` are empty on most runs:

   | engine | runs | runs with NO per-case results |
   |---|---|---|
   | `golden` | 64 | 54 |
   | `ragas` | 12 | 3 |
   | `faithfulness:ragas` | 4 | 4 |
   | `faithfulness:heuristic` | 3 | 3 |
   | `geval` | 1 | 0 |

   So the Quality surface shows pass rates nobody can drill into, and the newest ragas run
   (`ragas_mrub4g7g`, score 39, 0/1 passed) records nothing about WHAT failed. This breaks two things the
   document treats as non-negotiable: **"Full observability — no invisible behavior. Every important action
   must leave an understandable record"**, and Flow 7's *"operator sees data, model, prompt, tool, policy and
   evaluation stages"*. A score with no cases behind it is the same defect class as "3/3 expectations passed"
   with no rule names — fixed for data quality earlier today, still open here.

   `geval` at 1/1 populated shows the write path CAN carry results, so this is a per-engine omission rather
   than a missing feature. Start there.

**A warning about how to run the sweep, learned by getting it wrong.** My first pass probed five endpoints and
four returned 404 — because I TYPED the route names from what the surfaces are called (`/evidence-packs`,
`/feedback`, `/compliance/activity`, `/apps/[id]/versions`). None of those exist; the real ones are
`/api/v1/admin/compliance/{activity,controls,export,frameworks}` and `/api/v1/admin/eval-defs`. Those 404s are
evidence of nothing except my guessing, and recording them as gaps would have manufactured four fake defects —
exactly the `/solutions/apps/[id]/safety` mistake already documented in `ROADMAP.md`. **Enumerate routes from
`src/app/api` before probing them.**

Everything marked ❓ is a candidate for a verification sweep before any of it is built. On this session's
record, roughly half of what looks broken is already working.

---

## A recurring defect class in this codebase: the dropped field at a boundary

Four instances in one session, each a layer that HAD the data and a boundary that discarded it:

| Surface | The layer had | The boundary dropped it | Symptom |
|---|---|---|---|
| App runs | the picked case record | `POST …/apps/[id]/run` read only `body.input` | every case filter silently inert; reads returned other people's rows |
| Data quality | the requested expectations | the verdict synthesized `passed_expectation_1/2/3` | a green gate could not name what it checked |
| FinOps | the gateway's `caller` | `gatewayEvents()` hardcoded `keyId: null` | `byKey` 0 for every key against real spend; budgets unconsumable |
| Evals | the per-sample metrics | `persistRun()` stored only the rollup | 64 of 84 runs: a score with no evidence |
| Compile | the clarifying questions | the route destructured `{ spec, gaps }` | API returned none while the compiler produced three |

**Every one passed typecheck and the full test suite.** They are invisible to both because each side is
internally correct — the producer produces, the consumer consumes what it is given, and nothing asserts that
what crossed between them is what was produced.

**Not mechanically detectable.** A scan for "INSERTs a score without a detail column" finds nothing useful
here: two of the five were not persistence at all but a reader and a route, and the scan's hits
(`user-invites`, `erasure-tombstone-store`) are benign — an invite's `status` needs no evidence. Grep cannot
see a field that is absent.

**What did catch all five:** exercising the real path end to end and comparing what the surface shows against
what the layer beneath produced. Concretely — run it live, then read the stored row or the API response and
ask "is everything the producer computed actually here?". That is the only check that has worked, and it
worked five times.

**Cheapest durable guard:** a test at each boundary asserting the crossing, not the sides. **All five now
have one** — applied rather than left as advice:

| Boundary | The crossing now asserted |
|---|---|
| App runs | picker record → `runInputWithCase` → `resolveStepParams` BINDS, for every scalar field |
| Data quality | every REQUESTED rule is accounted for by name; `passed + failed` equals what was asked |
| FinOps | `bySubject` requests and tokens sum to `totals` (this is what proved that fix) |
| Evals | one stored result per scored sample; pass counts agree; every row names its metric and engine |
| Compile | `questions` survive the JSON round-trip a route performs |

Each fails loudly if its boundary regresses, and each is on the specific thing that actually broke rather than
a general "does it work" test — which is why the originals all passed while the product was wrong.
---

## §12 Technical table stakes — audited and gated

Eleven headed groups, ~150 items. **What this audit is and is not:** every row below is gated from either
(a) live evidence produced this session or already in the capability map, or (b) presence in the router /
`src/lib`, established by enumerating code rather than guessing names. It is NOT a live exercise of 150
items — that is weeks of work, and claiming it would be the inflation this file exists to prevent. So a
🔶 here means "the code is there and named honestly", and ❓ means **unknown, not broken**.

**Naming check, because it changed six answers.** A first pass by literal term reported zero hits for
circuit-breaker, dead-letter, key-rotation, A/B testing, schema-evolution and risk-classification. Five of
those six exist under different names (`breaker`/`halfOpen`, `dlq`, `rotateSigningKey`, `variant`/`experiment`,
`migrat*`). Only **risk classification** is genuinely absent under any spelling. Recording the five as gaps
would have manufactured five fake defects — the same trap as the four invented 404 URLs earlier today.

### Deployment
| Item | Gate | Note |
|---|---|---|
| Customer data center · private cloud | ✅ | The whole product runs on-prem; this session deployed to it ~15 times |
| Docker / compose | ✅ | `deploy/docker-compose*.yml`, `deploy/Makefile` |
| Environment separation | 🔶 | `.env.local` / `.env.production` on the box; no promotion pipeline |
| Infrastructure-as-code | 🔶 | Compose + scripts; fleet orchestration lives in the private repo |
| Kubernetes | ❓ | Not exercised here |
| Customer cloud · hybrid · air-gapped | ❓ | Architecturally implied by on-prem-first; never run |
| Backup and restore · disaster recovery | ❓ | **The most consequential ❓ in this section** — an enterprise buyer asks early and it is untested |

### Identity and access
| Item | Gate | Note |
|---|---|---|
| SSO · OIDC | ✅ | Keycloak live; OpenSearch OIDC cutover done earlier |
| RBAC | ✅ | Team membership + role gates pipeline lifecycle, verified live |
| ABAC | ✅ | Enforced on the app-run path (OPA adapter live) |
| Service accounts · API keys | ✅ | Bearer admin token + virtual keys; used throughout this session |
| Fine-grained permissions | ✅ | Per-app access + retrieval ACL by asker |
| SAML · SCIM | 🔶 | Referenced in code; provisioning never exercised |
| Break-glass access | 🔶 | Present in code |
| Temporary credentials | ✅ | OpenBao dynamic DB creds proven live (issue/auth/revoke) |
| Separation of duties | 🔶 | Maker-checker exists on actions; not audited as a duty split |

### Security
| Item | Gate | Note |
|---|---|---|
| Tenant isolation | ✅ | Cross-org RAG leak closed and covered by a regression test |
| Secret management | ✅ | OpenBao KV v2 lifecycle proven live |
| PII detection and masking | ✅ | Fail-closed; **and value-stable pseudonyms added today** so masked data stays joinable |
| Egress control | ✅ | Egress leash enforced before the model call |
| Audit logging | ✅ | `audit_events_v2` is the canonical ledger; every enforcement writes to it |
| DLP | ✅ | Cloud-response DLP proven live (capability map) |
| Rate limiting | ✅ | 60 req/min per IP on `/api/*` |
| Encryption in transit | ✅ | Cloudflare tunnel + TLS at the edge |
| Key rotation | 🔶 | `rotateSigningKey` exists; rotation never exercised end to end |
| Prompt-injection defense · tool sandboxing | 🔶 | Guardrail scanners + sandbox concepts present |
| SIEM integration | ✅ | OpenSearch audit index + alerting monitors |
| Encryption at rest · vulnerability / dependency / container scanning · network policies | ❓ | Infra-side; not verified from here |

### Reliability
| Item | Gate | Note |
|---|---|---|
| Durable execution | ✅ | Temporal-backed runs; a paused human step resumes |
| Human approval as a durable pause | ✅ | Proven repeatedly today (`awaiting_human` → resume) |
| Retries · timeouts | ✅ | Present and exercised (connector timeouts, scan timeouts) |
| Graceful degradation | ✅ | Best-effort paths degrade with a named reason rather than failing the run |
| Rollback · version pinning | 🔶 | Pipelines version + roll back (verified live); **apps do not** — the Flow 7 gap |
| Checkpointing · circuit breakers · DLQ | 🔶 | Present under other names (`breaker`, `dlq`) |
| Idempotency | 🔶 | Widely referenced; not asserted by a test |
| Service-health monitoring | ✅ | `npm run smoke` + per-service health endpoints |
| HA · horizontal scaling · SLOs/SLAs | ❓ | Single-box demo deployment; not a scaled test |

### Data
| Item | Gate | Note |
|---|---|---|
| Structured connectors | ✅ | Six demo connectors probed live (mysql, postgres, mssql, s3, kafka, rest) |
| Permission-aware retrieval | ✅ | Retrieval ACL by asker identity |
| Data classification | ✅ | Catalog + classification seeded |
| Lineage · provenance | ✅ | Marquez lineage + Ed25519 run provenance, tamper-evidence proven today |
| Data-quality monitoring | ✅ | Great Expectations live and discriminating (verified today) |
| Incremental sync · CDC | 🔶 | Airbyte/Kestra paths exist; not exercised as sync |
| Retention · deletion | 🔶 | RTBF surface exists; erasure propagation unexercised |
| Schema evolution | 🔶 | Migration paths exist |
| Legal holds · data residency | 🔶 | Referenced; policy-level, unexercised |
| Unstructured connectors | ❓ | — |

### Model operations
| Item | Gate | Note |
|---|---|---|
| Multi-model · local and cloud inference | ✅ | Five models attributed in FinOps; local + cloud behind one gateway |
| Model routing · fallback | ✅ | Policy-driven routing; fallback on unreachable |
| Token and cost tracking | ✅ | 118k tokens / $0.2367 with a real per-model split |
| Structured outputs · tool calling · streaming | ✅ | In use across chat/agents |
| Prompt versioning | ✅ | Prompt registry with versions |
| Model evaluation | ✅ | 25 runs / 71 cases; **per-case evidence now retained** (fixed today) |
| Caching · batch inference | 🔶 | Present |
| A/B testing · canary releases | 🔶 | `variant`/`experiment` concepts exist; no release-gate flow |
| Context management | 🔶 | Implicit in prompt assembly |
| Versioning (models) · rollback | ❓ | Model pinning exists; rollback unexercised |

### Agent operations
| Item | Gate | Note |
|---|---|---|
| Human approval | ✅ | With **risk and confidence** as of today |
| Long-running execution · durable state | ✅ | Durable workflow runs |
| Permissioned tool access | ✅ | Tool permissions enforced |
| Event triggers · scheduling | ✅ | Inbound webhook trigger → governed run proven live; cron schedules exist |
| Budget control | 🔶 | Blast-radius caps enforced at run start; **dollar budgets unconsumable** until keys reconcile (B4.10) |
| Kill switches | ✅ | Per-app disable enforced before any step |
| Maximum-step limits · loop detection | 🔶 | Step caps present |
| Sandboxed tools · delegation · concurrency control | 🔶 | Present |
| Execution replay | 🔶 | Rerun from original input exists; not a true replay |

### Evaluation
| Item | Gate | Note |
|---|---|---|
| Golden datasets · offline evaluations | ✅ | `golden` suite: 87% over 69 cases |
| Faithfulness · groundedness | ✅ | Entailment-grade grounding verified today (paraphrase supported, contradiction refused) |
| Quality thresholds | ✅ | Per-metric thresholds, direction-aware |
| Human review | ✅ | Review decisions logged |
| Drift detection | 🔶 | Drift projects + runs exist |
| Cost · latency as eval dimensions | 🔶 | Tracked, not asserted as eval gates |
| Regression testing · online evaluations | 🔶 | Suites exist; not wired as a gate |
| Business metrics · bias · safety | ❓ | Safety scanners exist; not evaluated as a suite |
| Release gates | 🔴 | Nothing blocks a publish on an eval score — the clearest gap in this group |

### Observability
| Item | Gate | Note |
|---|---|---|
| Per-run timeline | ✅ | Step-by-step with timing |
| End-to-end traces | ✅ | Langfuse-backed, matched on tags |
| Policy decisions | ✅ | Every enforcement audited with its reason |
| Approval history | ✅ | Logged |
| Data lineage | ✅ | Marquez |
| Cost breakdown | ✅ | Per model; **per subject as of today** |
| Quality scores | ✅ | Rolled up per engine and suite |
| Error diagnosis | ✅ | Failures name their cause; **prompt now on the trace** (today) |
| Model and tool spans | 🔶 | Model spans yes; tool spans not separated |
| Logs · metrics | ✅ | Victoria Metrics + service logs |
| Business outcomes | 🔶 | Outcomes surface exists (B4.10 chips unproven) |
| Export to existing tools | 🔶 | OpenSearch/OTel sinks referenced |

### Compliance
| Item | Gate | Note |
|---|---|---|
| Append-only audit trail | ✅ | `audit_events_v2`; tamper-evidence proven on a live run |
| Policy version history | ✅ | Append-only policy versions |
| Human oversight records | ✅ | Approval decisions with actor and reason |
| Model and application inventory | ✅ | Apps, agents, models all enumerable |
| Evidence export | 🔶 | `compliance/export` route exists; never generated end to end |
| Control mapping · regulatory retention | 🔶 | Frameworks surface exists |
| Data-processing records · consent records | 🔶 | Referenced |
| Incident records | 🔶 | Present |
| **Risk classification** | 🔴 | **Absent under any spelling.** The only item in §12 with no implementation at all — and EU-AI-Act-shaped buyers ask for it by name |

### Developer experience
| Item | Gate | Note |
|---|---|---|
| APIs | ✅ | The whole console is API-first; this session drove it entirely by API |
| Webhooks | ✅ | Inbound trigger + outbound egress with signed receipt, both proven live |
| OpenAI-compatible interfaces | ✅ | Gateway is OpenAI-compatible |
| CLI | ✅ | Deploy/verify scripts; `npm run` surface |
| Local development · test environments | ✅ | `next dev` on the box, demo tenants |
| Version control · CI/CD integration | 🔶 | Git-based; pre-push gates exist, no CI pipeline verified |
| Mock data | ✅ | Seeded demo tenants (Indian BFSI) |
| SDKs · connector SDK · extension framework · app packaging | 🔶 | Adapter/port architecture is the extension seam; no published SDK |
| Promotion between environments | 🔴 | No promotion path; single environment |

### What this audit says overall

**Three 🔴 items across ~150** — release gates on eval scores, risk classification, and environment promotion.
That is a genuinely strong table-stakes position, and it is consistent with the pattern all session: the
platform is far more built than its own documents claim, and the defects that matter are **boundaries where a
built capability loses its evidence**, not missing capabilities.

**The most consequential ❓ is backup and restore / disaster recovery.** An enterprise buyer asks in the first
technical call, and it is untested. Cheap to establish, expensive to be wrong about.
---

## §8 Core product areas (A–J) — audited and gated

| Area | Gate | Evidence / what is missing |
|---|---|---|
| **A. Organizational intelligence** — a permissioned graph | ⏸ OUT OF SCOPE | The ENTITIES all exist and are enumerable, and the §8 questions are largely answerable per item: where knowledge came from (lineage ✅), who can access it (retrieval ACL ✅), which decisions used it (run refs ✅), whether a human verified it (approval records ✅), how confident (confidence signal ✅ as of today). What does NOT exist is the GRAPH — nothing traverses "which workflows depend on this knowledge" or "is it still valid". The document's own warning ("this cannot become an unstructured memory dump") is respected by accident rather than by design |
| **B. Data plane** | 🔶 | Schema discovery ✅, classification ✅, permissions mapping ✅, lineage ✅, retrieval ✅, structured querying ✅ (six connectors probed live). Incremental sync 🔶, retention controls 🔶, unstructured querying ❓. Connector BREADTH is the gap against the list: databases/warehouses/S3/Kafka/REST yes; SharePoint, Drive, CRM, ERP, ticketing, email, messaging — not present |
| **C. Governed model gateway** | ✅ | Local, cloud, fallback, cost/latency/data-class routing, rate limits, kill switches, logging, redaction, caching all present; five models attributed live. **The document's acid test — "restricted data may only use models inside the customer's infrastructure … technically enforced, not a warning" — is met**: the egress leash blocks before the model call, verified live |
| **D. Pipelines** | ✅ | A pipeline binds data, retrieval, models, prompts, tools, policies, guardrails, approvals, cost limits, monitoring; **versioned** (append-only snapshots, verified live) **and inherited** — a compiled app inherited the allowlist, masking, guardrails and leash without its author asking. This is the best-evidenced area in §8 |
| **E. Studio** | 🔶 | Describe an outcome ✅, review the generated workflow ✅, test against real cases ✅, add human review ✅, clarifying questions ✅ (today). The node graph is correctly SECONDARY. Missing: upload examples, add business rules as first-class objects, and "explain what it is building in business language" is partial — the plan renders, but nobody has watched a non-technical person read it |
| **F. Apps and agents** | 🔶 | Apps: review queues ✅, background workflows ✅, scheduled jobs ✅, API access ✅, forms 🔶, conversational ✅, dashboards 🔶, batch 🔶, case management 🔶, mobile ❓. Agents: tool use ✅, approval ✅, structured outputs ✅, deterministic steps ✅, long-running ✅, retry/timeout ✅, memory 🔶, delegation 🔶, **human escalation 🔴** (approve/reject exist; escalate does not) |
| **G. Human review** | 🔶 | The document lists seven things the review experience must show. Now: what the system wants to do ✅, why ✅, which sources ✅ (readable tables, today), what uncertainty remains ✅ (confidence, today), what happens after approval ✅ (risk names the pending steps, today). **Missing: what policy applies** (enforced but not shown at the review point) and **what happens after rejection**. Approver actions: approve ✅, reject ✅, add a reason ✅; **edit 🔶, ask for more information 🔴, reassign 🔴, escalate 🔴**. "That reason should feed future evaluation" — 🔴, the loop is not closed |
| **H. Evaluation and AI quality** | 🔶 | Golden datasets ✅, faithfulness ✅, groundedness ✅, human feedback ✅, drift 🔶, regression 🔶, safety 🔶, business-quality metrics 🔴, prompt-degradation detection 🔴, model comparison 🔶. Quality is visible by application/model/engine/time ✅ — but **not by team or by version**, both of which the document names |
| **I. Governance and compliance** | ✅ | RBAC ✅ ABAC ✅ classifications ✅ model policies ✅ tool permissions ✅ egress ✅ approval policies ✅ audit ✅ policy versioning ✅. Retention 🔶, consent 🔶, regional controls 🔶. Against "every important run should be": identifiable ✅ cited ✅ signed ✅ attributable ✅ versioned 🔶 (pipeline yes, app no) reproducible 🔶 **reversible 🔴** |
| **J. Observability and FinOps** | 🔶 | Who/what/which data/which models/what failed/what was blocked/what quality — all ✅. What each run costs ✅. **Business outcome produced 🔴.** FinOps: budgets 🔶 (unconsumable until keys reconcile), cost allocation ✅ per subject (today), model comparison ✅, **cost per workflow 🔴, cost per successful outcome 🔴, chargeback/showback 🔴** |

**Read:** C and D are done and well-evidenced. **G (human review) is the weakest area in §8** — three of the seven required disclosures and four of the seven approver actions are missing, and it is the surface a regulated buyer inspects hardest.

---

## §9 Critical UX principles — audited and gated

| Principle | Gate | Assessment |
|---|---|---|
| **Outcome first** | ✅ | The builder opens on "describe what you need", not a model picker. Verified live end to end today |
| **Progressive disclosure** | 🔶 | Prompt ✅ (added today), model ✅, retrieval ✅, policies ✅, logs ✅, versions 🔶, evals 🔶, tools 🔶 — all behind disclosure rather than on the default surface, which is the principle honoured. Gaps are the two 🔶 items not being inspectable at all |
| **Explain every important action** | 🔶 | What happened ✅, why ✅, what information was used ✅, who approved ✅, how certain ✅ (today). **What rule permitted it 🔴** — enforcement is audited but not shown to the person at the point of action. **What should happen next 🔶** — risk names the pending steps, but there is no "next action" affordance |
| **Governance feels native** | 🔶 | Enforcement happens inline and is stated inline (a denied read names the ceiling; a blocked model call names the leash). But of the document's five example sentences, only two have an equivalent on screen. Notably **"this output cannot be published without a citation" 🔴** and **"this workflow failed its quality threshold" 🔴** — the second is the release-gate gap from §12 |
| **Fast path and expert path on ONE object** | ✅ | A compiled app and a hand-wired app are the same `AppSpec`; Studio and the canvas edit the same object. No forked product |
| **Trust through visibility** | 🔶 | Is it running ✅, did it fail ✅, is it waiting for approval ✅, which source did it use ✅, **did data leave the company 🔶** (egress is enforced and audited but not surfaced as a per-run answer), **what will this cost 🔴** — no pre-run cost estimate anywhere, and the document lists it as a question a user should never have to wonder about |

**Read:** the two strongest principles (outcome-first, one object for both paths) are ✅. The recurring miss is **stating the RULE and the COST at the point of action** — both are known internally and neither reaches the person.

---

## §13 Product success metrics — audited and gated

The document opens this section by rejecting the obvious measures: *"OGAC should not be measured by prompts or model calls."* That makes this section a check on whether the product can report on ITSELF.

| Group | Gate | Assessment |
|---|---|---|
| **Adoption** — active employees, teams, applications, apps built by non-technical users, time to first application, time to production | 🔴 | Runs and actors are recorded, so the raw material exists. **Nothing aggregates any of it.** "Apps built by non-technical users" and "time to first application" are not derivable at all — we do not record who built an app or when they started |
| **Business impact** — hours saved, cycle-time reduction, cost per completed process, error reduction, quality improvement, revenue, risks detected, capabilities created | 🔴 | The outcomes surface exists but none of these are computed. Run duration is recorded, so cycle-time is the one within reach; "hours saved" needs a baseline nobody captures |
| **Reuse** — templates reused, pipelines reused, policies reused, shared signals, apps per common capability | 🔴 | Templates and pipelines are reusable and the bindings are recorded, so this is **the cheapest group to close** — it is a query over existing joins, not new instrumentation |
| **Reliability** — successful/failed runs, human escalation rate, policy violation rate, rollback rate, MTTR | 🔶 | Successful/failed runs ✅ and policy violations ✅ are both directly countable from `app_runs` and `audit_events_v2`. Escalation rate 🔴 (escalation does not exist), rollback rate 🔴 (apps cannot roll back), MTTR 🔴 |
| **Quality** — eval scores, human acceptance rate, correction rate, drift, citation accuracy, groundedness | 🔶 | Eval scores ✅ and groundedness ✅ are live. Human acceptance and correction rate are derivable from review decisions (recorded ✅) but **not computed**. Citation accuracy 🔴 |
| **Governance** — % of AI activity through OGAC, % of apps with evaluations, % of consequential actions with required approval, blocked violations, time to generate audit evidence | 🔶 | Blocked violations ✅ countable. The three percentages are all derivable from data we already hold and **none are computed**. "Time required to generate audit evidence" 🔴 — and it is the one a buyer will actually time in the room |

**Read, and this is the most important finding of the §8/§9/§13 pass:** almost every metric in §13 is **derivable from data already recorded** and almost none is **computed**. That is the same defect class as the five boundary bugs — the information exists and is discarded at the last step — but at the level of the product's own scoreboard. It also means this is far cheaper than it looks: the Reuse group and the three Governance percentages are queries over existing joins.

**And it is self-referential in a way worth stating:** the document says the product wins by making an enterprise measurably faster. Right now the product cannot measure that about itself.

---

## Progress log

Newest first. Every entry is live-verified unless it says otherwise.

### 2026-07-30

- **WORKSPACE MODULE SWEEP (10 routes: 7 static, 3 dynamic — all 10 swept).** Founder's method, per the new
  `ui-module-sweep` skill. Fixed and deployed: "All chats" filtered to chats with NO project (so a workspace where
  everything is filed showed "No chats yet"); "All chats" was rendered INSIDE the Projects group as though it were
  a project; the Memory sheet's Input lacked `min-w-0` and pushed its own Add button off-viewport; the workspace
  was empty for the signed-in identity because the data is per-USER and only `demo-bank` had rows; and Prompts was
  empty because I seeded `prompts` when the page reads `prompt_library` (fourth wrong-name guess of the session —
  wrong rows removed, 4 org-visible prompts per tenant now).
  **STILL OPEN — `/work/projects/[id]`: the "Project memory (n)" CardTitle overlaps its own description text**,
  with the title wrapped to three lines in a narrow column. Screenshot evidence in the sweep output. NOT guessed
  at: the markup (CardHeader → CardTitle + p) reads correctly, so the cause is in the computed grid/column layout
  and needs the browser inspected rather than a CSS change fired blind. The same card's input WAS fixed
  (`min-w-0`), which is the second component with that exact defect — worth a repo-wide check for flex rows
  containing an Input.
  **False positives my own sweep produced**, all now guarded or known: fake ids made every detail route look
  "near-empty"; `--module` did not scope the crawl so it swept all 293 routes and timed out; and the
  "engineering vocabulary" flag on `/work/prompts` is a regex over-match — that page is genuinely good.
  **Every flag needs its screenshot read before it counts as a finding.**
  **BUTTONS EXERCISED (the half I first skipped — the founder's "that's the only way").** 4 of 5 pass with an
  OBSERVABLE change asserted, not just a click landing: clicking a conversation loads its transcript; selecting a
  project filters the list; "All chats" restores it; SKILLS opens a picker.
  **🔴 5th: "Add to my prompts" does nothing.** The demo account is READ-ONLY ("cannot make changes"), so the write
  is probably correctly refused — **the defect is that it refuses SILENTLY.** The user clicks, nothing moves, and
  there is no way to tell "you may not do this" from "this is broken". `roadmap-real.md`'s "Honest product state"
  non-negotiable requires the UI to distinguish exactly that. Fix: surface the refusal (a toast naming the
  read-only account), or disable the control with a reason on hover. **Do not "fix" it by allowing the write.**
  **WORKSPACE VERDICT: swept 10/10, 6 defects fixed and deployed, 2 open** (project-memory title overlap; silent
  read-only refusal). Founder confirmed the two chat fixes on screen.

- **🔴 THE WORKSPACE (§8 "Work") IS NOT SEEDED FOR THE DEMO TENANTS — founder-reported, now quantified.**
  *"The entire workspace section has no seed data. It's so difficult to truly understand all of its
  functionality."* Confirmed, and the numbers are the argument:

  | table | total | `default` (dev) | org_bharat | org_suraksha |
  |---|---|---|---|---|
  | `chat_conversations` | 19 | **13** (mac 8, mohammed 5) | **3** | 3 |
  | `chat_projects` | 9 | — | — | — |
  | `chat_messages` | 45 | — | — | — |
  | `files` | 183 | — | — | — |

  **Two compounding reasons the section looks empty**, and the second is the one that matters:
  1. Most rows belong to the `default` org — development traffic, not tenant demo data.
  2. **Workspace data is scoped per USER**, so a demo viewer sees only conversations/projects THEY own. Even a
     well-seeded tenant looks empty to a viewer unless the seed is owned by the viewer account.
  **This is the precondition for the 53 🔶 rows**, not a cosmetic gap: "wired but unproven" is largely
  *unprovable* while the surfaces have nothing in them to exercise.
  **Seed under the DEMO VIEWER identity** (`demo-bank@getoffgridai.co` / `demo-insurer@…`), not an admin, or the
  screens stay blank for exactly the person a buyer watches.

- **Correction: I twice claimed "no table exists" for Projects and Artifacts. Wrong.** I guessed table names
  (`projects`, `artifacts`) instead of reading what the page fetches — `ProjectsBrowser` calls
  `/api/v1/chat/projects`, and the tables are `chat_projects` / `chat_artifacts`, both populated. Third time this
  session that inferring a name from a symptom produced a false finding, after four invented 404 routes and the
  `eval_defs` / `eval_definitions` mix-up. **The rule already written in this file — enumerate from the router or
  the schema, never from a label — applies to TABLE names too.**

- **Golden cases: every pipeline now has real ones, none has placeholders.** After the 33-row purge left
  Collections, KYC and Motor-Claim FNOL at zero, cases were written for them **from each pipeline's own
  description** rather than invented from the domain — KYC states "validates PAN, Aadhaar and address proofs
  against the customer record; strictest allowlist and mandatory masking", Motor-Claim FNOL "never lets
  policyholder PII leave the network", Collections "collector approval and an auditable report". The
  expectations encode governance behaviour the pipelines already claim, which is defensible without domain
  invention.
  Coverage: Collections 2 · Cross-Sell 1 · Fraud 2 · KYC 2 · Loan 1 · Motor-Claim FNOL 2 · Reimbursement 2.
  **⏳ AWAITING DOMAIN SIGN-OFF** — a KYC officer should confirm the wording before these gate a release. That
  is tracked HERE and deliberately NOT flagged in the data: a "provisional" marker inside a golden set is
  exactly how the 33 placeholder rows crept in and survived.
  **Still thin:** Cross-Sell and Loan hold ONE case each. One case is measurable but not meaningfully gated,
  and saying so beats letting "1 case" read as covered.

- **Library chips: leak fixed, 4 → 2 verified live; the residue is a different code path.** The app Quality page
  called `listEvalDefs(null)` — the LEGACY `string|null` overload meaning `appId: null`, which filters
  `app_id IS NULL` **only**. So every pipeline-bound eval without an app leaked into "Attach from the library"
  and was offered for attaching when it was already attached. Fixed to `{ pipelineId: null }` →
  `pipeline_id IS NULL AND app_id IS NULL`, which the *pipeline* Quality page was already using correctly.
  **It also caught a regression I had just created:** clearing `app_id` on 21 defs during the per-pipeline dedupe
  would have added 21 more phantom chips on the next render.
  **The remaining 2 are NOT eval_definitions** — all three unbound defs have proper names
  (`Answers cite a bank policy`, `No guaranteed-outcome language`, `PAN and account numbers stay masked`), so the
  duplicate label comes from the TEMPLATE catalog rendered beside the library. Different code path; needs the
  chip-assembly in the panel read. Recorded rather than guessed at.
  **The pattern, four times today:** a legacy convenience overload that quietly means something narrower than the
  caller intends. `listGoldenCases` has the identical shape (`arg === null → { appId: arg }`) and the identical
  hazard. The explicit filter object is unambiguous and already existed — the convenience form IS the defect.

- **🔴 THE GOLDEN SET WAS DECORATIVE ACROSS EVERY PIPELINE.** Purging placeholders ("… — sample query N" whose
  expected answer was just the pipeline's own name) deleted **33 cases**. What remains is only the 6 real cases
  written today: Reimbursement 2, Fraud 2, Loan 1, Cross-Sell 1 — and **Collections, KYC and Motor-Claim FNOL now
  have ZERO**. Earlier in this session I read "collections 3, kyc 3, motor 3" as evidence that golden cases
  *already existed* and used it to argue the display was the bug. Both were true: the display WAS querying the
  wrong column, AND the data behind it was filler. A placeholder is worse than an empty state — the empty state
  says "add cases", the polluted state says "you have five" and averages three meaningless ones into the score.
  **Remaining:** write real cases for Collections intervention, KYC Verification and Motor-Claim FNOL, and more
  for the four that now have 1–2. A pipeline with one case is measurable but not meaningfully gated.
- **Eval duplication fixed by correcting my own model.** Seeded 3 per APP, but apps SHARE pipelines (four share
  Reimbursement Governance) and the panel lists per PIPELINE → "12 attached" of near-identical checks. Now **3
  per pipeline across all 7**, named after the pipeline, `app_id` cleared. The heading was right twice: first it
  showed the query was wrong, then that my seeding was.

- **🔴 THE APP QUALITY TAB QUERIES BY APP, THE DATA IS BOUND BY PIPELINE — third instance of one mismatch.**
  Founder opened `bhapp_reimb/quality`: "No evals yet, 0 attached" and "Golden set for this pipeline (0)".
  Neither was missing data.
  1. **Evals** — the panel attaches per PIPELINE; the seed bound them by `app_id`. Fixed (bind apps → pipelines,
     backfill eval `pipeline_id`): visibility **18 → 36 of 42**, verified on screen for two apps.
  2. **Golden set** — `listGoldenCases(id)` treats a string arg as `{ appId }` (`evals.ts:171`), so the page
     queries by APP while every case is bound by PIPELINE. Cases *already existed* for pipelines nobody had
     touched (collections 3, kyc 3, motor 3) and still displayed 0. **This is a code bug, not absent data**, and
     seeding more cases would not have fixed it — I nearly did exactly that.
  3. **A panel titled "…for this pipeline" that filters by app id** is the same defect stated in the UI: the
     heading is the spec, the query contradicts it.
  **Fix:** on an app surface, resolve the app's `pipelineId` and query golden cases (and evals) by it — one
  resolution, used by both panels, so they cannot disagree again.
  **Also open:** four identical "Hallucination / Faithfulness" chips in "Attach from the library"
  (`listEvalDefs(null)`) — unresolved; only ONE template carries that name and only 3 unbound defs exist, so the
  duplication is in how the library list is assembled, not in the data. Needs the actual `listEvalDefs(null)`
  query read.
  **Founder verdict on the surface: "the UX isn't sitting well, that needs work."** Recorded as-is — three
  panels on one screen each disagreeing with their own heading is a UX problem before it is a data problem.

- **AI QA for the 11 apps — started, and the first finding was a lie in my own metric.** Founder called this
  critical. `appsWithEvaluations` reported **0 of 11**, which reads as a damning product fact. It was a bug: the
  reader I had just written never populated `hasEvaluations`, so the metric could only ever return 0%. **A
  metric that cannot be non-zero is worse than no metric** — it very nearly sent us building eleven eval
  definitions to fix a number that was lying. Now sourced from `eval_definitions.app_id`.
  What the check DID establish, from the live box:
  - `eval_definitions` has an **`app_id` column**, so evals bind per APP, not only per pipeline. Good — that is
    the right granularity for "every production use case should have evaluations" (§8H).
  - org_bharat has only **3 eval definitions** (faithfulness ×2, answer_relevancy ×1) and **none is bound to an
    app or a pipeline**. So the real gap is genuine, just not 11/11 — it is "3 unbound definitions exist".
  - **7 of the 11 apps have NO pipeline** (`app_5803e04b`, `app_b82a42be`, `app_c0f4398a`, `app_d07ab6a9`,
    `app_demo_crosssell`, `bhapp_fraud`, `bhapp_xsell`). That is a second, larger finding: it explains the 59%
    governed-activity share, and it means pipeline-scoped governance does not reach most apps.
  - The table is `eval_definitions`, not `eval_defs` — worth recording since a query against the wrong name
    returns "relation does not exist", which is easy to misread as "no evals exist".
- **AI QA seeded — all 11 apps now have evaluations (0 → 11, 33 definitions).**
  `scripts/seed-app-evals.sql`, idempotent, verified live (`count(DISTINCT app_id)` → 11). Three metrics per
  app, each catching a different failure, all on engines verified live today:
  `faithfulness ≥ 0.80` (confident invention), `answer_relevancy ≥ 0.75` (on-topic non-answers, which PASS a
  faithfulness check because they invent nothing — which is why one metric is not enough), and
  `pii_leakage ≤ 0.01` (near-zero: one leaked PAN is a breach, not a quality dip, so the threshold is
  deliberately not symmetrical with the other two).
- **Suites EXECUTED — first real per-app AI QA baseline, and it exposed an engine mismatch.**
  | engine | runs | avg | passed |
  |---|---|---|---|
  | `pii_leakage:heuristic` | 6 | 0 | **6/6 ✅** |
  | `answer_relevancy:ragas` | 4 | 80 | **4/4 ✅** |
  | `faithfulness:heuristic` | 2 | 0 | **0/2 ❌** |

  `pii_leakage` scoring 0 is a PASS — lower-is-better, so zero means nothing leaked. Read the direction before
  reading the number.
  **🔴 THE FINDING: `faithfulness` runs on a heuristic that returns 0, while a working entailment engine sits
  next to it.** The model grounding adapter was verified live earlier today — it supported a paraphrase and
  refused a contradiction. So this is not a quality failure, it is the EVAL path falling back to the lexical
  heuristic (`faithfulness:heuristic`) instead of using the entailment engine the grounding path uses. Two
  engines for one concept: one works, one always returns 0. A faithfulness gate that always fails is as useless
  as one that always passes, and worse — it trains people to ignore it.
  **ROOT CAUSE FOUND, and it is NOT the engine — 2026-07-30.** The ladder fix was made (ragas → entailment →
  heuristic, `eval-runner.ts`) and faithfulness STILL logs `faithfulness:heuristic score=0`. The entailment rung
  returns null because it has nothing to work with: `buildSamples()` sources contexts from
  `searchDocuments(c.query, 3)`, and when retrieval returns nothing the sample has **no contexts at all**.
  Faithfulness is "does the answer follow from its contexts" — with no contexts it is **unmeasurable by every
  engine**, which is why ragas produced no aggregate, why entailment declined, and why the heuristic returned 0.
  Three engines agreeing on 0 was never three failures; it was one missing input.
  **So the real gap is the golden corpus, not the scorer.** 33 golden cases exist, but their queries do not
  retrieve — the cases were authored without checking that the retrieval layer can find anything for them.
  **AND THE FIX IS NOT WHERE I SAID EITHER — the dependency is descoped.** `searchDocuments()` lives in
  `src/lib/brain.ts`: the golden samples' contexts come from the ORGANIZATIONAL BRAIN, which the founder parked
  on 2026-07-30. So "index the corpus so retrieval works" is work inside descoped territory, and doing it would
  have quietly violated the descope while looking like an eval fix.
  **The right fix is architectural and IS in scope.** An app's faithfulness should be judged against the sources
  THAT APP actually read — its own `connector-query` step outputs, which are already retained on the run and
  already rendered as tables for reviewers — not against a global knowledge base the app never consulted.
  Judging an expense-claim app against a bank-policy corpus is the wrong question even when retrieval works:
  the app's answer should follow from the claim and the quota rows it read, and nothing else.
  **BUILT 2026-07-30** — `src/lib/eval-samples-from-runs.ts`, 9 tests. Samples now come from an app's own runs:
  contexts are its completed `connector-query` outputs, the answer is its agent's, the question is the step
  label the author wrote. No brain, no re-indexing, no descope violation, and it composes with the ladder fix —
  the entailment rung engages the moment contexts arrive this way.
  Two rules encoded because they are what four wrong diagnoses cost: a run with **no contexts returns null** and
  stays OUT of the corpus (scoring it 0 calls the app unfaithful when nothing was measured), and a **failed read
  is not a source** — an errored step's message is excluded, so "credential refused" can never be graded as
  evidence. `groundTruth` is left empty rather than invented, since a production run has no expected answer.
  **This is strictly better evidence than a golden set:** it is what the app actually did, on real cases, with
  the sources it actually used — §8H's "every production use case" read literally.
  **WIRED but NOT PROVEN — 2026-07-30.** `eval-runner` now calls `samplesForApp()` when a def carries an
  `appId`. Re-ran the faithfulness def for `app_c0f4398a` (an app with several verified runs from today) and the
  engine tag STILL reads `faithfulness:heuristic score=0`, with **`total=1`** — one sample, which means it took
  the GOLDEN path, not the app's runs. Run-sourced sampling would have produced up to five.
  So one of these is true, and the next session should determine which before changing anything else:
  (a) `samplesForApp` threw and the best-effort catch silently degraded to golden — the most likely, and the
  cost of a broad `catch` on a diagnostic path;
  (b) `listAppRunsView(appId, orgId, 25)` returned runs whose steps carry no `outcome` in the view projection,
  so `samplesFromRuns` found no contexts and correctly returned none;
  (c) the deployed bundle predates the wiring.
  **Cheapest discriminator:** log or return the sample count and source from the run route — `total` alone
  cannot distinguish "no app runs" from "app runs had no usable contexts" from "the import threw", and that
  ambiguity is exactly what made this defect take four wrong diagnoses. The broad catch should also narrow to
  the specific failure it is guarding, since as written it converts a bug into a silent fallback.
  **Status is honest: the chain is built and unproven. `faithfulness:heuristic score=0` still means UNMEASURED.** The ladder fix stays: it is correct and will engage the moment contexts
  exist, and it removed a lexical scorer that could only ever return 0.
  **Reading instruction until then: `faithfulness:heuristic score=0` means UNMEASURED, not failing.**

  **Previously (superseded, kept because the reasoning was sound and the conclusion was wrong):**
  Located to `src/lib/eval-runner.ts` ~207-218. When the ragas sidecar returns no aggregate for
  the metric, the code degrades to `heuristicSampleScore(def.metric, sample)`, and for faithfulness that
  lexical heuristic returns 0. The degradation is *honestly tagged* (`computedBy: 'heuristic'`) — the defect is
  not dishonesty, it is that **the fallback ladder is missing its middle rung**: ragas → heuristic, with no step
  for the entailment adapter that already works. Grounding IS faithfulness; `/api/v1/admin/grounding/verify`
  scores a paraphrase correctly and refuses a contradiction, verified live 2026-07-30.
  **Fix:** insert the grounding port between ragas and the heuristic for `faithfulness` / `groundedness`, so the
  ladder reads ragas → entailment → heuristic. Keep the honest engine tag on whichever rung produced the score.
  Until then, treat every `faithfulness:heuristic` result as *unmeasured*, NOT as failing — the 0/2 above says
  nothing about answer quality.
  **Next on this thread:** **bind the 7 apps
  that have NO pipeline** — the more serious item, since pipeline-scoped governance currently does not reach
  most apps, which is what the 59% governed-activity share was telling us — then release gates so a failing
  suite blocks a publish.

- **§13 metrics computation built** — `src/lib/product-metrics.ts`, 15 tests. The §13 audit's finding was
  that almost every success metric is derivable from recorded data and almost none is computed; this is the
  missing computation for the three groups that need no new instrumentation: **reliability** (successful /
  failed / success-rate / blocked violations / median run seconds), **reuse** (pipelines actually used,
  template adoption, apps per pipeline), **governance** (apps with evaluations, governed-activity share,
  human-approval share). Pure, no I/O — a thin reader is the remaining wiring.
  Three judgement calls recorded in the module: an empty denominator reports `null`, never `0%` ("0% of apps
  have evaluations" when no apps exist is the same lie as a failed read saying "no rows"); success rate
  counts only runs that reached a TERMINAL state, so a run correctly paused for an approver is not scored as
  a failure; and *hours saved / cost per process / error reduction are deliberately NOT computed* because
  they need a baseline nobody captures — inventing them would be the same defect as inventing a currency symbol.
- **§8, §9, §13 audited** — the checkable surface is now fully gated. Weakest area found: **§8G human review**
  (three of seven required disclosures and four of seven approver actions missing).
- **§12 audited and gated** (~150 items) — only **3 genuine gaps**: release gates, risk classification,
  environment promotion. Five apparent gaps were naming differences, caught before being filed.
- **Flow 7 step 3: prompt on the trace** — read from the child agent run so it is the text actually sent.
  Also fixed my own optimisation error: filled only the single-run read while the screen polls the list.
- **Crossing assertions on all five boundaries** — the durable guard for the session's defect class.
- **Eval evidence retention** — 64 of 84 runs stored a score with no per-case results; now retained.
- **Flow 6: risk + confidence, and readable evidence** — levels with reasons, never a percentage.
- **Flow 3 step 2: clarifying questions** — derived from the spec, not model-generated.
- **M1 value-stable pseudonyms · B3.1 end to end · B4.7 tamper-evidence · B2.4 entailment grounding ·
  B2.3 quality engine** — all promoted with live evidence (see `HERO_CLAIMS.md`).

### The pattern to carry forward

Five ledger rows this session described defects that were already fixed. Eleven real defects were a **field
dropped at a boundary** — every one passing typecheck and 5,500 tests, because each side was correct in
isolation. Two were my own, made while "fixing" something else. The check that caught all of them: exercise
the real path, then ask whether everything the producer computed is actually present.
