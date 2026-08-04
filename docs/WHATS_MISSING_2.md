# What's missing — second pass, 2026-08-03

The first report (`WHATS_MISSING.md`) is closed: its four CISO gaps and all fifteen UX findings shipped
and were verified live. This is the **next** frontier, probed against the live `org_bharat` tenant today.

Every number below is measured, not estimated. Where a mechanism exists but has never been used, that is
stated as its own kind of gap.

---

# Part 1 — As a CISO / DPO

## What I can now get, and it's real
Policy history with a version stamped on every run · lawful basis and purpose per data source, resolved
onto runs · an access-review artefact that applies its decisions · retention that executes and re-counts ·
erasure that finds embedded copies and proves they're gone · classification reaching runs. That's a
genuinely defensible core. Everything below is what I still cannot answer.

## Blocking — I would not sign off on these

### 1. I can delete a person but I cannot tell them what we hold
A DSAR has two halves. Erasure is built and proven; **access is entirely absent** — no export, no route,
no record of a request. Measured: zero tables and zero routes for subject access. Under DPDP the access
right and the correction right both land before erasure, and the platform answers only the third.

### 2. The audit trail is indexed by actor, never by data subject
**397 audit rows name an actor; 0 name a data subject.** So "who in the bank looked at Meera Malhotra's
file, and when?" cannot be answered — and that is the first question in any complaint, insider-risk
investigation, or regulator visit. I can tell you what a *person did*; I cannot tell you who touched a
*customer*.

### 3. No record of where data actually went
The ledger records a **model name (4 distinct)** and nothing about where that model ran — no provider, no
host, no region, no per-run egress event. So "did any customer data leave India?" is answerable only by
*inferring from configuration*, not from evidence. For an on-prem product whose entire pitch is that data
stays put, the absence of a positive egress record is the biggest hole in the story.

### 4. Consent can be recorded but not withdrawn
Lawful basis is now on every source, and "consent" is one of the options. But consent is the one basis a
person can **revoke**, and nothing records a withdrawal or stops future processing when it happens. A
consent record you cannot withdraw is not consent.

### 5. ~~No fairness evidence on decisions that decline people~~ — **CLOSED 2026-08-04**
Was: zero fairness or bias checks, on a tenant underwriting personal loans and triaging claims.

Now: `Governance → Evidence → Fairness`. Each group's selection rate against the best-performing group,
screened on the four-fifths (0.8) ratio — a screen that says "explain this", never "you discriminated".
Checks are **run and FILED** (`fairness_runs`), because a control that has never run is not a control.

Ran live on all four decisioning apps across both tenants. Every one honestly reports **UNTESTED rather
than clear** (3–10 decided cases each), names the six protected attributes absent from the decision
records, and states the remedy: *the decision record has to carry them*. Without that a reader concludes
the platform cannot do fairness, when in fact the decisions simply do not carry the fields.

What it refuses to do is the substance: a group under 20 decided cases is never scored; an absent protected
attribute is reported absent and **never imputed** (inferring gender from a name to audit fairness would
create the profiling the audit exists to prevent); a near-unique attribute is refused as an identifier
(this fired on real data — `cost_centre` and `expense_type`); a FAILED run is excluded rather than counted
as a decline, since counting a crash as an adverse outcome invents adverse impact out of an outage.

Nine tests cover the arithmetic the live data cannot yet exercise — a real 0.44 ratio flagged, even rates
passing, under-minimum groups unscored, identifiers refused, and the 0/0 edge.

### 6. A declined applicant cannot be given reasons
The model's reasoning sits in the run, in its own words, sometimes markdown, sometimes absent. There is
**no adverse-decision artefact** — nothing customer-presentable, nothing retained as the reason given.
Adverse-action notice is a legal requirement in lending, not a nice-to-have.

### 7. Human approvals carry no reason
**0 of the run records contain a decision note.** The affordance to add one shipped today (UX finding 15),
so this will start filling — but as of now every human approval in the system is unexplained. An approval
without a reason is a signature without a basis.

## Serious

### 8. The DPIA is a template, not an assessment
The trust centre *generates* a DPIA document from the control catalogue. There is no completed, owned,
signed assessment per app — no answer to "who assessed this app's risk, when, and what did they conclude".

### 9. Nothing starts a breach clock
No incident record, no affected-subject set, no notification deadline. DPDP's reporting obligation is
tight; today an incident would be managed in email and reconstructed afterwards.

### 10. One person can build, check and publish their own app
No change-approval record on publish, no segregation of duties. The person who writes the app also decides
its checks pass and puts it live. That fails basic change control before it fails any framework.

### 11. ~~Two of my own controls are wired but never exercised~~ — **CLOSED 2026-08-04**
Both have now run on both real tenants, with dated artefacts.

