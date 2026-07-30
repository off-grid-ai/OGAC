# HERO_CLAIMS — every promise the hero animation makes, and whether the console keeps it

> **Read this before choosing what to build.** It is the bridge between the story we sell
> (`../../investor-relations/hero-animation-SCRIPT.md`, the deck, the one-pager) and the software that
> has to survive the click-through. `ROADMAP.md`'s active queue is derived from this file.

## Why this file exists

The hero script binds each of its four beats to product planes **"so the animation provably covers the
whole product."** *Provably.* That word is a commitment: a CIO watches 22 seconds, then follows
`onprem-console.getoffgridai.co` off the one-pager and opens the seeded bank and insurer. **Every claim
on screen has to be a working surface, or the demo exposes the animation as a lie.**

Without this ledger, demo-fatal defects get found by accident. All three of these were live for weeks
while feature work continued elsewhere, and every one of them broke a specific on-screen promise:

| What was broken | The claim it broke |
|---|---|
| An app answered `Result: (no output)` | B3 · *"Describe what you need in plain words — get working software."* |
| Two data reads returned 20 unrelated rows, so the AI could not decide | B3 · *"It inherits your rules automatically."* |
| `PAN ABCDE1234F` passed the guardrail unmasked, while the console displayed a policy reading "Mask PAN in every output" | B4 · *"Governed by default… every result traceable and audited."* |

The point of a claim-keyed ledger is that the *claim* is the unit of work, so a gap surfaces as "Beat 3
line 2 is unproven" rather than sitting in an append-only backlog whose index goes stale.

## The gate — status is evidence, never intent

Honesty bar from `CLAUDE.md`: report the gate, never inflate.

| Gate | Means |
|---|---|
| ✅ **VERIFIED** | Exercised on the live box and the terminal artifact was read. Evidence in the row. |
| 🔶 **WIRED** | Code exists and is reachable, but this claim has not been exercised end to end. Row names the check that would promote it. |
| 🔴 **GAP** | Known missing, broken, or overclaimed. Row names the defect. |
| ⬜ **OTHER REPO** | Belongs to `mobile` / `desktop`, not the console. Listed so coverage is honest, not to be built here. |

**A row may only be promoted to ✅ by someone who ran it and read the output.** "The code looks right"
is 🔶. Two of the first backlog items picked up on 2026-07-29 were already fixed — verify before
building, and record the evidence so the next session doesn't re-verify.

---

## GOVERNING RULE — the vocabulary is a product requirement, not just an animation note

The script's governing rule "overrides everything on screen": lead with the outcome, speak to *you*,
and **keep our engineering vocabulary off the screen**. It applies to the console too — the same CIO
is inside the product ninety seconds after the loop ends.

**KILL from any surface a customer sees:** `ETL` · `CDC` · warehouse internals · semantic models ·
vector / retrieval indexes · `RBAC` / `ABAC` · `OPA` · `DLP` · "derived" · "nodes" · "pipeline" · any
OSS or vendor product name.

**Measured state (2026-07-29)** — occurrences across `src/app` + `src/components` `.tsx`:

| Term | Files | | OSS name | Files |
|---|---|---|---|---|
| `ABAC` | 11 | | `langfuse` | 20 |
| `OPA` | 7 | | `opensearch` | 13 |
| `ETL` | 7 | | `evidently` | 9 |
| `RBAC` | 6 | | `presidio` | 8 |
| `DLP` | 2 | | `qdrant` | 8 |
| `CDC` | 1 | | `kestra` | 7 |
| `pipeline` | ~148 | | `clickhouse` | 6 |
| | | | `openbao` | 6 |
| | | | `temporal` | 5 |
| | | | `airbyte` | 4 |
| | | | `seaweedfs` | 4 |
| | | | `ragas` | 3 |
| | | | `superset` | 3 |

Counts are file-level and include non-display code, so they are an upper bound — but they establish
the leak is systemic, not incidental. This is 🔴 **GAP V1** in the roadmap. It needs a repeatable
check (`scripts/check-hero-vocabulary.mjs`) so it cannot regress, not a one-off sweep.

---

## Beat 1 — SENSE · "Learn from work"

> On screen: `See how work actually happens — across every person and system.`
> `Nothing private ever leaves the device.`

| # | Claim | Surface that must prove it | Gate | Evidence / what's missing |
|---|---|---|---|---|
| B1.1 | Work is sensed across **every person** | OGAM (mobile) / OGAD (desktop) capture | ⬜ OTHER REPO | `mobile` / `desktop`. Console shows them as managed devices. |
| B1.2 | …and **every system** | Data → Sources / Connectors | ✅ VERIFIED | 2026-07-29: all 6 demo connectors probed live and connect (mssql, mysql, 2× postgres). Found and fixed one password-less and one pointing at a non-existent role. |
| B1.3 | Devices are **managed** and visible | Operations → Fleet / devices | 🔶 WIRED | `/fleet-control` + device enrollment API exist. Promote by enrolling a device and reading its policy + audit round-trip. |
| B1.4 | **Nothing private ever leaves the device** — raw stays local, derived only | The privacy gate at capture; egress governance | 🔶 WIRED | The strongest claim in the whole loop and the least proven *in the console*. Needs an artifact showing raw-vs-derived at the boundary. |

