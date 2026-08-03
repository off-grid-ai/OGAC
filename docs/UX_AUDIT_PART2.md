# Ease-of-use audit — the non-technical person who owns an app

**Method.** Signed in live as `demo-bank@getoffgridai.co` (bharatunion) and walked the journey that
persona actually has: land → find my app → see what needs me → decide a case → read a failure →
check it still works → know what it costs. Every finding below is from a screenshot I opened and
judged, not from reading code. Ranked by how hard it blocks the persona.

**The bar** (from `APP_AS_PRODUCT.md`): a non-technical person in a department can use the surface
unaided.

**What I could not test.** The demo account is read-only, so I could not submit work, publish, or
drive an approval through the UI. Everything below is about what the surface *communicates and
affords*, which is where the audit was aimed anyway.

---

## Blocking — the persona stops here

### 1. Their work lives under "Solutions"; the section called "Work" is chat
`/work` offers Chat, Projects, Prompts, Artifacts, Files. The apps that do their actual job — expense
claim approval, KYC re-verification — are under **Solutions → Apps**. A department person looking for
"my work" will not look in a section named after a sales word, and the one named "Work" doesn't
contain their work. This is the single worst piece of IA for this persona.

### 2. The apps list doesn't say which app needs them
12 app cards show name, step count, trigger and audience. None shows **published state** (the stat
band says 9 published; no card says which), and none shows **work waiting**. The app detail page
opens with "2 cases are waiting for a person to decide" — the most useful sentence in the product —
and the list one level up doesn't surface it. Their first question ("what needs me today?") requires
opening apps one at a time.

### 3. Twelve apps, several near-identical, including build artifacts
"Expense Claim Approval (fidelity check)", "Expense Claim Approval Process", "Reimbursement Approval",
"Reimbursement Approval (copy)", "Fraud Screening", "Fraud Alert Triage", "Personal Loan Underwriting",
"Personal Loan Underwriting Assist". `(copy)` and `(fidelity check)` are developer leftovers on a
demo tenant. A person cannot tell which one to use, and picking wrong is invisible.

### 4. They are asked to approve without the recommendation
On the waiting list, a case reads `Meera Malhotra · submitted · 41,346.44 · 2025-09-16` then
`read 2 sources · AI assessed it`, with **Reject** and **Approve** beside it. What the AI actually
concluded, and why, is not on the row — and the row has no visible affordance to open the case. The
decision buttons are the most prominent thing; the evidence is the missing thing.

### 5. A failed run leads with raw JSON and never says why it failed
`bhapp_fnol/runs/apprun_c52a4fc6`: the page opens with a `RUN INPUT { … }` JSON block, shows
`3/6 steps` and a red **Failed** chip, and **nowhere states the reason in a sentence**. Below it,
engineer traces in the primary reading path:
`data-domain "claims" [dom_358a0d65-8ee] → connector bhcon_corebank :: claims (read) → ok(20 rows via postgres)`.
The business owner's only recourse is to ask someone technical — exactly the dependency the product
claims to remove.

