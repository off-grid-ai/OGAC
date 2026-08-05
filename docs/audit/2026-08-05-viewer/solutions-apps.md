# Solutions / Apps / Builder / Templates / Quality — viewer-demo audit

Accounts confirmed by harness: insurer = demo-insurer@getoffgridai.co, role viewer, org org_suraksha
(Suraksha Life) at suraksha-onprem-console.getoffgridai.co. bank = demo-bank@getoffgridai.co, role
viewer, org org_bharat (Bharat Union Bank) at bharatunion-onprem-console.getoffgridai.co.

Reference app audited end-to-end: **Death-Claim Assessment** (app_14940314, insurer) and
**Reimbursement Approval** (bhapp_reimb, bank). Both are decision-queue shaped, populated, with real
waiting cases and real completed history.

## Verdict for this section

This section is the strongest evidence in the console that Off Grid AI **does something**, not just
governs something — real named apps, real waiting cases with real INR amounts, a builder that reads as
genuine plain language, an honest quality tab that states what a number means, and (on the bank
tenant) a real downloadable PDF with a real decision. **But the insurer tenant's flagship app — the
first one on the list, the one leading the whole Apps page — fails its own core promise on the first
obvious click**: opening either of its "waiting for a decision" cases shows no AI output to approve,
its PDF reports all say "no final outcome recorded," and its deployed public page makes a false
governance claim ("no AI calls have been recorded ... yet") about an app that has run six times. A
stranger who happens to click the bank tenant first will be convinced; a stranger who clicks the
insurer tenant first will conclude the product doesn't actually decide anything. Layered on top is a
systemic, repeated pattern of admin/write buttons (Duplicate, Unpublish, Edit variables, Terminate,
Save policy, Run eval) that are fully armed for a read-only viewer and 403 with a bare word
("forbidden") instead of being visibly disabled — the exact top-severity failure mode the brief warns
about, and it recurs at least six times across one app's tabs. None of this is unfixable; most of it is
seed-data and copy, and the one real bug (the insurer app's missing outcome) has a working reference
implementation one tenant over to copy from.

## BLOCKERS (cheapest first)

1. **Duplicate seed cases undercut believability on the bank's deployed app.** `/app/bh-reimbursement`
   — 6 of 12 "waiting for you" rows are the identical "Meera Malhotra · ₹41,346.44 · 2025-09-16" case at
   different timestamps; two more rows are the same "Vikram Desai" case with inconsistent currency
   formatting ("16107" vs "₹16,107"). `bank/app_bh-reimbursement.png`. Fix: de-duplicate/cap the seed
   script, fix the formatter.
2. **Ownership-debris banners on both tenants' flagship apps** — "viewer@suraksha.demo owns this but no
   longer has an account here. It is effectively unowned" (insurer) / "priya.sharma@bharatunion.example
   owns this and has never signed in. An owner who never logs in is a name, not an owner" (bank).
   `insurer/solutions_apps_app_14940314.png`, `bank/solutions_apps_bhapp_reimb.png`. Fix: seed a real,
   current owner for every demo app.
3. **Bare, raw-looking error toasts on every blocked write** — "forbidden" (Duplicate/Terminate),
   "unpublish failed (403)". `insurer/after-duplicate-click.png`, `insurer/after-terminate-accept.png`.
   Fix: one shared error string ("Read-only demo — sign in with a full account to do this").
4. **The agent's own instructions still say dollars while every case is in rupees.** Step 3 of
   Death-Claim Assessment: "...Amounts in $." vs. the app's own summary: "Amounts in rupees (₹)."
   `insurer/build-part_1.png`. Fix: extend the existing currency-copy script to `instructions`, not just
   `summary`.
5. **"Fix setup" is a dead link** — every one of the Build tab's "not available with your access" lines
   links to `/solutions/apps` (the list you're already on), not to anything that fixes access.
   `insurer/build-part_0.png`. Fix: remove the link or point it at the actual access-request/Access tab.
6. **Review-tab cards show a raw run id where a case name belongs** — "`ar_72741af7523b`" instead of
   "Death claim assessment — nominee Vikram Desai, ₹72,50,000." `insurer/solutions_apps_app_14940314_review.png`.
   Fix: reuse the case-title formatter already used on Work/Runs.
7. **Six-plus armed write buttons 403 for a viewer instead of being visibly disabled** — "Duplicate this
   app," "Edit variables" -> "Update template," "Unpublish," "Terminate" (Runs), "Save policy" (Access),
   "Run" (an eval, Quality tab). All fully clickable-looking (`pointer-events: auto`, no dimming), none
   carrying the tooltip that the SAME app's Approve/Reject and the Forge builder's "Save and open"
   correctly have. `insurer/after-duplicate-click.png`, `insurer/after-terminate-accept.png`,
   `bank/after-run-eval-click.png`. Fix: wrap the shared app-toolbar (fixes 3 at once) and the
   remaining per-tab action buttons in the existing `ReadOnlyGuard`/`useViewerMode()` — the pattern is
   already proven correct on Approve/Reject and on Forge's "Save and open."
8. **The insurer's flagship app never records an outcome — the single most damaging finding.** Opening
   either of Death-Claim Assessment's two "waiting for a decision" cases shows "PENDING OUTPUT: (no
   output produced at this step)" (`insurer/rundetail-part_1.png`, confirmed on both waiting runs);
   every one of its PDF reports says "Final outcome: (no final outcome recorded)" despite "Status:
   Done" (`insurer/sample-run.pdf`, `insurer/ar_727418f7523b.pdf`); and its deployed public page states
   "No AI calls have been recorded for this app yet" (`insurer/app_death-claim-assessment-ef9759.png`)
   though six-plus runs have a completed "Assess claim risk (agent)" step. The bank's Reimbursement
   Approval app does all three of these correctly (`bank/apprun_9ba6a45d.pdf`, `bank/app_bh-reimbursement.png`)
   — treat all three insurer symptoms as one bug with a working reference implementation one tenant
   over, not three separate ones.

## RISKS

- Input tab's "Run for real"/"Rehearse it" are correctly disabled but give no explanatory tooltip on
  hover (unlike Approve/Reject) — `insurer/runforreal-hover.png`.
- Build tab shows a green "Everything is wired. You're ready to save" banner directly above a wall of
  "0 ready, 26 unavailable... Fix setup" per-field access warnings — self-contradicting on first read.
  `insurer/build-full.png`, `insurer/build-part_0.png`.
- App-detail step sequence shows the output step (6) as "Done" while the human step (5) still says
  "Awaiting review" on the insurer app — reads as finishing before deciding. Confirmed NOT present on
  the bank app's equivalent run (output step correctly shows "Queued"). Likely same root cause as
  BLOCKER 8.
- PDF reports (even the bank's good one) print raw connector/domain/agent ids and the literal internal
  word "SHADOW" alongside an otherwise clean plain-language "Final outcome." `bank/apprun_9ba6a45d.pdf`.
- Dashboard tab duplicates the Work tab's 5 stat tiles with a mostly-empty 1600px page below — lower
  severity because it isn't linked from the app's own nav. `insurer/solutions_apps_app_14940314_dashboard.png`.
- Top-level Reviews queue shows all-zero ("You're all caught up") on both tenants, immediately next to
  an Apps list showing cases waiting — technically correct (personal queue vs. org-wide) but unexplained.
  `insurer/solutions_reviews.png`.
- Review, History and Templates tabs are each 1-2 small cards on an otherwise empty 1600px page — the
  console's most repeated width/gutter defect, recurring here.
- "Safety" tab (route `/controls`) states "Runs are LIVE: side-effecting steps will act for real,"
  which reads as in tension with the documented global egress kill-switch.

## Appropriateness findings

- Ownership-debris banners (BLOCKER 2) name real-looking but fictional emails
  (`viewer@suraksha.demo`, `priya.sharma@bharatunion.example`) — acceptable as fiction, but the framing
  ("effectively unowned," "a name, not an owner") reads as a broken record to a stranger, which is the
  actual issue.
- PDF reports and run-detail "Context so far" panels show raw connector/domain/agent ids
  (`con_f5c959`, `dom_7d17b157-0e6`, `agent_f9eae5d6`) and the internal-only word "SHADOW" — matches the
  brief's "raw uuids/internal infrastructure where a name belongs" flag.
- No cross-tenant data leakage found: every screen checked showed only its own org's data (org_suraksha
  vs org_bharat), confirmed by the harness's printed role/org on every run.
- No credentials, secrets, or connection strings observed on-screen in this section (unlike the
  connectors API leak noted elsewhere in the brief).
- No OSS engine names on the face of any screen in this section; "pipeline," "grounded," "RAG," "prompt
  sent to the model" appear as secondary/collapsed/filter-chip language, not headline copy — matches
  known GAP 7 (language pass), not yet done, but not currently blocker-severity.

## What is genuinely strong here

- **The bank's Reimbursement Approval app is the best evidence of a working product in this whole
  audit**: a real waiting case shows "The AI says: Claim amount ₹41,346.44, Remaining quota ₹137,454.12,
  Headroom ₹96,107.68, Recommendation: within quota — approve" directly on the row
  (`bank/solutions_apps_bhapp_reimb.png`), and its run detail and downloadable PDF both carry the same
  real decision through to a human approval (`bank/rundetail-part_1.png`, `bank/apprun_9ba6a45d.pdf`).
- The GAP-0 fix is live and excellent: "Start a case" is a picker of real named people, not a free-text
  box (`insurer/solutions_apps_app_14940314_input.png`).
- The Reports tab's honesty about unmeasured numbers ("Time per case: Not Measured," never a fabricated
  ₹0.00) and clearly-labelled estimate-vs-actual ROI figures is a model for the whole console.
  `insurer/reports-part_1.png`.