## Beat 2 — REMEMBER · "Build organizational memory"

> On screen: `One trusted source of everything your organization knows.`
> `Every answer comes from your approved knowledge — with sources you can check, scoped to each role.`
> `Expertise that never walks out the door.`
> Chips: `answers you can verify · scoped to each role · single source of truth`

| # | Claim | Surface | Gate | Evidence / what's missing |
|---|---|---|---|---|
| B2.1 | Scattered sources **consolidate** into one governed body | Data → Flows / jobs → warehouse | ✅ VERIFIED | Console job → compiled flow → dispatched execution proven live (recorded in the orchestration note). No-DAG jobs fall back to direct copy. |
| B2.2 | It is **catalogued, classified and masked** | Data → Catalog + masking rules | 🔶 WIRED | Catalog + masking rules exist and are seeded. Promote by showing a masked column actually masked in a query result. |
| B2.3 | **Quality-gated** | Data quality expectations | 🔴 GAP | **G-F4** — engine reports `engine:"fallback (stub)"`; a run evaluates 0 expectations. The claim is currently decorative. |
| B2.4 | **Answers you can verify** — inline citations tracing to governed sources | Work → Chat, grounded + cited | 🔴 GAP | **G-F3** — grounding runs the lexical/heuristic fallback: exact overlap → supported, a **paraphrase → unsupported (score 0)**. Citations render, but "verify the source" is not entailment-grade. This is a headline chip. |
| B2.5 | **Scoped to each role** | Retrieval ACL / asker identity | ✅ VERIFIED | Cross-org RAG leak closed and covered by `security-236-rag-cross-org-leak.integration.test.ts`; org scoping re-verified live 2026-07-29 across all three hosts (bearer + session). |
| B2.6 | **Single source of truth** / lineage end to end | Data → Lineage | 🔶 WIRED | Lineage surfaces exist. Promote by tracing one answer's citation back through lineage to the source row. |
| B2.7 | **Expertise that never walks out the door** | Org brain retention | 🔶 WIRED | Brain ingest + org isolation tested. No live artifact for the "expert left, knowledge retained" story the beat shows. |

## Beat 3 — ACT · "Turn knowledge into action"

> On screen: `Describe what you need in plain words — get working software.`
> `It inherits your rules automatically. People review what matters. It runs around the clock.`

