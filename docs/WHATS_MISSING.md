# What's missing — two people's view of the platform

Written 2026-08-03 against the live `org_bharat` tenant. **Nothing here is inferred from the code.** Each
finding is the result of asking the platform a question and recording the answer; the probes are
committed as `scripts/probe-ciso-questions.mts` and `scripts/probe-operator.mts` so every number can be
re-run and contradicted.

Two corrections I had to make to my own probes while writing this, both recorded in the scripts because
they are the kind of error that manufactures fake findings:

- I filtered `data_assets.classification` and the query errored. There is no such column — which turned
  out to be a real gap, but it also **invalidates the §12 harness's "Data classification: PRESENT"**,
  which only counted rows in a table.
- I matched human steps with a `LIKE` over serialised JSON and got 0, contradicting a run I had watched
  pause at one. Queried properly: 71.

---

## Part 1 — The CISO / DPO

Twelve questions, in the form a security or privacy officer actually asks them.
**2 answered · 7 partial · 3 cannot be answered at all.**

### Cannot be answered

**1. "Which models processed data classified Confidential or above?"**
There is no classification anywhere. `data_assets` records id, name, source, connector, domain, kind,
owner, description, row count, freshness and sync state — and no sensitivity field. So nothing can be
labelled Confidential in the first place, and the question is unanswerable by construction, not by
omission of a report. Sixteen assets are catalogued; none of them can be graded.

**2. "A customer demands erasure. Prove every copy is gone, including embeddings."**
Zero erasure requests and zero tombstones exist, against 27 embedded chunks for this tenant. More
fundamentally: **nothing links a data subject to the chunks that contain them.** Deletion from a source
table would leave the vector copy in place with no way to find it. This is the single most expensive gap
in the list — DPDP and GDPR both turn on it, and "we deleted the row" is not an answer when the model
was trained on, or retrieves from, a copy.

**3. "On what lawful basis was this personal data processed?"**
No consent or lawful-basis record anywhere in the schema. For a BFSI buyer under DPDP this is a required
artefact, not a nicety.

### Answered

**"What left our network, to where, and who authorised it?"** — `gateway.egress.dlp` × 15 in the ledger.
**"Which third parties process our data, and where does inference run?"** — six bound gateways (OpenAI,
Anthropic, OpenRouter, DeepSeek, Zhipu, On-Prem Cluster), inspectable per pipeline.

### Partial — and the partials are where the risk sits

**"Show every automated decision about a customer, with the human accountable."**
**CORRECTED 2026-08-03 — I overstated this.** The counts were right (71 completed human steps, 1 naming
a reviewer) but the conclusion was wrong. I then drove a real approval through the live resume path and
the reviewer WAS recorded: `apprun_8b371023` → `reviewer: ravi.kumar@bharatunion.co.in`. So the product
captures the accountable person; the 70 blanks are SEEDED rows whose human step was marked done without
ever passing through the review route.

That makes this a demo-data defect, not a compliance gap — but it is still a defect, because a CISO
running exactly the query I ran would draw exactly the conclusion I drew. The seed now names a reviewer
on every completed human step (`scripts/backfill-seeded-reviewers.mts`).

**"Prove a control was active at the TIME of a run."**
132 runs retain their own guardrail verdicts, which is genuinely good. But a run does not record which
POLICY VERSION was in force, and there is no `policy_history` table at all. "Was masking on at 14:03 on
12 July?" is inferred from today's configuration, not proven from the record.

**"A bad version shipped — what did it touch, can we reverse it?"**
App versions and rollback now exist (built this week). But **a run does not record which app version
produced it**, so "which runs came from the bad version" cannot be answered — which is the only question
that matters during an incident.

**"Who accessed customer PII in the last 30 days?"**
389 events by 9 actors, and 40 runs show masking fired. But no event is *classified* as a PII access, so
answering requires manual correlation of run traces.

**"Who has standing access to what, when was it last reviewed?"**
13 users and 3 attribute rules are listable. There is no access-review artefact — no record that anyone
ever certified an access list, which is a standard SOC 2 / ISO control.

**"What is deleted when, and did it happen?"**
A log-retention setting exists; no retention RUN is recorded. The ledger reaches back to 8 July with
nothing aged out, so the promise is unevidenced.

**"What changed in policy, and who approved it?"**
30 pipeline versions carry a snapshot and an author — genuinely auditable. Org-wide policy has no
history at all.

### What I would build, in order

1. **Subject → chunk index**, so erasure can be proven across the vector store. Everything else on this
   list is a reporting gap; this one is a compliance failure.
2. **Stamp the run**: policy version, app version, and the reviewer's identity on every run. Three
   columns that convert six "partial" answers into answered ones.
3. **A classification field on data assets**, propagated to runs that read them.
4. Consent / lawful-basis records, and an access-review artefact with a date and a certifier.

---

## Part 2 — The non-technical person who owns the app

Probed against the same tenant: 12 apps, 9 published.

**They cannot see what it costs.** Cost is attributed on **15 of 389** ledger events. A department head
who wants to know what a process costs per case has no answer, and cost is the first question anyone
asks about running AI on their own work.

**A failure tells them nothing.** 16 runs failed; the sample failure outcome is an **empty string**. The
run trace explains failures well for an engineer, but the outcome a business owner reads is blank — so
their only recourse is to ask someone technical.

**Nothing was tested before it was published.** Nine apps are published; 46 eval runs exist, 33 bound to
a pipeline — but no gate ties "this app was tested" to "this app went live". A non-technical builder has
no way to know whether publishing is safe, and no prompt telling them to check.

**Nobody has ever corrected an answer.** Corrections captured from real use: **0.** The loop exists and
works (I verified it end to end this week, after fixing a bug that sent every correction to the wrong
org) — but there is no "this was wrong" affordance where the app is actually used, so it has never once
been exercised by a human.

**Time is meaningless as reported.** Average run duration reads 62,396 seconds — 17 hours — because
waiting for a human is counted as run time. The number an operator needs ("this takes four minutes of
work and a day of waiting") is not distinguished anywhere.

**Runs describe themselves inconsistently.** 81 runs carry a written outcome across 52 distinct texts —
so the same app describes its result differently almost every time. There is nothing an operator can
scan, group or count.

### What I would build, in order

1. **Cost per case, on the app's own page.** One number, in rupees, with a monthly total. It is the
   question every owner asks first and the platform cannot answer.
2. **Failures that explain themselves in business language** — an outcome sentence for every failed run,
   the way the connector failures already do it.
3. **A test-before-publish gate**: publishing offers to run the app's checks and shows the result. The
   derived checks added this week give every app something to run.
4. **A "this was wrong" control where the app is used**, feeding the correction loop that already works.
5. **Split working time from waiting time** in every duration.
6. **A structured outcome per app** (approved / rejected / needs info / value) instead of free text, so
   the Reports tab can count something.

---

## What this report does not cover

I did not test the builder with an actual non-technical person, which is the only way to settle whether
the plain-language plan reads. That gate stays open in the audit and no probe can close it.