- The Quality tab's "None of the 6 finished cases have been scored, so nothing is known about quality
  on real work" is honest, plain-language, and exactly answers "does a number mean something" — no bare
  percentages anywhere. `insurer/solutions_apps_app_14940314_quality.png`. The bank app's Quality tab
  shows the positive case working: "Scored 100% on average across 1 real case... 1 of 3 checks did not
  pass when last run." `bank/solutions_apps_bhapp_reimb_quality.png`.
- The deployed public app's "What protects this" panel is excellent, plain-language governed-AI copy
  ("Personal details are hidden before the AI sees them — ALWAYS ON," "A person decides, not the app")
  with zero jargon, on BOTH tenants. `bank/app_bh-reimbursement.png`.
- The Forge chat builder (`/solutions/apps/new`) is the best-behaved read-only surface found anywhere in
  this audit: pure plain-language example prompts, and its one write control ("Save and open") is
  genuinely, visibly disabled with an explanation — the reference implementation the rest of the
  section's write-buttons should be made to match. `insurer/solutions_apps_forge.png`.
- The RBAC/ABAC Access tab reads as real plain-language org-tree access control, matching the founder's
  "its own RBAC" requirement. `insurer/solutions_apps_app_14940314_access.png`.

## LATER

- Run ids use at least three different formats across one app's own run history (`ar_...`,
  `apprun_...`, `bhrun_...`) — cosmetic inconsistency, no visible symptom beyond looking untidy in a
  table.
