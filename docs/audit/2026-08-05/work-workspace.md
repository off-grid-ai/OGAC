# Audit — Work + Workspace, judged as a CONFERENCE DEMO

Date: 2026-08-05 · Lens: **demo readiness** (DEMO-BLOCKER / DEMO-RISK / POST-DEMO), not production hardening.
Scope: `src/app/(console)/work/**`, `src/app/(console)/workspace/**`, the decision surfaces they link to
(`/solutions/apps/[id]/runs/[runId]`, `/solutions/reviews`) and the libs behind them.

The section matters because the human-in-the-loop moment is the most persuasive thing on stage:
*"the AI did the work, a person approved it, and here is the record."* Every finding below is tied to a
screen, a click, or a projected image.

Evidence: screenshots in `/tmp/audit/work/` and `/tmp/audit/work2/`; live reads against the shared dev
server at `127.0.0.1:3005` as `dev@offgrid.local` (admin).

**Verdict for the demo:** the human-in-the-loop story is *showable* — `/work/tasks` → `/solutions/reviews/<runId>`
is a genuinely good two-screen narrative — but not stage-ready as it stands. Three things would cost him
the room: the queue's own count contradicts itself (9 vs 5) on the first screen, the approval panel on the
app he'd naturally open asks the audience to approve an empty output, and every amount on an Indian BFSI
demo is printed in **US dollars** ("Approve $1,200,000 … for Arjun Pillai"). All three are seed-data or
one-line copy fixes, not rebuilds. The payoff beat ("here is the record") currently has no data behind it:
**0 of 38 runs on this deployment has a recorded reviewer.**

## Coverage so far
- SHOT + JUDGED: `/work` (`work.png`), `/work/tasks` (`work_tasks.png`), `/work/projects`
  (`work_projects.png`), `/work/chat`, `/work/artifacts`, the decision screen
  `/solutions/apps/app_bdd24eab/runs/seedrun_reimb_04` (top + scrolled: `decision_scroll1.png`),
  an orphaned run URL (`…app_d9f008e3…` → full-page 404), `/solutions/reviews` + its detail (in flight).
- LIVE DATA: `/api/v1/admin/my-work/count`, `/api/v1/admin/app-runs?limit=200` (38 runs),
  `/api/v1/admin/apps/review-inbox`.
- READ: `work/tasks/page.tsx`, `work/page.tsx`, `my-work-reader.ts`, `my-work.ts`, `review-inbox.ts`,
  `review-risk.ts`, `app-run-store.ts`, `apps/runs/[id]/review/route.ts`, `bulk-review/route.ts`,
  `CaseDecision.tsx`, `BulkDecideBar.tsx`, `build/review/page.tsx`, `money.ts`, `ownership.ts`.
- NOT covered: `/work/files`, `/work/prompts*`, `/workspace/knowledge`, `/workspace/storage`, chat
  detail conversation, artifact `[id]/view`.

---

## DEMO-BLOCKERS

### D1 — The same queue reports two different sizes on two screens under the same nav item: 9 and 5.
Screens: `/work` (`work.png`), `/work/tasks` (`work_tasks.png`), sidebar badge (both).

| what the audience sees | value |
|---|---|
| sidebar badge, every page | `My tasks 9` |
| `/work` tile "WAITING ON YOU" | **9** |
| `/work/tasks` headline | **"5 cases are waiting for you to decide."** |

Confirmed live: `GET /api/v1/admin/my-work/count` → `{"available":true,"waiting":9,"oldestDays":30}`,
while the page lists 5 across 4 app cards. Cause: 4 of the 9 `awaiting_human` runs belong to app ids
`listApps` no longer returns (`eyat_reimbursement_553aa949`, `…_91689e1f` → `app_d9f008e3`;
`…_8cb6f3a9`, `…_c3f9f616` → `app_4108cf57`), and the queue drops them
(`src/lib/my-work-reader.ts:44-46`) while the badge and the `/work` tile count them
(`src/app/api/v1/admin/my-work/count/route.ts:34`; `src/app/(console)/work/page.tsx:32-34`).
A CISO in row 3 reads a badge of 9 against a headline of 5 faster than anything else on the slide.
**Cheapest fix: delete those 4 orphan runs from the demo data** (no code change), or apply the same
app filter in the count route.

