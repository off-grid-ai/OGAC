# Does the non-technical person get the value of what we built?

**Goal:** every capability on `/operations/services/capability-map` must deliver value to a
non-technical department person — with desktop UX worth the name — not merely exist.

Measured live against the map on **2026-08-04**, not estimated.

---

## The measurement

`SERVICE_CAPABILITY_AUDITS`: **49 services, 196 capability items, 90 distinct destination surfaces.**

Each capability item declares the console surface where a person reaches it. Grouped by that surface:

| | services | items |
| --- | --- | --- |
| **Pure infrastructure** — every capability only on an `/operations/*` page | 17 | 57 |
| **Mixed** — some capabilities on a product surface, some only on `/operations/*` | 10 | 45 |
| **Product surfaces only** | 22 | 94 |

**The finding that matters: only 3 of the 50 non-operations surfaces sit inside the non-technical
person's world** — `/solutions/apps`, `/workspace/chat`, `/work/files`. Everything else lands in
operator IA: `/data/*`, `/governance/*`, `/runtime/*`, `/insights/*`.

## What that does and does not mean

It is **not** an instruction to expose 94 capabilities to a department person. Ninety-four links would
be a worse product, and the 17 pure-infrastructure services (PostgreSQL, Redis, Jaeger, the OTel
collector, the forwarders, the tunnel, device management) must stay **invisible by name** — a claims
handler should never meet the word Jaeger.

**But invisible is not the same as delivering nothing.** Those 17 carry one thing a department person
genuinely needs and it was reaching them nowhere: *can I trust what I am looking at, and can I work right
now?* A person deciding a case could not tell "this queue is empty because the work is done" from "this
queue is empty because part of the platform is down" — the failure-presents-as-emptiness defect at
platform scale. `platformPlain` (2026-08-04) states it as an outcome and names no engine: *"One part of
the platform is not responding. Your cases are safe, but this screen may be missing some of them until it
recovers."* It shows nothing when everything is normal, so the band never becomes wallpaper.

The founder's model is the test:

> the system … inherit[s] the org's rules, workflows, data, connectors, policies, and guardrails
> **automatically**, and hand[s] them their own lovable ecosystem

So the bar is: **for each capability cluster, does its value appear inside the app or work surface, in
outcome language, without the person ever opening the operator page?**

## Cluster by cluster, against that bar

| Capability cluster (items) | Does its value reach the app surface? |
| --- | --- |
| Quality / evaluators / golden cases (13) | **Yes** — the app's Quality tab: checks, real cases it decided, what else is watching it |
| Usage dashboards / throughput (4) | **Yes** — `AppOwnerDashboard` (2026-08-04): volume, decisions, where the time goes |
| Access / RBAC / ABAC (5) | **Yes** — the app's Access tab, plus the owner banner naming an owner who never signs in |
| Guardrails / masking / recognizers (9) | **Yes (2026-08-04)** — the app's "What protects this" panel states them in plain language, from its own pipeline |
| Data sources / connectors (15) | **Partly** — the app's steps name what they read, and the source-health warning now appears on the deployed app too (2026-08-04) |
| Knowledge indexes / retrieval (8) | **Yes (2026-08-04)** — the app names what it reads, and where each source comes from |
| Drift monitoring (7) | **Yes (2026-08-04)** — drift checks record the app they were run for; the Quality tab answers it both ways round |
| Model routing / where it ran (7) | **Yes (2026-08-04)** — every governed call records the endpoint it went to; "Where the data went" states the record |
| Lineage (4) | **Yes (2026-08-04)** — `describeLineage` gives the per-app chain (domain → system → resource) from what the app itself declares |
| Replication / ETL / orchestration (15) | **Correctly operator-only** — a department person does not run pipelines |
| SIEM / audit / posture (6+) | **Operator-only, plus one closure** — subject-indexed access ("who has looked at this person's file?") is now answerable, see below |

## The two I first refused — and then closed properly

I initially recorded both of these as "correctly refused: the data does not exist". Refusing to **fake**
them was right. Stopping there was not — making the data exist was within reach, and both are now closed.

### 1. Where the data actually went — **CLOSED 2026-08-04**

Every governed model call now records, **at the moment of the call**, the endpoint it was made to, the
leash decision (local/cloud/block) and whether personal details were masked first. `classifyEndpoint`
(pure) decides on-prem vs external from the address: loopback, RFC1918, RFC6598, `.local`/`.internal`/
`.lan` and single-label hosts are on-prem; a public domain is external.