- Cron syntax ("0 9 * * 1") is shown directly in the Schedule tab alongside plain-language presets —
  low severity since presets are the primary path.
- Confirm dialogs (Terminate, Unpublish) surface raw run ids in their message text.
- `/solutions/quality/evaluators` category filter chips use unexplained ML jargon ("RAG," "Agentic").


## IN PROGRESS — writing as I go

### /solutions (both tenants) — solutions.png / bank/solutions.png
Strong. "Turn high-value processes into governed AI", explains Blueprint -> App -> Deployment chain in
plain language, names the missing precondition ("No App currently satisfies a blueprint contract...")
instead of a blank list. Full width used well. Insurer shows "Blueprints ready to deploy 0 of 3" in a
red-outlined card — reads alarming on first glance but the explanatory text under it defuses it. RISK,
not blocker.

### /solutions/apps (both tenants) — solutions_apps.png
Populated on BOTH tenants with named, believable apps:
- Insurer: Death-Claim Assessment (2 waiting), Policy Underwriting Assist (2 waiting), Renewal &
  Persistency Nudge (job-shaped).
- Bank: Reimbursement Approval (12 waiting), KYC & Re-KYC Verification (5 waiting), Personal Loan
  Underwriting (2 waiting).
Plain language throughout, no OSS names, no raw ids on the card face. Genuinely strong — this is the
screen that answers "does it do something."

### /solutions/apps/app_14940314 (Death-Claim Assessment work/overview tab) — solutions_apps_app_14940314.png
Rich, believable: "2 cases are waiting for a person to decide", real INR sums assured, named nominees,
a "Recently handled" feed with real completion timestamps and a provenance trail ("read 2 sources ·
passed a safety check · AI assessed it · a person decided · produced a result · signed and
tamper-evident"). This is genuinely the strongest screen found so far in this section.

**BLOCKER — three top-of-page controls are fully armed for a read-only viewer and 403 with no
disabled state, only after the click:**
- "Duplicate this app" -> `POST .../clone` -> 403, toast just says **"forbidden"** (lowercase, no
  context, looks like a raw server string, not a product message).
- "Edit variables" -> opens a real, fully-interactive "Publish as a reusable SOP template" modal
  (radio buttons, an "Add variable" affordance, an "Update template" button) with no read-only notice
  inside it -> submit -> `POST .../publish-as-template` -> 403.
- "Unpublish" -> native confirm dialog "Retract this app from the SOP library? The app itself is
  kept." -> accept -> `DELETE .../publish-as-template` -> 403, toast "unpublish failed (403)" (better
  worded than "forbidden" but still a bare HTTP-status toast) — and the button is left visibly greyed
  afterward, which looks like the app is now stuck/broken rather than merely refused.
  Screenshots: `insurer/after-duplicate-click.png`, `insurer/after-updatetemplate.png`,
  `insurer/after-unpublish-accept.png`.
  Contrast with the row-level **Approve/Reject** buttons on the same screen, which ARE correctly
  guarded: `pointer-events: none` and a tooltip on hover reading "Read-only demo. Sign in with a full
  account to make changes." (`insurer/approve-hover.png`). So the guard exists and works — it simply
  was not applied to the app-detail toolbar. Smallest fix: wrap these three buttons in the same
  `ReadOnlyGuard`/`useViewerMode()` treatment already used on the row actions.