### D2 — The approval panel asks the audience to approve *nothing*: "PENDING OUTPUT — (no output produced at this step)".
Screen: `/solutions/apps/app_bdd24eab/runs/seedrun_reimb_04` (`decision_scroll1.png`), the payoff screen.

The whole story is "the AI did the work, a person approves it". On the app he would most likely open
(Reimbursement Approval, the top card of the queue), the decision panel's PENDING OUTPUT box reads
literally `(no output produced at this step)`. There is nothing to read, nothing to edit, no
recommendation, no draft letter — just Approve / Reject over an empty box. The first question from the
floor is "approve what?" and there is no answer on screen.
Fix is seed data, not code: the demo run's review step needs a drafted output (a recommendation
sentence + the amount) so the panel shows the AI's work.

### D3 — Money is rendered three different ways, two of them wrong for an Indian BFSI story, on the screens with the amounts.
Screens: `/work/tasks`, the decision screen, `/solutions/reviews`.

- Queue row: `Amount: ₹63,000` (correct — via `formatMoney`, `DEFAULT_CURRENCY='INR'`, `src/lib/money.ts:14`).
- Same case's decision screen: `Quota $40,000 — exceeded`, `Over quota by $23,000`, and
  `This decision covers 63,000.` — **USD symbols and a bare unlabelled number for the amount being
  approved.** The bare one comes from `group()` in `src/lib/review-risk.ts:53-57`, used at `:93`, which
  strips the currency entirely.
- Reviews inbox, live: `"question":"Approve $1,200,000 — Personal Loan Underwriting Assist for Arjun
  Pillai?"` — `formatAmount` (`src/lib/review-inbox.ts:170-180`) hardcodes `en-US` + `currency:'USD'`,
  so a ₹12,00,000 personal loan is projected as **$1,200,000**. Wrong currency AND western grouping on
  the sentence that is the single best line of copy in the section.

A prospect who knows the market spots `$1,200,000` for an Indian personal loan instantly. Fix: route all
three through `formatMoney` (already exists, already INR, already does Indian grouping).

### D4 — The officer's decision screen is the app-BUILDER's screen: "Draft — check it, then publish", "Duplicate this app", "Publish as template", `2/3 steps`, `version not recorded`, `seedrun_reimb_04`.
Screen: the decision screen, top (`solutions_apps_app_bdd24eab_runs_seedrun_reimb_04.png`).

Everything above the decision, projected, on the screen where a claims officer decides ₹63,000:
- amber pill top-right **"Draft — check it, then publish"** (he would be demoing an unpublished app),
- **"Duplicate this app"** and **"Publish as template"** buttons,
- breadcrumb `Apps / Reimbursement Approval` + subtitle *"Watch runs execute, step by step"*,
- header line `Run seedrun_reimb_04 · 2/3 steps · started 7/5/2026, 5:58:41 PM · version not recorded ·
  policy version not recorded`,
- step-kind chips `data`, `reasoning`, `review`.

`seedrun_…` announces the data is seeded; `version not recorded · policy version not recorded` reads as
two missing fields on a governance product; the builder buttons say "this is a dev tool", not "this is
the officer's queue". All of it is copy/visibility, not architecture.

### D5 — Grammar and thin evidence in the confidence panel, at projector size: "All 1 source were read and narrowed to this case."
Screen: the decision screen, RISK/CONFIDENCE band.

