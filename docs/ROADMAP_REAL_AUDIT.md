# `roadmap-real.md` — audit against the live console

**What this is.** `docs/roadmap-real.md` is the product definition: what OGAC is, the ten-year vision, the
nine user flows, the non-negotiables, the technical table stakes. It is a *specification*, not a task list —
"accomplish everything here" is a multi-quarter program covering deployment topologies, a marketplace, and
partner ecosystems.

This file is the bridge: every CHECKABLE requirement in that document, mapped to a gate, so work is chosen
against evidence rather than against a reading of the spec.

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
| 9 — Node intelligence contribution | ⬜ | `mobile` / `desktop` repos, not the console |

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
| **A. Organizational intelligence** — a permissioned graph over people, systems, data, decisions, apps, agents, models, policies, outcomes | 🔶 | The ENTITIES all exist and are enumerable, and the §8 questions are largely answerable per item: where knowledge came from (lineage ✅), who can access it (retrieval ACL ✅), which decisions used it (run refs ✅), whether a human verified it (approval records ✅), how confident (confidence signal ✅ as of today). What does NOT exist is the GRAPH — nothing traverses "which workflows depend on this knowledge" or "is it still valid". The document's own warning ("this cannot become an unstructured memory dump") is respected by accident rather than by design |
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