**BLOCKER (appropriateness) — ownership-debris banner on the face of the screen:**
"viewer@suraksha.demo owns this but no longer has an account here. It is effectively unowned. Change
who owns it" — an orange banner sitting directly under the app title. To a stranger this reads as a
broken/orphaned record ("no longer has an account"), not a governed feature. It is also itself a write
affordance ("Change who owns it") that will 403 for a viewer, same class as above. Smallest fix: seed
a real, current owner for every demo app so this banner has nothing to say on the demo tenants, or
suppress the banner entirely for viewer sessions.

**RISK** — "No recommendation was recorded — open the case to see the evidence" appears on BOTH
waiting cases verbatim. Reads like a canned/templated line rather than a per-case fact; worth checking
the full case view resolves this (see below).

### /solutions/apps/app_14940314/build — solutions_apps_app_14940314_build.png, build-part_0/1.png
This is the BUILDER for the reference app, on the demo path in 3 clicks. Mostly plain language and
well laid out (a "steps" list left, a "Name & describe" / triggers / who-can-use / "Runs on" panel
right, full width used, no JSON, no node graph, no model name visible). But:

**BLOCKER — the screen tells the viewer two opposite things at once.** A green banner reads
"Everything is wired. You're ready to save." three rows below a strip that reads "**0** ready **26**
unavailable **9** not shown by access", and every single step underneath shows its data source as
"(Not available with your access)" with "No governed options are ready to use" and three lines of
"This account can explore the Builder but cannot make changes. Fix setup" per step (repeated
identically for `claim documents`, `advisors`, `candidates`, `premiums`, etc. — same sentence 6+ times
on one screen). A stranger reading top-to-bottom sees "ready to save" then, one screen-height later, a
wall of "not available" — the single most confidence-costing pattern possible on the screen that is
supposed to prove the AI actually built something. Smallest fix: either don't show the per-field
access-denial block when the app is already fully wired and running (it's confusing the viewer's lack
of write access with the app's own configuration state), or move the green "ready to save" banner so
it isn't read as contradicting the list right below it.

**BLOCKER — "Fix setup" is a dead link.** It goes to `/solutions/apps` (the apps list), not to
anything that fixes access. Clicking the one action offered for every "not available" line just
returns you to where you started — a stranger will conclude the control is broken.

**BLOCKER (data/currency) — the agent's own instructions contradict the app's own summary on the same
screen.** The app summary field reads "Amounts in rupees (₹)" but Step 3's live instructions text
(visible read-only, "Assess claim risk") reads: *"Cross-check the death claim against the policy
in-force date and premium history. Flag early-claim (within 3 years), non-disclosure or fraud-risk
indicators for investigation, else fast-track. **Amounts in $.**"* Every case elsewhere in this app is
denominated in INR (₹72,50,000 etc.) — so the instructions a stranger can read still say dollars. The
2026-07-29 currency fix (`scripts/fix-demo-currency-copy.mts`, referenced in APP_AS_PRODUCT.md) evidently
touched the display summary but not the underlying step instructions. Smallest fix: same script,
applied to `instructions` text, not just `summary`.

**LATER** — "grounded" (step 3, "inline agent · grounded", toggle "Answer only from knowledge
(grounded)") and "pipeline" (right panel: "Runs on... No pipeline (unbound)") are engine-flavoured
words a department reader would not use; matches known GAP 7 (language pass) in APP_AS_PRODUCT.md,
confirmed still visible on this screen.

### /solutions/apps/app_14940314/input — solutions_apps_app_14940314_input.png
This is the GAP-0 fix from APP_AS_PRODUCT.md, live and working well: "Start a case" is a picker of
real named claimants (Vivaan Naidu, Pari Kapoor, ...), not a free-text box; free text survives only as
a clearly secondary "Or describe it by hand" field, pre-filled with a real example. "What happens when
you run this" lists the app's own steps in plain language. Genuinely strong — this is the fix for the
founder's "why is this free text?" complaint, live and visible to a stranger.
"Rehearse it" / "Run for real" ARE correctly disabled for the viewer (native `disabled` attribute, no
network call fires) — but unlike the Approve/Reject buttons on Work, hovering produces **no tooltip**
explaining why. RISK: a stranger who tries the obvious "Run for real" button gets silence, not an
explanation. Smallest fix: reuse the same `ReadOnlyGuard` tooltip already written for Approve/Reject.

### /solutions/apps/app_14940314/runs — solutions_apps_app_14940314_runs.png
Good list -> detail pattern, real case names, real statuses, a run history back to 7/1. **BLOCKER —
same unguarded-write-button class as the toolbar above:** "Terminate" is fully armed, opens a native
confirm ("Force-terminate this run? ... Run ar_72741af7523b" — a raw run id in the dialog, minor), and
on accept -> `POST .../workflow` -> 403, toast **"forbidden"** again. Screenshot:
`insurer/after-terminate-accept.png`. Same fix as above: wire `ReadOnlyGuard` here too, and give the
403 toast a real sentence ("Read-only demo — sign in with a full account to do this") instead of the
bare word "forbidden", which reads like a raw HTTP status leaking onto the screen.

### /solutions/apps/app_14940314/review — solutions_apps_app_14940314_review.png
**BLOCKER (appropriateness)** — the two review cards are titled with nothing but the raw run id
(`ar_72741af7523b`) and the step name ("Claims committee review"). Every other screen in this app
(Work, Runs, Reports summary cards) names the case by claimant and amount — here, the one screen whose
whole job is "open one to approve or reject," a stranger sees a bare id where a name belongs. Smallest
fix: reuse the same case-title formatter the Work tab already has.
**RISK** — the page is two small cards on an otherwise empty 1600px-wide screen; a huge dead gutter
below. Not wrong, but reads thin next to the density of Work/Reports.

### /solutions/apps/app_14940314/reports — the most important screen in this whole section
`reports-part_1.png` (insurer), `bank/solutions_apps_bhapp_reimb_reports.png` +
`bank/reports-part_2.png` (bank). The stat tiles are a model for the "does a number mean something"
question the brief asks: "Time per case: Not Measured", "Cost: Not Measured" (not a fabricated ₹0),
and a clearly-labelled ROI block ("**estimate** 15 min saved / run" vs "**actual** gateway spend") that
never blends a real number with a guessed one. This is genuinely some of the strongest, most honest
quality-communication in the console.

**Every run has a downloadable, real, per-run PDF** ("PDF" link -> `GET
/api/v1/admin/app-runs/{id}/report?format=pdf`, 200, `application/pdf`, ~13KB, no auth issue for a
viewer) — this is exactly the "completed run with an actual generated artefact they can open and read"
the brief asks for as the single most valuable thing in this section. Two opposite findings came out of
actually opening them:

**BLOCKER — on the INSURER tenant, every single Death-Claim Assessment PDF says "Final outcome: (no
final outcome recorded)"**, checked across five different "Done" runs (`ar_727419f7523b`,
`ar_727418f7523b`, `ar_72741…` etc. — saved as `insurer/sample-run.pdf`, `insurer/ar_727418f7523b.pdf`).
Every one also reports "Human decisions: 0 approved, 0 rejected" despite listing "5. Claims committee
review (human) — Status: Done". So the one artefact built for a stranger to open and read — on the app
this section's own audit is likely to point at first — says nothing was decided, on a run the rest of
the product calls complete. This is the exact "(no output)" / "failure wearing the costume of
completion" defect class APP_AS_PRODUCT.md documents as fixed for the on-screen Work/Review path (2026-
07-29) — evidently the PDF report generator reads a different, still-broken path.