`src/lib/review-risk.ts:127-130` builds `All ${n} source${n===1?'':'s'} were read…` — the plural is
applied to "source" but not to "were", so a single-source run projects **"All 1 source were read"**.
Beside it: **"RISK LOW — Nothing is sent or changed after this decision — it is recorded only."**
(`review-risk.ts:90`). It is *honest* — this seeded app has no action step — but on stage it tells the
room that approving does nothing, directly contradicting the pitch. Demo the app whose approval
*does* something, or add an action/output step to this one.

### D6 — `/work` opens on three zeros, and `/work/projects` is a big empty box.
Screens: `work.png`, `work_projects.png`.

- `/work` "Where things stand": `PROJECTS 0`, `CONVERSATIONS 0`, `ARTIFACTS 0` — three of the four
  tiles on the section's landing page. (They are per-USER reads: `listProjects(userId, orgId)` etc.,
  `src/app/(console)/work/page.tsx:16-22`, so whichever account he presents with will show 0 unless it
  personally has projects/chats/artifacts.)
- `/work/projects`: a single outlined card, "No projects yet", ~85% of a 1600px-wide screen empty with a
  small grey centred paragraph. Same shape expected on `/work/artifacts` and `/work/chat` for a fresh
  account.

Per the lens this is worse on stage than a small bug: the section looks unused. Cheapest fix: seed 2-3
projects, a couple of conversations and one saved artifact **on the demo account he signs in with**.

---

## DEMO-RISKS

### D7 — There is no "here is the record" to show after the decision: **0 of 38 runs on this deployment has a recorded reviewer.**
Live: `/api/v1/admin/app-runs?limit=200` → 38 runs (`done:16, error:11, awaiting_human:9, running:2`);
filtering steps for a `reviewer` field yields **0**. So the payoff shot — "a person approved it, here is
who and when" — cannot be shown from existing data; he must approve live and hope. And there is no
history surface to open afterwards: the nav describes Reviews as *"Human approvals, exceptions, and
**decision history**"* (`src/modules/ownership.ts:276-282`) but `build/review/page.tsx` (155 lines,
re-exported at `/solutions/reviews`) renders **only the pending inbox** — no decided/history list at
all. Fix: seed 2-3 already-decided runs (reviewer email + note + timestamp on the step) so the
"and here is the record" beat has a screen.

### D8 — Two different review queues, both in the sidebar, with different content and different quality of copy.
- Work → **My tasks** (`/work/tasks`): grouped by app, ages, SLA colouring; rows link to the *builder*
  run screen (D4). Shows every `awaiting_human` run in the org — `readMyWork(orgId, now)` takes no
  caller (`src/lib/my-work-reader.ts:29`), so nothing is scoped to the viewer despite "waiting for
  **you**".
- Solutions → **Reviews** (`/solutions/reviews`): the better surface — "Approve ₹X — App for Person?"
  lines, `Awaiting you / You can approve / Above your limit` band, authority-aware — but buried under a
  section named for building, and it prints USD (D3).

One click off-script between the two and the audience sees two inboxes that disagree about the same
work. Pick ONE for the demo and stay in it.

### D9 — Approve/Reject sit inline on the queue rows with no statement of what approving will do and no undo.
`src/components/build/CaseDecision.tsx:146-159` posts the decision straight from the list row; the only
statement of consequence is the toast *after* the click (`:57-62`). The obvious floor question — "what
happens when she presses Approve?" — has no on-screen answer, even though
`planActionImpact` (`src/lib/action-contract.ts:184-212`) already produces exactly that sentence
("… for X. Nothing has been changed." + side-effects + egress), and the **bulk** bar already does the
right thing (`describeBatch`, `BulkDecideBar.tsx:76`). Rejecting takes one click and no reason, while
"This was wrong" demands one — the silent destructive path is the easiest.

### D10 — An amber warning banner sits at the top of the queue announcing a configuration gap: "No decision target is set for 4 processes, so nothing will ever flag as late."
Screen: `work_tasks.png`, directly under the headline, full width, amber.
Also on the same screen: **"Nobody is marked away."** in the "Who is covering" panel and, on every app
card, **"Oldest has been waiting 30 days — nobody has picked this up."** Each is individually honest and
well written, but together the first thing the room reads about the product's own demo tenant is:
no targets, nobody covering, nothing picked up for a month. Set an SLA target on the 4 demo apps and
back-date the waiting timestamps to hours/days, and the same page becomes a working queue instead of a
neglected one.