Proven live on `org_bharat`:
`{"decision":"local","masked":true,"endpoint":"http://127.0.0.1:8800"}` →
*"All 1 AI call for this app stayed on your own hardware — nothing was sent to an outside provider."*

The honesty rules are the substance:
- **UNKNOWN is a real answer** and is never folded into either side. An unclassifiable endpoint must not
  count as on-prem (that manufactures the reassurance) nor as external (that invents a breach).
- **With no records it says so** rather than reassuring. "Nothing left" and "we did not look" are the same
  picture to an auditor and opposite facts to a customer.
- It sits **beside** "What protects this", which states the RULES. This states the RECORD.

Cost of getting it there: **four** boundaries had to name the field (`StepResult` → the workflow's
`foldResult` → `applyResult` → `toStoredSteps`). It was produced correctly and arrived as nothing, because
the workflow fold — the path every real app takes — did not list it.

### 2. Per-app drift — **CLOSED 2026-08-04**

`drift_runs` now records `dataset` + `app_id` when the check is run, so attribution is real rather than
reconstructed. `listDriftRunsForApp` returns only runs whose `app_id` was recorded — deliberately not
"every run in this org shown on the app's page", which is the join the column exists to avoid.

Verified both directions: `bhapp_loan` (one attributed run) reads *"100% of the data feeding this app has
shifted since its baseline"*; `bhapp_reimb` (none) is reported as a **gap** — "no drift check has been run
for this app yet" — never as calm. Drifted data is named as a reason to look, not a failure: data moving
is often the business changing.

## Closed on 2026-08-04

- The **job-shaped app's front door** — it led with a decision queue that could never hold anything,
  offered no way to run the app its own headline told you to run, and never showed what it produced.
- The **app owner's dashboard** — throughput, what it decided, where the time goes, whether its answers
  hold up. No cost panel, because there is no per-run cost and a fabricated ₹0.00 reads as "free".
- **The home screen leads with the reader's own work.** Fourteen cases were waiting, oldest eleven days,
  and the only trace above the fold was a sidebar badge under a headline about running the platform.
- **The source-health warning reaches the deployed app**, not just the console page — the team using the
  app were the one group never told it is working from nothing.
- **Language:** swept the app and work surfaces for engine names (OpenSearch, Langfuse, Evidently, Ragas,
  LLM Guard, Presidio, Keycloak, OpenBao, Kestra, ClickHouse) — **zero leaks**. Removed "every run goes
  through the governed pipeline" and a raw internal status printed as `Finished with status "done"`.
- **A refusal stopped reading as breakage** — the case picker showed "Could not look up cases · Try
  again" to anonymous readers of a public app, with a retry that could never succeed.

### 3. Subject-indexed access — **CLOSED 2026-08-04**

`WHATS_MISSING_2.md` #2: the audit trail is indexed by actor and never by data subject, so "who in the
bank looked at Meera Malhotra's file, and when?" could not be answered.

Most of the answer already existed and nobody had joined it: `subject_chunk_index` maps a salted subject
fingerprint → the runs mentioning that person (152 rows live, built for erasure), and every run records
who decided it. `/api/v1/admin/subject-access` is the join. Verified live: *"1 person has decided a case
about this person: anjali.desai@bharatunion.example"* with three dated events; an unknown identifier
returns *"No records mentioning this person were found, so nothing is known about who has seen their
data"* — never "nobody accessed it".

Deliberately **not** joined through `audit_events_v2.run_id`: that column is empty on these runs, so the
ledger join returns nothing and would report "nobody accessed this file" about a person whose file twelve
runs had touched. The raw identifier is never stored or echoed — only its masked form — because asking
who accessed someone's file must not itself create a new record of them. And where the index names more
records than can be opened (12 indexed, 3 readable — the rest went when their apps were deleted) the trail
**says so**, rather than presenting a partial history as the whole of it.

## Next, in value order

Nothing on the capability map is now delivering zero value to a non-technical person. What remains is
depth rather than absence:

1. **Fairness checks on decisioning apps** — zero exist, on a tenant whose apps underwrite loans
   (`WHATS_MISSING_2.md` #5). The highest-value remaining governance gap.
2. **Adverse-decision artefact** — a declined applicant cannot be given reasons (#6).
3. **Consent withdrawal** — consent can be recorded but not revoked (#4).

The lesson from the two closures above is the one worth carrying: *"the data does not exist"* is a
statement about today's recording, not a boundary on the work. Refusing to fake a join is right; leaving
the question permanently unanswerable when we control the writer is not.