**What is genuinely strong — the BANK tenant's Reimbursement Approval PDF (`apprun_9ba6a45d`, saved as
`bank/apprun_9ba6a45d.pdf`) is the single best artefact found in this whole audit:** "Final outcome:
Claim amount: ₹41346.44 / Remaining quota: ₹137454.12 / Headroom: ₹96107.68 / Recommendation: within
quota — approve", "4. Approve or reject (human) — Detail: human approved at 'Approve or reject'". A
real decision, a real number, a real approval. **This is the one thing in the section to point a
stranger at.**

**BLOCKER (appropriateness) — but that same best-artefact PDF also leaks straight-up engine internals
in its own body**, on the same page as the clean "Final outcome": raw connector/domain/agent ids
(`data-domain "expense claims" [dom_7d17b157-0e6] → connector con_f5c959 :: expense_claims (read) → ok(1
rows via mysql)`, `agent agent_f9eae5d6`, `Child run: run_c655fc56`), an unterminated raw JSON blob
under "Inputs" (`{"case":{"fy":"2025-2026","id":1,...`), and the literal internal-only word **"SHADOW"**
("Detail: SHADOW: would report (not sent)"). A business reader downloading "their" report gets a
polished plain-language decision at the bottom of a page that reads like a database log above it. The
insurer PDF (which has no final outcome) also carries "(run not signed)"/"Signed at:.../Signature:..."
inconsistently between runs — worth a pass, but secondary to the leak.