### D11 — Demo-data credibility on the surfaces he would show.
- `Invoice: INV-1 $200` as a live queue row (`work_tasks.png`, Reimbursement Approval card) — a
  test-looking invoice with a USD amount inside an INR tenant, sitting next to the credible
  `Amount: ₹63,000 · Category: Client-Entertainment`.
- Field-key labels leak into row titles: **`Foir: 47`**, **`Pan: ABCPD1234K`** — raw payload keys,
  wrong-cased acronyms (FOIR, PAN). Also a full PAN in a list view, which a compliance-minded viewer
  will notice on a privacy product.
- The runs data contains `app_sched_probe` / `appsched_app_sched_probe_579a2858…` and 11 of 38 runs are
  `error` — anything that lists runs (Solutions → Apps → History) will show a third of the list red and
  a probe app. Off-script click risk.

### D12 — Off-script URLs in this section dead-end into a bare full-page 404 with no console shell.
`/solutions/apps/app_d9f008e3/runs/eyat_reimbursement_553aa949` (one of the 4 orphan cases the badge
counts) renders a centred **"Page not found — That route doesn't exist, or the module isn't enabled for
this deployment."** with the sidebar gone (`solutions_apps_app_d9f008e3_runs_eyat_reimbursement_553aa949.png`).
`/workspace` itself is also a 404 (`/tmp/audit/work/report.json`), while `/workspace/chat`,
`/workspace/projects` redirect to their `/work/*` twins — so half of the `workspace/**` URLs work and the
parent does not. Losing the shell makes it look like the app crashed rather than a missing record.

### D13 — On the best decision screen in the product, the trust panel says the answer is UNCHECKED.
Screen: `/solutions/reviews/seedrun_reimb_04` (`review_detail.png`), top-right, beside the amount.

> **Trust checks — Faithful to sources: `Not scored`.** *"Not scored — grounding was not measured for
> this run, so treat the answer as unchecked rather than as verified."*
> *"No guardrail findings recorded for this draft."*

It is admirably honest engineering and terrible on a stage: the governance product's own trust panel, in
the highest-attention corner of the payoff screen, tells the room the AI's answer is unchecked and that
no guardrail result exists. Both lines are absence-of-evidence, and both are fixable in the demo data by
running these cases through a scored pipeline (or by demoing a case that HAS a grounding score and a
guardrail pass).

### D14 — "Why this needs you" answers with configuration, not a business reason; and 3 of 5 queue cards degenerate into "Approve <app name>?"
Screens: `reviews.png`, `review_detail.png`.

- Detail: **"WHY THIS NEEDS YOU — This step is configured to require a person to sign off before the run
  continues."** Circular and config-flavoured. The better sentence already exists on the other surface
  for the same case (step detail: *"Exceeds quota — needs L2 sign-off"*). "Why did it come to her?" is the
  most likely question from the floor.
- Inbox cards: with no amount and no requester in the payload the question collapses to the app's own
  name — **"Approve Reimbursement Approval?"** and **"Approve Motor Claim FNOL Triage?"**
  (`src/lib/review-inbox.ts:232-239`), and those two cards are visibly empty below the title (just a
  timestamp). 3 of the 5 cards on the strongest screen in the section read as nonsense or as blanks.
- Where a requester IS present it is the *customer* (`REQUESTER_KEYS` falls back to
  `customer`/`applicant`, `review-inbox.ts:186-198`), so the card says
  *"Approve $1,200,000 — … for Arjun Pillai"* and then *"by Arjun Pillai"* — the same person as both
  subject and requester.
- Also on both screens: US-format timestamps (`7/6/2026, 5:58:41 PM`) on an Indian BFSI demo, where the
  queue page's relative ages ("waiting 30 days") read far better at distance.