### 6. Nothing tells them whether the app currently works
The Quality tab lists three checks with genuinely good names ("Grounded in its sources", "Answers the
actual request", "No personal data in the output") and a **Run** button each — but **no last result,
no pass/fail, no date**. A person cannot answer "is this app OK right now?", which is the only
question the tab exists for. There is also no "run all" and no overall verdict.

---

## Serious — usable but reads as someone else's tool

### 7. Money is in dollars on an Indian BFSI tenant
Reports shows `COST $0.00`, `VALUE OF TIME SAVED $0`, `@ $75/hr loaded cost`. The tenant is a bank
with PAN, IFSC and rupee amounts. Also unformatted: `172885.74`, `4200000`, `41,346.44` — no ₹, no
Indian digit grouping.

### 8. Engine metric ids are exposed under every check
Under each plain-language check name: `faithfulness · quality checks · threshold 0.8 · higher-better`,
`answer_relevancy · …`, `pii_leakage · guardrails · threshold 0.01 · lower-better`. These are the
underlying engine's metric ids, which we have a standing rule never to surface. The good title is
immediately undercut by the line beneath it.

### 9. Platform vocabulary in the business report
Reports shows `HUMAN DECISIONS (HITL)`, `STEP MIX: Connector-Query 4, Agent 2, Human 2, Output 2`,
`THROUGHPUT / DAY 0.49` (0.49 of what?), `APPROVAL RATE N/A`, and both `EXCEPTIONS 0` and
`Exception Rate 0%`. A department head does not know what a Connector-Query is.

### 10. The one number they need is a dash
`USUALLY TAKES —` on the app page and `AVG DURATION —` on Reports. Where a duration does compute it
counts human waiting as run time (measured elsewhere at 17 hours average), so it is either blank or
absurd. "Four minutes of work, a day of waiting" is not expressible anywhere.

### 11. Cost reads $0.00 rather than explaining itself
Cost is attributed on 15 of 389 ledger events, and the demo runs on free models, so the honest answer
is "not measured here", not `$0.00`. A zero reads as "this is free", which is a claim we can't make.

### 12. The builder greets them with a jargon wall
The Apps page header (Studio) reads: "Every app runs through the same governed pipeline: policy gate,
guardrails, model routing, retrieval grounding, and tamper-evident provenance." Six platform terms in
one sentence, at the top of the surface for people who explicitly don't want to know the platform.
Same on `/work`: "Do more with governed company context", "Current posture and attention" — *posture*
is security jargon on a work page.

### 13. Checks from other apps appear under this app
The Quality tab of "Expense Claim Approval (fidelity check)" lists golden cases titled
"Reimbursement Approval: …" and "Reimbursement Approval (copy): …". They belong to the shared
pipeline, and the page says so — but the effect is a person reading another app's cases under theirs.
One case ("which source did this answer come from?") is listed twice with different expectations.

### 14. Destructive actions sit at equal prominence
Every app card puts a trash icon beside **Open**. On an unpublished app the two prominent header
buttons are **Duplicate this app** and **Publish as template** — platform actions — while the owner's
actual next step (test it, then publish it) has no button at all. `Not published yet` is grey 11px
text in the corner.

### 15. No way to say "this was wrong"
Confirmed against the data: **zero corrections** captured from real use. The correction loop works
end to end (verified this week), but there is no affordance where the app is actually used, so a
person who spots a bad answer has nowhere to say so.

---

## What is genuinely good (do not regress these)

- **The app's Work page.** "2 cases are waiting for a person to decide." / "Somebody starts each case
  here when it is needed." Stats named `HANDLED`, `WAITING ON A PERSON`, `COULD NOT FINISH`,
  `NEEDED A PERSON`. This is the register the whole product should be in.
- **The ROI panel labels every number `actual` or `estimate`** and says outright that estimates are
  yours to set and "never presented as measured facts". That is the honesty bar, met.
- **Check names** are written for a person: "No personal data in the output".
- **The builder's step list** ("The process we carved from your description") and the trigger picker
  ("On demand — a person runs it from a form") read plainly.
- **Refusals present as refusals**: "This account can explore the Builder but cannot make changes."

---

## The order I would fix them

1. **Put their work where they look** — apps (and what's waiting) in `Work`, not only under Solutions.
2. **Waiting-work on the apps list**, plus published state per card.
3. **A recommendation on the case row**, and make the row open the case.
4. **A failure sentence in business language** at the top of a failed run, before any JSON.
5. **Last result per check** on Quality, plus one overall "is this app OK" verdict.
6. **Rupees, formatted** — and "not measured" instead of `$0.00`.
7. **Strip engine metric ids** from the check subtitles.
8. **Split working time from waiting time** so `USUALLY TAKES` can be filled.
9. **A "this was wrong" control** where the answer is read.
10. **De-jargon the two headers**; clean the duplicate demo apps.

Items 1–5 are the ones that decide whether this persona can work unaided.
