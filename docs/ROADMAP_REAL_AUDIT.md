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
| OGAC asks clarifying questions | 🔴 | Compile is one-shot; no clarification turn exists |
| Identifies available data, tools, policies | ✅ | Binds `expense claims` not the insurer's `claims` (`phrase-qualifier.ts`); inserts a missing quota read and *reports* it |
| Proposes a workflow | ✅ | 5-step spec: 2 reads → agent → human → output |
| User reviews the plain-language plan | 🔶 | Spec + gaps render; nobody has watched a non-technical person read it |
| Generates the app and tests | 🔶 | App generated (`app_5803e04b`); **test generation not verified** |
| User tests with examples | ✅ | Case picker offered 11 real open claims |
| User corrects failures | ❓ | Editing an app re-syncs the agent prompt (fixed earlier); the loop is unexercised |
| Generates/updates evaluations | ❓ | Evals exist as a surface; auto-generation from an app is unverified |
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
| Understands the action and evidence | 🔶 | **Weakest link: the evidence is raw JSON.** See G-UX1b |
| Sees risk and confidence | 🔴 | No risk/confidence signal on the review surface |
| Approves / edits / rejects / escalates | 🔶 | Approve + reject verified earlier; **edit and escalate unverified** |
| Decision is logged | ✅ | Audit ledger + run history |
| Feedback enters the evaluation system | ❓ | Not exercised |

### Flow 7: Investigate failure
| Step | Gate | Evidence |
|---|---|---|
| Alert shows failed or degraded run | 🔶 | Runs list shows status; alerting path unverified |
| Operator opens execution trace | ✅ | Per-step detail with status + timing |
| Sees data, model, prompt, tool, policy, evaluation stages | 🔶 | Data/model/policy visible; **prompt + evaluation stages not on the trace** |
| Identifies the failure | ✅ | Failures name their cause, never present as emptiness (`connector-failure.ts`) |
| Compares with previous versions | ❓ | Version history exists; comparison unverified |
| Fixes and tests | ❓ | — |
| Rolls out or rolls back | ❓ | — |

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

1. **Flow 6's evidence problem (G-UX1b).** A reviewer sees raw positional JSON. Every other part of the
   flagship flow works and this is what a department reviewer actually looks at. Highest value, lowest risk.
2. **Risk and confidence on the review surface** (Flow 6) — a 🔴 with no code behind it, and the doc names it
   as a step. A reviewer approving without a confidence signal is the governance gap that matters most.
3. **Clarifying questions in compile** (Flow 3) — the doc's second step, and we are one-shot. Turns a good
   demo into the product the document describes.
4. **Prompt + evaluation stages on the trace** (Flow 7, and the observability non-negotiable).
5. **One consistent honest-state vocabulary** across surfaces, rather than seven ad-hoc fixes.
6. **Time a cold enterprise setup** (Flow 1) — the doc's own "hours, not months" bar is unmeasured, and
   measuring it is cheap.

Everything marked ❓ is a candidate for a verification sweep before any of it is built. On this session's
record, roughly half of what looks broken is already working.