### D15 — The decision detail leaves ~60% of a 1600px screen empty and puts Approve in a narrow right rail.
Screen: `review_detail.png`. The left column holds one short "What the app recommends" card and then
stops; the whole decision — reason box, escalate-to, Reject/Escalate/Approve — is stacked inside a
narrow right-hand column, so the buttons the story depends on are small and bottom-right on the
projection. This is the repo's stated worst design defect (wasted real estate) on the section's most
important screen. Fix is layout-only: give the recommendation the width, and put the three actions on a
full-width action bar under it.

### D16 — The decision screen throws a hydration error, which on the dev server he presents from shows a red "1 Issue" badge on screen.
Screen: `/solutions/apps/app_bdd24eab/runs/seedrun_reimb_04`. Captured by the harness:
`pageerror: Error: Hydration failed because the server rendered text didn't match the client…`
(`/tmp/audit/work2/report.json`), and the resulting **red "1 Issue" pill is visible bottom-left in
`solutions_apps_app_bdd24eab_runs_seedrun_reimb_04.png`**. Almost certainly the unlocalised timestamp
rendered on both sides: `new Date(run.startedAt).toLocaleString()` with no locale argument
(`src/components/build/AppRunStatus.tsx:182`) formats per server vs browser locale/timezone — the exact
trap `src/lib/my-work.ts:79-82` documents avoiding ("formatted explicitly, NOT via toLocaleString").
Two consequences on stage: the red issue badge (if presenting from `next dev`, which is the house
workflow), and a visible text change on that line just after load. `review/page.tsx:119` and
`ReviewDecision.tsx:233` pass `'en-US'`, which fixes the mismatch but gives US dates on an Indian demo.

---

## Demo readiness

### The story (strongest 2-minute human-in-the-loop demo)
1. **`/work/tasks`** — "this is what needs a person today, oldest first, across every app." Strong
   screen: grouped by process, plain language, ages. Fix D1/D10/D11 first or it reads as a neglected
   queue with a contradicted count.
2. **Open the top case** — today that lands on the builder run screen (D4). Instead, show
   **`/solutions/reviews/seedrun_reimb_04`** (screenshot `review_detail.png`): "Approve … —
   Reimbursement Approval?", "What the app recommends", "The request" (Amount / Category / Employee
   Anjali Nair), "Why this needs you", and Reject / Escalate / **Approve** with a reason box. This is the
   best-composed screen in the section — it needs D3 (currency), D13 (trust panel), D14 (why-this-needs-you)
   and D15 (layout) to be stage-ready. **Verified reachable:** `/solutions/reviews/<runId>` renders for
   the seeded cases.
   If there is time for one code change in this section, point the `/work/tasks` row at this route
   instead of the builder run page (`src/lib/my-work-reader.ts:52` builds the `href`).
3. **Decide** — approve with a note ("checked against policy, within limit"). The note is the beat that
   sells the learning loop: the product turns it into a test the app is measured against.
4. **Show the record** — needs D7 fixed (seeded decided runs, or a decided-history list). Without it the
   story ends at "she pressed the button" with nothing to show.

### What to avoid on stage
- Do **not** open `/work/projects`, `/work/artifacts`, `/work/chat` on a fresh account (D6) — they are
  empty boxes.
- Do **not** linger on the run-detail header (D4: "Draft — check it, then publish", `seedrun_…`,
  "version not recorded") and do not read the RISK panel aloud (D5: "Nothing is sent or changed").
- Do **not** show both queues (D8), and do not open Solutions → Apps → History (11 red `error` runs +
  a `probe` app, D11).
- Do **not** compare the sidebar badge with the queue headline (D1).

### Cheapest wins, ranked (all seed data or copy — no refactors)
1. **Delete the 4 orphaned `eyat_reimbursement_*` runs** (their apps are gone) → the badge, the `/work`
   tile and the queue headline all agree at 5. Data-only, kills D1.