**Retention:** rules set per record class (bank 7 years on app runs, insurer 10 — defensible for lending
and life records), sweep executed and filed. It deleted nothing, correctly and explicitly: nothing is past
its window (oldest data 55 days). `remaining` is re-counted after the work, so the record proves the
deletion rather than asserting it.

**Access review:** completed on both tenants, 5 people each. The interesting part is what it forced —
the review flags "full admin access and has never signed in" as high risk, and **keeping** that account
now requires a written justification. Proven live: submitting the same review without one is refused with
*"priya.nair@…: full admin access and has never signed in — say why this access is being kept"*. Before
this, the artefact's worst line was its only silent one, which is the rubber stamp these reviews are
famous for.

### 12. No sub-processor register
Zero. Which external providers may receive data, under what terms, is not recorded anywhere — and it is a
standard schedule in every enterprise DPA.

### 13. Audit-log integrity is unverified
`audit_events_v2` is the ledger everything else cites. Whether it is append-only or tamper-evident I did
**not** establish, so I am not claiming either way — but a ledger whose integrity is unproven weakens
every claim built on it.

---

# Part 2 — As the non-technical person who owns an app

The surfaces read well now. What's missing is almost entirely about *working* the thing over time.

## Usage — the day-to-day

### 1. Nothing tells them work arrived
There is **no notification of any kind** when a case starts waiting. Output sinks exist for delivering
results (email, WhatsApp — and the code marks them "Phase 4: emits a StepResult noting the sink, not the
delivery"), but nothing tells a *person* that something needs them. They have to remember to look. The
consequence is already visible in the data: cases sitting **10 days** with "nobody has picked this up".

### 2. No cover when they're away
No delegation, no out-of-office, no reassignment. One person on leave and their queue silently stalls —
which is exactly what those 10-day-old cases look like.

### 3. No bulk decide
Seven near-identical reimbursements are seven separate round trips. The single most repetitive action in
the product has no batch form.

### 4. No urgency, no due date
A case waiting ten minutes and one waiting ten days differ only in a line of text I added. No SLA, no due
date, no escalation when one is breached — so nothing ever forces the pile to move.

### 5. No way to find a case
No search over cases. Once something leaves the visible queue, finding it means scrolling.

## Testing and evaluation

### 6. No trend — is this getting better or worse?
The data is **there**: 5–6 quality runs per pipeline spanning six weeks. Nothing plots it. I added "last
run" only, so a person can see today's state and not the direction — and direction is what tells you
whether a change helped.

### 7. No rehearsal on a real case before publishing
Shadow mode exists as a *setting*. What's missing is the flow: "run this on case #4 and show me what it
would have done, without doing it". Testing before publish is still an act of faith.

### 8. ~~Creation still needs a technical hand~~ — WITHDRAWN, this finding was wrong

I measured **"0 ready · 38 unavailable · 16 not shown by access"** on the builder and concluded that
creation stops at a data-binding wall a non-technical person cannot pass.

It does not. I had measured it signed in as the **read-only demo account**, for which "Not available with
your access" is the correct and intended answer. Re-measured against the same endpoint with an admin
token: **40 ready, 4 need approval, 3 unavailable, 1 denied — 44 of 48 selectable.**

The wall was my account, not the product. Recorded here rather than quietly deleted, because it is the
same mistake this codebase keeps catching — a refusal reading as a defect — and because
verify-before-building is the only reason no code was written for it.

## Maintenance

### 9. No named owner, no handover
No owner field on an app. When the person who built it changes role, nobody knows who maintains it, who
approves its changes, or who to ask. This is how these systems become unowned.

### 10. They aren't told when their data source breaks
Freshness and broken-sync are tracked on the data side. The *app owner* is never told that their app is
now reading stale data — measured on this tenant: three datasets stale by 566 hours, and the apps reading
them say nothing.

---

## The order I would fix them

**CISO/DPO:** ~~(1) per-run egress record~~ **CLOSED**, ~~(2) subject-indexed audit~~ **CLOSED**,
(3) subject access export, ~~(4) fairness checks on decisioning apps~~ **CLOSED**, (5) adverse-decision
artefact, ~~(6) run retention and an access review for real on both tenants~~ **CLOSED**, (7) consent
withdrawal, (8) publish approval.

**Still open, in order:** adverse-decision artefact (a declined applicant cannot be given reasons),
subject access export (the DSAR access right — erasure works, access does not), consent withdrawal,
publish approval / segregation of duties. Then DPIA-as-assessment, breach clock, sub-processor register,
audit-log integrity verification.

**Operator:** (1) tell them work arrived, (2) delegation and cover, (3) bulk decide, (4) due dates with
escalation, (5) quality trend, (6) named owner, (7) tell the owner their source went stale. (Creation was withdrawn — see 8.)

Two of these are cheap and change the product's honesty a lot: **running retention and one access review
on a real tenant** (the machinery is proven — it just needs doing), and **a per-run egress record**, which
turns the core claim of the product from an assertion into evidence.