| # | Claim | Surface | Gate | Evidence / what's missing |
|---|---|---|---|---|
| B3.1 | **Describe it in plain words → working software** | Solutions → Studio / builder | 🔶 WIRED | **The chain is proven live; one downstream defect stops the decision being useful.** Run `apprun_a60fcc2f` (2026-07-30): sentence → 5-step governed spec with correct bindings (`expense claims`, not the org's insurance `claims`) → quota read auto-inserted and reported → saved (`app_c0f4398a`) → picker offers 11 real open claims → run. Both reads are now **correctly case-scoped live**: s1 `ok(1 rows) — scoped by claim_no, employee_id`, dep1 `ok(6 rows) — scoped by employee_id` (was 20 unrelated rows each). Two root causes fixed: the run route dropped the picked record (`runInputWithCase`), and a compiler-inserted read had no filter to write (`case-scope.ts`, run-time inference). Blocked now only by **GAP M1** below — masking breaks entity identity, so the agent cannot tell the claim and the quota describe the same person. |
| B3.2 | It **inherits your data** | Connector-query steps bound to data domains | ✅ VERIFIED | 2026-07-29: case-scoped reads live — 1 claim row + that employee's 1 quota row, `{{case.employee_id}}` resolved, on both tenants. |
| B3.3 | It **inherits your rules** (data ceiling) | Pipeline data allowlist, enforced pre-connector | ✅ VERIFIED | A read outside the allowlist is denied before the connector is touched, audited as `pipeline.data.deny`. Observed live. |
| B3.4 | **People review what matters** | Human step + review/approve | ✅ VERIFIED | 2026-07-29: `apprun_9ba6a45d` — read → quota → decision (₹41,346.44 vs ₹137,454.12, headroom ₹96,107.68) → **human approved** → output → `done`. Work screen HANDLED 9 → 10. |
| B3.5 | **It runs around the clock** (agents 24/7) | Schedules + durable workers | 🔶 WIRED | Schedule editor + cron parser + workers exist. Promote by letting a scheduled app fire unattended and reading the run. |
| B3.6 | Reusable **templates** spread it | Solutions → Templates | 🔶 WIRED | Templates seeded per tenant. Promote by adopting a template into a working app. |
| B3.7 | Runs through **governed models / gateways**, local-first | AI Runtime → Models, Gateways | ✅ VERIFIED | Gateway + LiteLLM native keys/budgets/spend enabled on the router; every agent run resolves through it. |
| B3.8 | **Governed egress to frontier only when policy allows** | Egress leash on model calls | ✅ VERIFIED | `enforceModelCall` blocks an out-of-leash model with an audited reason; cloud routing wired via the compat provider. |
| B3.9 | Work **arrives on its own** (not typed into a form) | Triggers: webhook / email / whatsapp / schedule | ✅ VERIFIED | Inbound webhook → governed run proven live (HMAC + least-privilege + HITL). **Slack and Telegram are outputs only** — not yet `TriggerKind`s. |
| B3.10 | Results **go out** like any web app | Sinks: report, email, webhook, slack, whatsapp | 🔴 GAP | Webhook egress + signed delivery receipt proven live. **But the report/output step is INTERCEPTED** because global live actions are off (`shouldIntercept` → `liveActionsEnabled`, fail-safe). A demo run records what it *would* send. Operator decision, but the demo shows a sink firing. |

## Beat 4 — CONTROL · "Stay in control"

> On screen: `Governed by default, on infrastructure you control. Every result traceable and audited.`
> `The payoff: faster, cheaper, higher-quality work — and capability you didn't have before.`
> Membrane names: policies · guardrails · access · secrets · egress · audit · provenance · quality · drift · cost · regulatory

| # | Claim | Surface | Gate | Evidence / what's missing |
|---|---|---|---|---|
| B4.1 | **Policies** decide, centrally | Governance → Policies (OPA) | ✅ VERIFIED | Policy engine live on console + worker; authz decisions attributed `engine:opa`. |
| B4.2 | **Guardrails** screen content | Governance → Guardrails | ✅ VERIFIED | 2026-07-29 (G-F2): `PAN → [PAN]`, `Aadhaar → [AADHAAR]`, `IFSC → [IFSC]`, `UPI → [UPI]`, `card → [CARD]`, plus the engine's own scanners on the remainder. Output-phase scanning also confirmed. |
| B4.3 | **Access** is role-based and inherited | Teams, org tree, app sharing | ✅ VERIFIED | Team membership + role gate the lifecycle; management-chain inheritance resolves and is unit-tested; org scoping live on all hosts. |
| B4.4 | **Secrets** are held properly | Governance → Secrets (OpenBao) | ✅ VERIFIED | KV v2 lifecycle + dynamic DB credentials (issue / auth / revoke) proven live. Used for real: a connector credential was vaulted 2026-07-29 and the read succeeded through it. |
| B4.5 | **Egress is controlled** | Egress / DLP | 🔶 WIRED | Model-call leash verified (B3.8). Content-level egress inspection on outbound payloads not verified. |
| B4.6 | **Every result traceable and audited** | Audit ledger | ✅ VERIFIED | `audit_events_v2` is the canonical ledger; enforcement decisions (deny, mask, data-unavailable) are written with actor, run and reason. |
| B4.7 | **Provenance** — tamper-evident results | Run provenance signature | 🔴 GAP | Demo runs carry a *deterministically seeded* signature so the UI can show the trail. **A newly executed run's provenance is not verified.** Showing "signed and tamper-evident" on a seeded value while a real run may carry none is precisely the overclaim this ledger exists to catch. |
| B4.8 | **Quality / evals** | Insights → Quality | ✅ VERIFIED | Faithfulness scoring closed live against the judge sidecar; judge runs as a governed per-org system agent (no pinned model). |
| B4.9 | **Drift** is caught | Insights → Drift | 🔶 WIRED | Drift surfaces exist and the engine is wired. Promote by making a seeded dataset drift and reading the alert. |
| B4.10 | **Cost / FinOps** | Insights → Cost | 🔴 GAP | **PA-6** — rollups + an on-prem cost model are not built. Note: dollar budgets are $0 no-ops on free models, so a "budget enforced" demo is currently vacuous. |
| B4.11 | **Regulatory / trust** posture | Governance → Regulatory, Trust | 🔶 WIRED | Controls mapped to ISO 42001 / NIST AI RMF / EU AI Act render. Promote by exporting an evidence pack. |
| B4.12 | **On infrastructure you control** | On-prem deployment, `GOVERNED · ON-PREM` | ✅ VERIFIED | The whole platform runs on the box; the console runs natively and every service is self-hosted. |
| B4.13 | The payoff: **faster · cheaper · higher quality · new capability** | Outcomes / ROI | 🔶 WIRED | Per-app dashboard shows handled / waiting / duration, and ROI settings exist. No org-level outcome view that would justify the four chips. |

## Persistent elements

| # | Claim | Gate | Note |
|---|---|---|---|
| P1 | A **governed membrane** everything runs inside | ✅ VERIFIED | Enforcement is real at the data, model and action boundaries (B3.3, B3.8, B4.1–4.4). |
| P2 | An always-on **measurement ring** | ✅ VERIFIED | Per-entity traces matched on Langfuse tags; the OBSERVE tab is closed. |
| P3 | **Generic capability labels, never product names** | 🔴 GAP | **GAP V1** — see the vocabulary table above. |

---

## Scoreboard (2026-07-29)

| Gate | Count |
|---|---|
| ✅ VERIFIED | 16 |
| 🔶 WIRED (unproven) | 14 |
| 🔴 GAP | 6 |
| ⬜ OTHER REPO | 1 |

**The gaps, in the order they hurt a demo:**

0. **GAP M1 — masking destroys entity identity, so a governed agent cannot do the work.** The single
   most important finding of this session, and it blocks the headline claim.

   Run `apprun_a60fcc2f` read exactly the right data — Meera Malhotra's one claim (₹41,346.44) and her
   six quota rows (Training: ₹200,000 annual, ₹137,454.12 remaining, so the claim is comfortably within
   quota). The agent still could not decide, and its reasoning was correct given what it was shown:

   > "The claim submitted by [REDACTED_PERSON_23] … does **not** appear in the provided data. The only
   > claim listed in `expense_claims` is for [REDACTED_PERSON_12][REDACTED_PERSON_13], not
   > [REDACTED_PERSON_23]. Additionally, the `employee_quota` table does not contain any rows with the
   > employee name [REDACTED_PERSON_23]."

   One person, three different tokens. The masker's placeholder counter is PER SCAN, and a run scans in
   several places independently (`app-run.ts:745` masks the folded query; `agentrun.ts:958` masks again;
   `providedSources` travel as their own channel). So the same real value becomes a different opaque
   token in each channel, and the agent — reasoning faithfully over what it was given — concludes the
   records describe different people. Note also `[REDACTED_PERSON_12][REDACTED_PERSON_13]`: one name
   split across two tokens, which makes the join even harder.

   **This is not an argument for less masking.** It is an argument for VALUE-STABLE pseudonyms: replace
   an entity with a token derived from the value itself (`PERSON_a3f9`), so the same person is the same
   token in every scan, every channel and every step, while no real name ever reaches the model.
   Referential integrity is what makes governed data still *usable* — and "your AI does the work
   without ever seeing the name" is a stronger claim than anything currently on the page.

   Batching the scans would paper over this one run; it would break again the moment a run scans in two
   places. The token must be a function of the value, not of the scan.

   Deliberately NOT patched at the end of a long session: it touches the PII path shared by chat,
   agents and pipelines, and the current placeholder is minted downstream of where we still hold the
   original value — so the fix needs the analyzer's spans, not a rewrite of already-redacted text.

1. **B3.1 currency** — the compiled agent prompt renders `$41,346.44`. These tenants are Indian BFSI;
   it must be ₹. Small, and it is on screen in the hero.
1. **GAP V1 — vocabulary leaks** (P3). Every surface the CIO opens after the loop. Systemic; needs a check, not a sweep.
2. **B2.4 — grounding is lexical, not entailment-grade** (G-F3). "Answers you can verify" is an on-screen chip.
3. **B4.7 — provenance may be seeded rather than real.** We display "signed and tamper-evident".
4. **B3.10 — output sinks intercepted.** The loop shows a result going out.
5. **B2.3 — data quality is a stub** (G-F4). The beat shows "quality-gated".
6. **B4.10 — no cost model** (PA-6). "Cheaper" is one of the four payoff chips.

**And the highest-value 🔶 in the file is B3.1** — *"Describe what you need in plain words — get working
software."* It is the sentence on screen in Beat 3 and the founder's stated north star, and it has
never been verified live end to end in one sitting. Everything downstream of it (B3.2–B3.4) is now
green, which makes proving B3.1 both cheap and the single biggest credibility win available.

## How to maintain this

- Touching a surface in a row? Re-check the row and update the gate **in the same commit**.
- Promoting to ✅ requires pasting the live evidence into the row. Not "tests pass" — the artifact.
- A new claim in the script (or the deck, or the landing page) gets a row **before** it ships.
- Contradiction between this file and a gaps doc: **this file wins**, because it is keyed to claims we
  are actively making to buyers.
- **A defect is only a defect against a route the router actually serves.** I carried
  `/solutions/apps/[id]/safety` as a 404 for most of a session; it was a URL I typed myself from the
  lifecycle tab's *label* ("Safety" — the tab is `controls`). Generate sweep routes from the router or
  from real nav hrefs. An invented URL returning 404 is the router working.