2. **Seed the demo runs properly**: a drafted output on the awaiting review step (kills D2), an INR
   amount in the step text instead of `$40,000`/`$23,000`, waiting ages in hours/days not 30 days, an
   SLA target on the 4 demo apps (kills most of D10), and 2-3 **already-decided** runs with a reviewer
   email + note (kills D7). Drop `INV-1 $200`, `Foir: 47`, and the bare PAN row (D11).
3. **One-line currency fix**: `formatAmount` (`review-inbox.ts:170`) and `group` (`review-risk.ts:53`)
   both go through `formatMoney` from `src/lib/money.ts` → `₹12,00,000`, `₹63,000` everywhere (D3).
4. **Publish the demo app and hide builder chrome on the run screen** — the "Draft — check it, then
   publish" pill, "Duplicate this app", "Publish as template" (D4). Publishing the app is a click; the
   two buttons are a conditional render.
5. **Fix "All 1 source were read"** → `was read` (D5, one ternary), and seed 2 projects + 1 conversation
   + 1 artifact on the presenting account (D6).
6. **Give the two amount-less cases an amount + a requester** so the Reviews cards stop reading
   "Approve Reimbursement Approval?" (D14), and replace "Why this needs you" with the business reason
   already present on the step ("Exceeds quota — needs L2 sign-off").

### Screens judged as projected images (what reads well at distance today)
- **Good:** `/solutions/reviews` — large headline questions, "You can approve" badges, a 4-tile band;
  `/work/tasks` — grouped cards, large app titles, red/amber ages.
- **Poor at distance:** the run-detail decision panel (small mono step chips, grey secondary text,
  `(no output produced at this step)`), the review detail's narrow right rail (D15), and every empty
  state under `/work/*` (a small grey centred paragraph in a huge outlined box).

---

## Out of scope for the demo (real, but invisible on stage)
- **Race / double-decision:** `persistAppRun` upserts with no status precondition
  (`src/lib/app-run-store.ts:108-124`) while `canReview` is a read-then-write — two reviewers can both
  approve one case and the downstream steps run twice. `escalateAppRun:183` and
  `markAppRunCancelled:152` do guard on status; the review path does not.
- **Self-approval:** `app_runs` has no requester/startedBy column (`src/db/schema.ts:1087-1130`) and
  `evaluateAppAccess`/`evaluateApprovalAuthority` (`src/lib/app-access-policy.ts:192-296`) never compare
  approver to maker; `grep -rni "self-approv|separation of dut|four.eyes" src/` → 0 hits. The displayed
  "requested by" is scraped from the run *input* (`review-inbox.ts:186-198` falls back to
  `customer`/`applicant`), i.e. self-asserted payload, not an authenticated identity.
- **Audit ledger cannot say which way a decision went:** approve and reject both write
  `action:'app.run.review', outcome:'ok'` (`apps/runs/[id]/review/route.ts:236-240`) and
  `AuditEventInput` has no details field (`src/lib/audit-event.ts:132-145`).
- **Failure presents as emptiness on the queue:** `readMyWork` computes a `complete` flag precisely to
  stop this (`src/lib/my-work-reader.ts:22-27`) and `/work/tasks:42` discards it — a failed read renders
  a green tick and *"Nothing is waiting for a decision right now."* (`work/tasks/page.tsx:206-215`).
  `/work` and the badge route both honour it, so the flagship queue page is the outlier.
- **A failed SLA-rule read silently reclassifies every case as "no promise"** (`work/tasks/page.tsx:51`
  `.catch(() => ({}))`) — banner, per-case badges and the priority sort all quietly disappear.
- **Bulk review on a failed read**: `listAppRuns(...).catch(() => [])`
  (`bulk-review/route.ts:50`) makes every candidate look "no longer awaiting a decision".
- Duplicate live routes (`/work/*` re-export `/workspace/*` implementations) mean two canonical URLs per
  surface.