Smallest fixes, cheapest first: (1) strip/replace `SHADOW` with a plain phrase in the report renderer —
one string; (2) drop the raw connector/domain/agent ids and the raw JSON `Inputs` dump from the
generated PDF, keeping only the plain "Outcome" lines already present; (3) find why the insurer app's
`Final outcome` section is empty when the bank app's isn't — likely the same `aggregateOutcome` /
final-step resolution already fixed for the live web view (per APP_AS_PRODUCT.md item 7) not yet
applied to the PDF renderer.

### /solutions/apps/app_14940314/runs/ar_72741af7523b and /ar_72741bf7523b — the actual "open a case" experience, and the single worst finding in this audit
`insurer/rundetail-part_1.png`, `insurer/rundetail2-part_1.png`. This is what a stranger reaches by
clicking either of the "2 cases are waiting for a person to decide" on the Death-Claim Assessment Work
tab — the app that leads the insurer's whole Apps list.

**BLOCKER (top of list) — the review panel that is supposed to show the AI's recommendation shows
"PENDING OUTPUT: (no output produced at this step)", on BOTH of the app's two waiting cases**, checked
independently (`ar_72741af7523b` and `ar_72741bf7523b` — identical result). The step is "Assess claim
risk" — literally the one decision this whole app exists to make. A stranger who follows the single
most obvious, most highlighted call to action on the insurer tenant ("2 cases are waiting for a
person to decide") opens a case and finds nothing to approve or reject: an empty box, a Note field,
and Approve/Reject buttons with no basis shown for either. This is the exact "(no output)" defect the
founder called out in APP_AS_PRODUCT.md ("goal is not met... you are far from it") — evidently fixed
for the BANK tenant's Reimbursement Approval app (see below) but still live and reachable on the
INSURER tenant's flagship app. **Both demo links are being sent to strangers, and one of them fails
its own headline claim on the very first click a curious viewer would make.**

**Contrast — the BANK tenant's equivalent screen is what this should look like everywhere:**
`bank/rundetail-part_1.png` (Reimbursement Approval, `apprun_54419080`). Real context tables (actual
expense-claim and quota rows, rendered as tables, not JSON), a populated "OUTCOME" box ("Claim amount:
₹41346.44 / Remaining quota: ₹137454.12 / Headroom: ₹96107.68 / Recommendation: within quota —
approve"), and a "RISK MEDIUM: Approving runs the remaining steps... This decision covers ₹41,346.44"
consequence note before the Approve button. This is genuinely excellent, plain-language, and exactly
what an investor needs to see. **Point a stranger at this screen, not the insurer's equivalent, until
the insurer app is fixed.**

**BLOCKER — step-sequence contradicts itself on the insurer app.** On both insurer waiting cases, step
6 ("Claim assessment + risk flag", the OUTPUT step) already shows **Done** while step 5 ("Claims
committee review", the human step that step 6 should depend on) still shows **Awaiting review**. A
stranger reading top-to-bottom sees the run apparently finish before the human decided. Confirmed this
is a real anomaly, not a misread: the bank app's equivalent run correctly shows its output step
("Reimbursement decision") as **Queued**, not Done, while its human step is awaiting review.

**RISK/LATER — jargon creeping into an otherwise plain screen:** the bank run detail has a collapsed
"Prompt sent to the model (18 characters)" disclosure — "prompt" and "model" are AI-engineering words a
department reader wouldn't use, visible even collapsed. Table footers show raw connector/table
references (`con_f5c959:expense_claims`) under otherwise clean rendered tables — same class as the PDF
finding above, matches GAP 7 (language pass) in APP_AS_PRODUCT.md.

### /solutions/apps/app_14940314/dashboard
`insurer/solutions_apps_app_14940314_dashboard.png`. **RISK, lower severity because it is not linked
from the app's own nav** (confirmed by extracting every in-page link from Work — Dashboard is reachable
only by typing the URL, not by any visible click path, so it is less exposed to a stranger than the
brief's "3 clicks" bar implies). What it shows if reached: the exact same 5 stat tiles already on the
Work tab ("Handled 3", "Waiting on a person 2", "Could not finish 0", "Usually takes 11 minutes",
"Needed a person 100%"), with nothing else — a 1600px-wide page that is 80% empty gutter below one row
of cards. APP_AS_PRODUCT.md's 2026-08-04 entry describes a richer `AppOwnerDashboard` (handled-over-
time, decisions vs failures, time breakdown, quality-tab agreement) as done — that component is not
what renders at this URL for this app. Worth checking whether `AppOwnerDashboard` is wired to this
route at all, or only to the newer job-shaped app.

### /solutions/apps/app_14940314/access — RBAC/ABAC editor
`insurer/solutions_apps_app_14940314_access.png`. Strong: plain-language Run/View/Edit/Approve/Trigger
sections, placeholder ABAC examples ("amount lte 50000", "region eq IN" — clearly placeholder syntax,
not real data), matches the founder's "its own RBAC" requirement well. Confirmed part of the same
systemic write-button issue: "Save policy" is fully armed and 403s (`PUT .../access`).

### /solutions/apps/app_14940314/controls (labelled "Safety" in the nav)
`insurer/solutions_apps_app_14940314_controls.png`. Good plain-language safety copy ("kill-switch",
"shadow mode", "blast radius" — each explained in a sentence under the term). **RISK** — the right
panel states "Runs are LIVE: side-effecting steps will act for real," which reads as in tension with
APP_AS_PRODUCT.md's "Known and deliberate: the output/report step is INTERCEPTED because live actions
are globally off" — worth confirming the global kill-switch actually overrides this per-app toggle,
because as written a technical reviewer doing diligence could read this panel as claiming live email/
report sending is armed on a public demo tenant.

### /solutions/apps/app_14940314/history — version history
`insurer/solutions_apps_app_14940314_history.png`. Thin (exactly one version, "v1 Existing
configuration...") on a 1600px page that is otherwise empty gutter below it — same repeated "wasted
real estate" pattern as Review. LATER, not a blocker on its own.

### /solutions/apps/app_14940314/schedule
`insurer/solutions_apps_app_14940314_schedule.png`. Clean, plain-language cron builder with presets
("Every hour", "Every Monday at 9am" etc.); "No schedule set yet" is honestly stated, consistent with
the app being email-triggered. Fine.

### The systemic pattern across all of the above — write-buttons armed for a viewer
Confirmed 403 on **five separate admin/write controls** across this one app's tabs, all fully
clickable-looking (no visual disabled state, `pointer-events: auto`), none carrying the explanatory
tooltip that the SAME app's row-level Approve/Reject correctly has:
1. "Duplicate this app" (toolbar, every tab) -> `POST .../clone` -> 403, toast "forbidden"
2. "Edit variables" -> "Update template" (modal) -> `POST .../publish-as-template` -> 403
3. "Unpublish" (toolbar) -> `DELETE .../publish-as-template` -> 403, toast "unpublish failed (403)"
4. "Terminate" (Runs list) -> `POST .../workflow` -> 403, toast "forbidden"
5. "Save policy" (Access tab) -> `PUT .../access` -> 403
6. "Run" (an eval, Quality tab, bank tenant) -> `POST .../eval-defs/{id}/run` -> 403
This is not five isolated misses — it's the entire admin-toolbar-and-settings-tab surface of the app
shell never having been wrapped in the `ReadOnlyGuard`/`useViewerMode()` treatment that IS correctly
applied to the row-level case actions (Approve/Reject) and the Input tab's Run buttons. Confirms the
brief's warning that `useViewerMode()` has effectively zero consumers on large parts of this section —
it has some (the two places above), just not the toolbar or settings tabs. Smallest fix: wrap the
toolbar buttons (shared across every `/solutions/apps/[id]/*` tab) once, in the layout, rather than per
tab, and it fixes all of #1-3 at once; #4-6 are the same guard applied at each list/table's action
buttons.

### /app/death-claim-assessment-ef9759 and /app/bh-reimbursement — the DEPLOYED public app (what "Open the app" / a shared link actually sends a stranger to)
`insurer/app_death-claim-assessment-ef9759.png`, `bank/app_bh-reimbursement.png`. This is a genuinely
different, standalone shell (Work / Dashboard / Run / Activity tabs, no console chrome) and it is
strong in the same way the console Work tab is: "What protects this" is an excellent plain-language
governance panel — "Personal details are hidden before the AI sees them — ALWAYS ON", "Large amounts
need a person to approve them — ALWAYS ON", "This app can only read 5/6 approved sources", "A person
decides, not the app." No OSS names, no jargon. **Approve/Reject here ARE correctly guarded** — hover
shows the same "Read-only demo. Sign in with a full account to make changes." tooltip
(`bank/deployed-approve-hover.png`) confirming APP_AS_PRODUCT.md's item 9 fix (`ReadOnlyGuard` wired
into the deployed-app shell) is genuinely live. Point at this page too, not just the console.

**BLOCKER — the insurer's deployed app makes a materially false governance claim.** It reads: *"Where
the data went: **No AI calls have been recorded for this app yet**, so nothing is known either way
about where its data went."* This is false — six-plus completed runs of this exact app have an "Assess
claim risk (agent)" step marked Done (see the Reports PDFs above). The bank app's equivalent line
correctly says "All 3 AI calls for this app stayed on your own hardware — nothing was sent to an
outside provider." This is the same root-cause family as the "(no final outcome recorded)" PDF and the
"(no output produced at this step)" review panel above — something that tracks this app's AI-call/
outcome history is not writing (or not being read) for the INSURER's Death-Claim Assessment
specifically, while the identical mechanism works for the bank's Reimbursement Approval. **Recommend
treating all three symptoms (empty PDF outcome, empty review pending-output, false "no AI calls"
banner) as one bug to find, not three separate ones** — they likely share a cause.

**BLOCKER (appropriateness / believability) — the bank's deployed app queue is dominated by an obvious
duplicate case.** Of the 12 "Waiting for you" rows, **six are the identical case** — "Meera Malhotra ·
submitted · ₹41,346.44 · 2025-09-16" — differing only by a "Waiting for you" timestamp a few minutes or
weeks apart. A stranger scrolling the queue (the very first thing the deployed app shows) sees the same
claim repeated six times in a row, which reads as test/seed-script residue, not real business volume —
directly undercuts the "does this do something real" impression this page otherwise earns. Also two
entries for "Training course reimbursement — Vikram Desai" sit back-to-back with inconsistent
formatting — one as "16107" (no ₹, no thousands separator) and the other as "₹16,107" — the same
underlying case rendered two different ways. Smallest fix: de-duplicate the seed data for this app (or
cap how many near-identical rows the seed script produces) and make the amount formatter consistent
across all seeded cases.

### /solutions/apps/new (Studio Forge) and /solutions/apps/forge — the actual chat-based BUILDER, and the best-behaved read-only surface in the whole audit
`insurer/solutions_apps_forge.png`. This is what a stranger reaches from "New app" — genuinely the
strongest example of "reads as plain language to a non-engineer" in the section: the chat placeholder
examples are pure business language with zero jargon ("A weekly cross-sell advisor that finds the top
10 accounts likely to buy a second product and emails each owner a one-line pitch", "Summarize every
new support ticket, flag the angry ones, and post a daily digest"). No model name, no JSON, no node
graph, no raw id anywhere on the page. **And "Save and open" is the one control found anywhere in this
section that is done exactly right**: visibly muted/grey (not the bright, active-looking green used
everywhere else), a plain sentence above it ("This account can explore the Builder but cannot make
changes."), and confirmed via DOM (`disabled: true`) — no 403 possible because the click can never
fire. **This is the reference implementation the rest of the section's write-buttons should be made to
match.**

### /solutions/reviews (top-level, personal queue) and /solutions/templates, /solutions/library
`insurer/solutions_reviews.png` / `bank/solutions_reviews.png`. **RISK** — shows "0 / 0 / 0 / 0" and
"You're all caught up. No runs are waiting on your decision right now" on BOTH tenants, immediately
adjacent in the nav to Apps, which on the same org shows 2 (insurer) or 12 (bank) cases waiting. This is
technically correct (this personal queue is scoped to runs assigned to the signed-in viewer specifically,
who isn't the configured approver for any seeded app) but the empty-state copy doesn't say that, so the
zero here reads as contradicting the "cases waiting" numbers one click away. Smallest fix: one sentence
explaining why ("Cases route to each app's configured approvers, not to every viewer") instead of a bare
"caught up."
Templates (`insurer/solutions_templates.png`, `bank/solutions_templates.png`) and Blueprints
(`insurer/solutions_library.png`) are legible and honestly labelled ("Not ready — no app implements
this contract yet", "Proof v2 · unverified") — reasonable, if thin (1 card for insurer, 3 for bank,
lots of empty gutter at 1600px — the repeated pattern, not a new defect).

### /solutions/quality/evaluators (top-level, platform-wide evaluator library)
`insurer/solutions_quality_evaluators.png`. Strong: every evaluator template states its own threshold
in plain language directly under the name ("Hallucination / Faithfulness — Is every claim in the
answer supported by the retrieved context? ... ready ≥80%"). **LATER** — category filter chips use raw
ML jargon a business reader wouldn't parse ("RAG", "Agentic") as section headers; minor since this is
an advanced/admin library, not a number on a dashboard, but consistent with the known GAP 7 language
pass.

**Methodology note for whoever reads this next:** this app's content area is `overflow-y: auto` inside
a fixed-height flex shell, so a plain `page.screenshot({fullPage:true})` — what the harness does by
default — silently truncates at the viewport height and misses everything below "Show 11 more". Two of
the three findings above (the access-denial wall, the dollar instructions) were invisible in the
harness's own screenshot and only surfaced by scripting a scroll of the inner container. Any screen in
this section with a scrollable "steps" or "cases" list should be checked the same way before being
called clean.
