# Audit — Solutions + Build (the app builder) — 2026-08-05
## LENS: CONFERENCE DEMO READINESS

Severity: **DEMO-BLOCKER** (breaks / embarrasses / lies on stage) · **DEMO-RISK** (survives the rehearsed
path, fails one click off-script) · **POST-DEMO** (real, invisible on stage — one line only).

This section IS the demo. *"A non-technical person in a department builds a governed AI workflow in plain
language"* is the headline claim of the product, and this is where it is proved. He will build one live.

### VERDICT
**The canned demo works and looks good. Everything one click either side of it is broken on screen.**

Compiling the built-in **"Reimbursement approval"** example produces a clean, credible five-step governed
app in 20.5s — genuinely impressive. But the two apps he would open to *show* a finished app
(`Motor Claim FNOL Triage`, and the whole bank tenant) currently project a **red error banner**, an
**amber "effectively unowned" banner naming `service@offgrid.local`**, a **"Draft — check it, then
publish" badge on an app that IS published**, a dropdown reading **"Saved option (no longer available)"**,
a green **"Everything is wired"** banner sitting directly above that broken binding, **"Amounts in USD"**
and **"$100,000"** on an Indian motor-claim app, and a stat band reading **HANDLED 0** beside a list
titled *"Recently handled"* with five handled cases in it.

**Can a non-technical department user build a governed workflow here unaided? On the scripted path, yes —
and it reads well. Off the scripted path, no.** Novel descriptions come back with step labels truncated
mid-sentence ("Decide whether the credit can be", "And have the tax manager approve") and an invented
read of the wrong data source. Every fix below is seed data or copy. None is a refactor.

**The single most important sentence in this report: the *building* is in good shape; the *demo data* is
not.** Nine of the fourteen blockers are one `UPDATE` or one seed script away, and they are what makes the
finished screens look broken. The section overview shows `Blueprints ready 0 of 3` in a red tile,
`Reusable templates 0` and `Deployed 0` — because `solution_deployments` is **empty on all three tenants**
and the demo tenant has **zero templates**, so *"Start from a template"* (the second button on the front
door) is a dead end. Budget an hour of seeding, not a sprint of engineering.

**Do this before acting on anything else (D0):** the console on `:3005` is **serving a stale compiled copy
of at least one module whose source on the same box contains the fix** — proven by diffing the box's own
`src/lib/review-inbox.ts` (INR fix present) against what the review queue renders (`$1,200,000`, the exact
pre-fix string its comment quotes). **Production-build + restart the box, then re-walk every screen.** Some
blockers below will evaporate; the survivors are the real list. It also means any "FIXED" line in
`docs/APP_AS_PRODUCT.md` is unverified until seen on screen.

**The two assets worth building the talk around:** (1) the compile of the built-in example — five clean
governed steps in 20s; (2) the **"WHAT HAPPENS WHEN YOU RUN THIS"** panel on the Run screen, which tells a
reader in plain language exactly what the app will do *before* it runs, including *"You'll be asked to
decide."* That panel is the acceptance bar, met — point at it.

### Environment fact — verified, do not re-derive
`127.0.0.1:3005` is an **SSH forward to the box** (`ssh -f -N -L 3005:127.0.0.1:3005 offgrid-tunnel`,
pid 46157). The console runs from `/Users/admin/offgrid/console` against the **box** Postgres. The local
dev Postgres is test residue and is **not** what the demo shows — an early draft of D5 below was wrong
because it read the local DB. Query the box (`node -e` + `pg`, read-only) for anything data-shaped.

## Coverage
- [x] `docs/APP_AS_PRODUCT.md`; 88 pages enumerated; `/build/**` confirmed 308→`/solutions/**` (`src/modules/route-migrations.mjs:61-71`) — the dual file tree is not a dual-URL problem
- [x] Screenshots judged as projected images: `/solutions/apps`, `/solutions/apps/new`, `/build` (404), `/solutions/apps/app_e8b19b50` (Work) and `/build` tab → `/tmp/audit/build/`, `/tmp/audit/build3/`, `/tmp/audit/build-flow/`
- [x] **Live compile driven** for all three built-in examples + one novel Indian-tax description (`scratchpad/probe-compile*.mjs`)
- [x] Live box DB: every app, trigger kind, publish state, slug, owner, run dates, data-domain ids/labels
- [x] Trigger substrate traced end to end (`triggers.ts` → `trigger-dispatch.ts` → `app-builder.ts` → `app-model.ts` → the POST route)
- [x] **`/solutions` overview** — pixel-confirmed (D12) and its four tiles reconciled against the box DB
- [x] **`/solutions/apps/[id]/input`** (Start a case / Run) — pixel-confirmed (D14)
- [x] Box DB: templates per org, blueprints per org, `solution_deployments` (empty everywhere)
- [x] **`/solutions/reviews`** — pixel-confirmed (D0), and the box's `review-inbox.ts` diffed against the repo's
- [x] **`/solutions/templates`** — pixel-confirmed empty (D13); **`/solutions/deployed`** — pixel-confirmed empty (D12)
- [ ] **NOT COVERED — pick up here.** `/solutions/library` + blueprint detail (its shot rendered blank at 7KB with HTTP 408 on `layout.css` — a harness artifact, re-shoot), the app's `Reports` / `Quality` / `Access` / `History` tabs, and `/solutions/apps/[id]/review`. **All of it needs re-walking after the D0 restart anyway.** The **shared dev server on :3005 kept failing** (`report.json` for these shows 90s `networkidle` timeouts, HTTP 408 on `layout.css`, `ERR_EMPTY_RESPONSE`, `ERR_CONNECTION_REFUSED`). Two routes painted anyway and are judged above; `/solutions/templates` and `/solutions/library` produced no usable pixels and `/…/reports` returned an empty response. **Those server errors are harness/contention artifacts — do NOT report them as product defects.** Highest value to re-shoot: **`/solutions/templates`** (D13 says it is empty on the demo tenant; what it *says* when empty is unverified), then `/solutions/library` + a blueprint detail (D12 says all 3 are non-adoptable — the "See what is missing" click).

**Reusable harness for whoever resumes:** `scratchpad/probe-compile2.mjs` compiles all three built-in
examples against the box and prints the step list as the refine screen would label it — that is the fastest
way to re-check the demo's core claim after any change. `scratchpad/drive-build.mjs` drives
describe→refine in a browser. Note `page.fill()` on the description textarea does NOT reach React state,
so the compile silently no-ops — use `page.type()` (my first run wasted a cycle on this; it is a harness
artifact, **not** a product defect, and must not be reported as one).

---

## DEMO-BLOCKERS

### D0 — **THE RUNNING SERVER IS NOT EXECUTING THE CODE ON DISK.** Every approval amount reads in DOLLARS on the review queue, and the fix for it is already in the file — on the box
Screen: **`/solutions/reviews`** — the human-approval inbox, the emotional peak of the demo.
Screenshot: `/tmp/audit/build3/solutions_reviews.png`.

The screen is otherwise the **best-looking surface in the section** — "Your review queue", five approval
cards, "You can approve" badges, "Review now →". And the money on it, rendered large and in emerald as the
most prominent element on each card, reads:

> **`$1,200,000`** — *"Approve $1,200,000 — Personal Loan Underwriting Assist for **Arjun Pillai**?"*
> **`$63,000`** — *"Approve $63,000 — Reimbursement Approval?"*

Dollars, with US thousands grouping, on an Indian BFSI demo with Indian names and Indian products. A
₹12,00,000 personal loan is plausible; a **$1.2 million** one is not. The CFO/CISO in the room reads that
number before anything else on the screen.

**Now the important part.** `src/lib/review-inbox.ts:168-179` already fixes this, and its comment quotes
the defect *verbatim, including the same name*:
> *"This used to be a hardcoded Intl 'en-US' + 'USD' formatter, so every approval question on an Indian
> BFSI deployment read **"Approve $1,200,000 — Personal Loan Underwriting for Arjun Pillai?"**. The money
> module already existed and already had the right default; this call site simply predated it."*

`formatAmount` → `formatMoney` → `DEFAULT_CURRENCY = 'INR'` (`src/lib/money.ts:14`) with lakh/crore
grouping. **And I diffed the box's own copy — it is byte-identical to the repo's, fix included:**
```
ssh offgrid-tunnel 'sed -n 165,182p /Users/admin/offgrid/console/src/lib/review-inbox.ts'
  → identical to local, formatAmount() → formatMoney(n)
```
Every one of the four call sites routes through it (`:232, :244, :407-408, :428`). There is no code path
in that module that can emit `$`.

**So the console serving `:3005` is running a stale compiled copy of a module whose source on the same
machine contains the fix.** (Most likely: `next dev` was started at 11:01 and an rsync that preserved
mtimes never tripped HMR for this module.) I cannot prove the exact mechanism from a read-only session,
and I am not claiming one.

**Why this is D0 rather than a copy bug — it invalidates the premise of every other check:**
1. It explains **D3** ("Amounts in USD", `$100,000`) surviving a fix the progress log records as done.
2. It means **any item in `docs/APP_AS_PRODUCT.md` marked FIXED may still be broken on screen**, and
   conversely some defects in this report may already be fixed in source and only *look* broken.
3. **Action, before anything else in this report:** do a real production build + restart on the box, then
   **re-walk every screen**. Several blockers below may evaporate; the ones that survive are the real list.
   Do not spend a minute on copy fixes until the box is provably running current code.

Secondary defects visible on this same screen, all still worth fixing after the restart:
- **"ABOVE YOUR LIMIT 0"** — a zero tile, and "your limit" is never explained.
- **"AWAITING YOU 5"** and **"YOU CAN APPROVE 5"** are the same number in two adjacent tiles.
- **"Approve Reimbursement Approval?"** — a doubled word, same template flaw as D1's "could not read Read".
- Two of five cards carry **no amount at all**, leaving a ragged hole in the Motor Claim card.
- Timestamps render **US `7/6/2026, 5:58:41 PM`** with seconds, on an Indian demo.

### D1 — The app he'd open to show a finished product projects a red error banner, an amber banner, and a false "Draft" badge
Screen: **`/solutions/apps/app_e8b19b50`** (Motor Claim FNOL Triage — the insurance story).
Screenshot: `/tmp/audit/build3/solutions_apps_app_e8b19b50.png`.

Top of the screen, in order, before any content:
1. **Red banner:** *"This app could not read Read the claim & policy on its last run. Until that is fixed
   it is working from nothing."* — and note the **doubled word**: "could not read **Read** the claim &
   policy" (the sentence template interpolates the step label without lowering it).
2. **Amber banner:** *"`service@offgrid.local` owns this but no longer has an account here. It is
   effectively unowned. Change who owns it"* — a raw internal service-account address, projected.
3. **Amber pill, top right:** *"Draft — check it, then publish"* — **the app is published.** Box DB:
   `app_e8b19b50 | published=true`.

The Draft badge is driven by `openHref` (`src/app/(console)/build/apps/[id]/layout.tsx:42`):
```ts
openHref={app.published && app.slug ? `/app/${encodeURIComponent(app.slug)}` : null}
```
and on the box **`slug = null` for all four apps in the `default` org, three of which are published**:
```
app_16ad7e53 | KYC & Re-KYC Verification         | pub=true  | slug=null | owner=service@offgrid.local
app_0c240abc | Personal Loan Underwriting Assist | pub=true  | slug=null | owner=service@offgrid.local
app_e8b19b50 | Motor Claim FNOL Triage           | pub=true  | slug=null | owner=service@offgrid.local
app_bdd24eab | Reimbursement Approval            | pub=false | slug=null | owner=seed@offgrid.local
```
So on **every app in the demo tenant**: the badge says Draft when it is live, and the **"Open the app"**
button — the click-through to the deployed app a department actually uses, which the code's own comment
calls *"THE POINT OF ALL THIS"* (`AppLifecycleNav.tsx:55-57`) — **never renders.** He cannot show the
built app on stage.

**Fix (5 minutes, data only):** set `slug` on the three published apps, and re-own them to a real account.

### D2 — The Build tab shows a broken data-source dropdown under a green "Everything is wired" banner
Screen: **`/solutions/apps/app_e8b19b50/build`** — the "edit what was built" screen, the second half of
the build story. Screenshot: `/tmp/audit/build3/solutions_apps_app_e8b19b50_build.png`.

- Step 1 "Read the claim & policy" → *Which data source does this step read?* →
  **`Saved option (no longer available) (Saved, but not available)`** — the placeholder string doubled by
  the option-suffix, followed by *"**Saved option (no longer available)**: This saved option is no longer
  available to you. Choose another available option to replace it."*
- Directly **above it**, full-width green: **"Everything is wired. You're ready to save."**

Two contradictory status claims, one screen, ~150px apart. A CISO reads that instantly.

Root cause is seed data, not the builder. Box DB, `app_e8b19b50.steps`:
```json
{"id":"s1", "kind":"connector-query", "label":"Read the claim & policy", "domain":"claims"}
{"id":"s2", "kind":"connector-query", "label":"Look up the customer & vehicle", "domain":"customers"}
```
The org's domains are:
```
dom_76d5ffd3-f98 invoices · dom_dce6a3d5-a8b reimbursement quota
dom_016ca790-871 transactions · dom_6fe4f965-919 customer data · dom_360147e2-cfc claims
```
`buildBuilderCatalogueOptions` matches on `domain:<id>` refs, so a **label-valued** `domain` never
matches → `builder-catalogue-options.ts:54` renders the `'Saved option (no longer available)'` fallback.
And s2's `"customers"` does not match the actual label **"customer data"** either, so it is broken by
name as well as by keying — which is also why the last run failed and D1's red banner fires.

**Fix (data only):** rewrite these steps' `domain` to the real domain ids (`dom_360147e2-cfc`,
`dom_6fe4f965-919`). Sweep every seeded app for label-valued `domain`.

### D3 — "Amounts in USD" and "$100,000" on an Indian motor-insurance app
Same screen; the **Summary** textarea is visible in the screenshot ending *"…then route for approval.
**Amounts in USD**"*, on an app whose every case reads in rupees (`Vehicle: TN09EF4567 · ClaimRef:
CLM-20501`).

Worse, and not previously caught: the **agent instructions themselves** carry a dollar threshold. Box DB,
`app_e8b19b50` step s3 `inlineAgent.systemPrompt`:
> *"…decide whether the claim can be settled cashless at a network garage or needs a surveyor
> (**mandatory above $100,000**). Cite the SOP…"*

That text is rendered in the step editor on this very screen. `docs/APP_AS_PRODUCT.md` records fixing the
currency copy (*"8 apps said 'Amounts in USD ($)' while every case reads in rupees"*) — that pass touched
the `summary` column only and **missed the agent prompts and this app's summary.** A dollar figure in an
Indian motor-claim SOP is the detail an Indian BFSI audience will spot first.

### D4 — "HANDLED 0" directly beside a list titled "Recently handled" containing five handled cases
Screen: `/solutions/apps/app_e8b19b50` (D1's screenshot).

The stat band reads **HANDLED 0 · WAITING ON A PERSON 1 · COULD NOT FINISH 1 · USUALLY TAKES "Not
measured" · NEEDED A PERSON 50%**. Immediately below, **"Recently handled"** lists five rows, two marked
*"Completed · produced a result"*.

Internally the code is right and the DATA is stale. `buildAppDashboard` windows `completed`/`failed` to
the recent period but deliberately does not window `waiting` (`src/lib/app-dashboard.ts:100-111`). Box run
dates for this app: `2026-07-25, 2026-07-05, 2026-07-03, 2026-07-02, 2026-06-30, 2026-06-28, 2026-06-24`
— against today, **every completed run has aged out of the window**, so HANDLED is a true 0 and
"Recently handled" (unwindowed) still shows them.

But **the window is never named on screen.** Three of five tiles read 0 / 1 / "Not measured", and
**"NEEDED A PERSON 50%"** is a percentage on an in-window denominator of 2. This is precisely the "two
unlabelled denominators on one screen" defect the doc records fixing on the owner dashboard on 2026-08-04
— recurring on the app front door.

**Fix (data only, cheapest high-value win in this section):** shift the seeded run timestamps forward so
they land inside the window. The band then reads HANDLED 4-5 and USUALLY TAKES a real duration, and it
agrees with the list. Optionally add "in the last 30 days" to the band label.

### D5 — Five of the eleven live apps are published on the `email` trigger, which is not wired, and each tells its reader work arrives automatically
Box DB + box env:
```
bhapp_kyc    | org_bharat   | KYC & Re-KYC Verification  | published | {"kind":"email"} |  5 waiting
bhapp_loan   | org_bharat   | Personal Loan Underwriting | published | {"kind":"email"} |  2 waiting
bhapp_reimb  | org_bharat   | Reimbursement Approval     | published | {"kind":"email"} | 12 waiting
app_14940314 | org_suraksha | Death-Claim Assessment     | published | {"kind":"email"} |  2 waiting
app_c38d2c5e | org_suraksha | Policy Underwriting Assist | published | {"kind":"email"} |  2 waiting
```
`OFFGRID_REDPANDA_BROKERS` is the **only** trigger env set on the box — no IMAP, no WhatsApp gateway. So
`triggerAvailability('email', env)` (`src/lib/trigger-dispatch.ts:243-247`) resolves to
`state:'coming-soon', enabled:false`. **These five published apps cannot receive work.**

And each one's front door states the opposite as fact (`src/lib/app-work-queue.ts:81-82`):
```ts
case 'email':
  return 'New cases arrive by email, and are picked up automatically.';
```
`bhapp_reimb` has the most waiting cases on the box, so it is the natural app to open on the bank tenant.
The screen says work arrives by email automatically; the follow-up question — *"so if I email an invoice
now, it shows up here?"* — has no good answer.

The guard exists and was applied to the wrong branch. Eleven lines down, same function
(`app-work-queue.ts:92`): *"An unrecognised trigger must not claim work arrives automatically when we
cannot confirm it."* `arrivalSentence` takes no availability argument, so the honest answer is not
reachable from its signature.

**Fix (one UPDATE):** set those five apps' trigger to `on-demand`. The screens then read *"Somebody starts
each case here when it is needed"* — true, and it matches the run-it-live demo he wants anyway.

### D6 — The trigger card offers "Email" and "WhatsApp" as ordinary choices; picking Schedule saves an app that can never run
Screen: builder refine, right column, **"How is it triggered?"** — visible in
`/tmp/audit/build3/solutions_apps_app_e8b19b50_build.png` (On demand *selected*, Webhook, Schedule…).
File: `src/components/build/AppBuilder.tsx:121-136`.

Six identical selectable rows, each with a hint asserting it works:

| row | hint projected | reality |
| --- | --- | --- |
| On demand | "A person runs it from a form" | works |
| Webhook | **"An inbound HTTP call starts a run"** | works — but this is engine-speak for a business room |
| Schedule | **"Runs on a recurring cron"** | **"cron" on screen**, and no cron field exists anywhere in the builder |
| Live data feed | "Each record on a feed starts a run" | works on this box; asks for a raw topic name (D7) |
| **Email** | "An incoming email starts a run (on-prem)" | **NOT WIRED** |
| **WhatsApp** | "An incoming WhatsApp message starts a run (on-prem gateway)" | **NOT WIRED** |

The honest gate exists and is **called by nothing in production**:
```
grep -rn "triggerAvailability" src test
  src/lib/triggers.ts          (a comment)
  src/lib/trigger-dispatch.ts  (its own definition)
  test/trigger-dispatch.test.ts
```
Same for `validateTrigger` / `normalizeTrigger` (`triggers.ts:61,109`) — zero production callers; the
builder never imports `@/lib/triggers`. `COMING_SOON_TRIGGER_KINDS = ['email','whatsapp']` is declared at
`triggers.ts:33` and never consulted by any UI.

**And Schedule saves silently broken.** `setTrigger(s,'schedule')` (`src/lib/app-builder.ts:346-353`)
writes `{kind:'schedule'}` with no config; a config panel is rendered for `topic` **only**
(`AppBuilder.tsx:717-725`). `validateAppSpec` (`src/lib/app-model.ts:144,158`) checks only that the kind
is in a hard-coded list, and `POST /api/v1/admin/apps:47` takes the trigger verbatim. So on stage: click
Schedule → **"Everything is wired. You're ready to save."** → green save toast → an app that will never
fire. Identical for Email and WhatsApp.

**Why it costs the room:** "work arrives from the channels your business already uses — email, WhatsApp"
is the most compelling line on that card and the one thing that cannot be shown. There is no badge to
explain why, and nothing stops him clicking it live.

### D7 — Platform jargon and two zero-value chips on the build screen he will definitely project
Screen: **`/solutions/apps/new`** — screenshot `/tmp/audit/build/build_studio_new.png`.
`src/components/build/InheritanceBanner.tsx:12-41`, directly under the h1:

> `THIS APP INHERITS  ⟨8 connectors⟩ ⟨5 data domains⟩ ⟨0 tools⟩ ⟨0 KB docs⟩ ⟨guardrails on⟩ ⟨policy v10⟩`
> *"Every step runs through your org's governed pipeline — policy, guardrails, routing, and provenance are
> applied automatically. You don't wire any of it."*

Nine platform terms in one strip — *connectors, data domains, tools, KB docs, guardrails, policy v10,
pipeline, routing, provenance* — at 11px grey, from row 10. **Two of the six chips read `0`** (`0 tools`,
`0 KB docs`), so the "you are not starting from zero" banner literally shows zeros.

Three more on the same flow:
- **`What you can use — 16 ready · 3 need approval · 3 unavailable`** — a **"3 unavailable"** count on the
  build front door. (It reads `15 ready` on the Build tab and `16 ready` on New app — an unexplained
  drift between two screens he may show back to back.)
- Builder refine, **"Runs on"** card (`AppBuilder.tsx:787-790`): *"The governed pipeline this app runs on
  — its model gateway, data ceiling, policy and guardrails"*, whose **first selectable row** is literally
  **"No pipeline (unbound)"** — *"Runs without a governing pipeline."* An opt-out of governance, in
  jargon, ten inches below a banner promising governance is unconditional. **And the live compile returns
  `pipelineId: null`**, so a freshly built app lands on exactly that row on stage.
- `InheritanceBanner.tsx:39` renders `guardrails.on ? 'guardrails on' : 'guardrails off'`. An org with no
  active rule projects **"guardrails off"** two lines above *"guardrails … applied automatically."*

`build/studio/page.tsx:56-59` carries a comment saying this exact mistake was already fixed once on the
Apps page (*"WAS SIX PLATFORM TERMS IN ONE SENTENCE"*). The builder was never swept.

### D8 — "9 cases are waiting for a person" on the Apps front door; only 5 exist to open
Screen: **`/solutions/apps`** — almost certainly his first slide.
Screenshot: `/tmp/audit/build/build_apps.png`.

Stat band: **WAITING FOR A PERSON = 9**. The four cards below badge **2 + 1 + 1 + 1 = 5**. Same source
map, same screen, ~200px apart. Box DB explains it exactly:
```
awaiting_human runs, org 'default':
  app_0c240abc 1 · app_16ad7e53 1 · app_e8b19b50 1 · app_bdd24eab 2  = 5  (apps that exist)
  app_4108cf57 2 · app_d9f008e3 2                                   = 4  (NOT in the apps table)
```
`build/studio/page.tsx:84-88` sums every `awaiting_human` run in the org; `AppsList` badges only apps
`listApps` returns. On a non-demo tenant `listAppRunsView` deliberately does not filter to visible apps
(`src/lib/app-runs-view-reader.ts:83-87`, gated on `isDemoTenantOrg`), so **4 cases orphaned by two
deleted apps inflate the one number the whole story is about**, with no card to open.

**Fix:** delete the two orphaned apps' runs (data), or scope the sum to `apps` (one line).
Same code, secondary: the sum reads at most 300 runs, so an app whose waiting cases fall outside that
window badges **0**.

### D9 — A novel description compiles to mangled step labels and an invented read of the wrong data source
This is the off-script build — the one an audience suggestion produces. Driven live against the box
(`scratchpad/probe-compile.mjs`), description:
> *"GST input-tax-credit mismatch review - read the vendor invoice, check it against the GSTR-2B return
> for the month, decide whether the credit can be claimed, and have the tax manager approve or reject it."*

200 in **48.3s**, and the step list the refine screen would render:
```
1. [connector-query] "Vendor invoice"                    domain=dom_76d5ffd3-f98  (invoices)
2. [connector-query] "Read claims"                        domain=dom_360147e2-cfc  (claims)   <-- INVENTED
3. [agent]           "Decide whether the credit can be"                                       <-- TRUNCATED
4. [human]           "And have the tax manager approve"                                       <-- starts with "And"
5. [output]          "Output result"                      sink=console
gaps: ["Added a read of \"claims\" before \"Decide whether the credit can be\" — that step reasons
        about it, and nothing was fetching it."]
```
Two of five labels are **sentence fragments cut mid-phrase**, one begins with the word *"And"*, and the
app claims to read **insurance claims** in a **GST tax-credit** workflow.

Contrast the built-in example, same box, same probe — **this is what the scripted demo produces and it is
excellent**:
```
"Reimbursement approval"  →  200 in 20.5s
1. [connector-query] "Read Invoice"          2. [connector-query] "Check Employee Quota"
3. [agent] "Decide Eligibility"              4. [human] "Manager Approval"
5. [output] "Final Decision"                 gaps: []   →  "Everything is wired. You're ready to save."
```
**So: use the canned example on stage. Do not take a description from the audience.** If he must, the
labels are editable inline in the refine step list — but he will be editing on the projector, which tells
the room the machine got it wrong.

### D10 — Bare `/build` is a chromeless full-page 404 that dumps him out of the console
Screenshot: `/tmp/audit/build/build.png`. Every child of `/build` is redirected
(`route-migrations.mjs:61-71`) but **bare `/build` is not**, so it renders the global not-found: centred
magnifier, **"Page not found"**, *"That route doesn't exist, or the module isn't enabled for this
deployment."* — **no sidebar, no header, no breadcrumb**, one "Go to overview" button.

`/build` is the most guessable URL in the section (it prefixes every file path and every pre-migration
bookmark). One stale link or mistype on stage blanks the entire console. The copy also conflates "doesn't
exist" with "your deployment doesn't have this", so if he demos a restricted role a **permission** outcome
reads as a broken product.

### D12 — The Solutions overview's central story — Blueprint → App → Deployed — terminates in ZERO, in a red tile, with the same warning printed twice
Screen: **`/solutions`** — what the sidebar's "Solutions" row opens.
Screenshot: `/tmp/audit/build4/solutions.png`. Numbers verified against the box DB.

The headline copy is strong (*"Turn high-value processes into governed AI"*) and the "HOW THIS FITS
TOGETHER" explainer is genuinely good. Then the page proves nothing:

| tile | shows | box DB |
| --- | --- | --- |
| PUBLISHED APPS | `3 of 4` ✓ | correct |
| BLUEPRINTS READY TO DEPLOY | **`0 of 3`** — in a **red/destructive-bordered card** | 3 blueprints, none adoptable |
| REUSABLE TEMPLATES | **`0`** | `default` org has **0** templates (D13) |
| `03 · DEPLOYED` | **`0`** + an amber warning box | **`solution_deployments` is EMPTY across all three tenants** |

And the same negative sentence is printed **twice on one screen** — once full-width above the chain and
once inside the Deployed card:
> *"No App currently satisfies a blueprint contract. Open a blueprint to see which data domains, actions
> or pipeline it still needs."*

So two of four tiles are zero, one of them styled as an error, the third stage of the three-stage chain is
empty with a warning, and the only call to action there is **"See what is missing →"**. Projected, the
section overview reads as a system where nothing has been achieved.

`docs/APP_AS_PRODUCT.md` claims this was fixed — *"Deployed is no longer a dead end — bank tenant shows an
ACTIVE adoption (`scripts/seed-solution-deployment.mts`)"*. **On this box that is false: the
`solution_deployments` table has zero rows for every org.** Either the seed was never run here or it was
wiped. Re-running that script is the fix, and it is data-only.

Jargon on the same screen for a business audience: *"blueprint contract"*, *"data domains, actions or
pipeline"*, *"governed pipeline"*, *"versioned proof"*.

### D13 — "Start from a template" — the second button on the Apps front door — is a dead end on the demo tenant
Box DB, templates usable by each tenant:
```
default      | 0   <-- the org the demo login lands in
org_bharat   | 3
org_suraksha | 2
```
`/solutions/apps` puts **"Start from a template"** immediately left of "New app" at the top right
(`build/studio/page.tsx:70-73`, visible in `/tmp/audit/build/build_apps.png`), and `/solutions` counts
**REUSABLE TEMPLATES 0**. On the tenant he demos, that button leads to an empty page.

`listTemplates` (`apps-store.ts:962-975`) requires `is_template = true` AND
`visibility IN ('public','org')` scoped to the current org — the six templates the progress log describes
were seeded into `org_bharat`/`org_suraksha` only. **"Reuse a previous app / select from templates" is one
of the founder's named requirements**, so this is a headline capability with nothing behind it on the demo
tenant. Fix: publish 2–3 of the `default` org's apps as templates (the real `publish-as-template` route
already exists), or demo from the bank tenant.

I could not screenshot `/solutions/templates` itself (server died), so what the empty page *says* is
unverified — it may or may not be a good empty state. **Check that page before the talk.**

### D14 — The Run screen sits on a permanent "Looking for cases…" and offers a leaked test prompt as the example case
Screen: **`/solutions/apps/app_e8b19b50/input`** — "Start a case", the run-it-live moment.
Screenshot: `/tmp/audit/build4/solutions_apps_app_e8b19b50_input.png`.

Three things a business audience reads:
1. **"Looking for cases…"** — the case picker never resolves. This is the fix for
   `docs/APP_AS_PRODUCT.md` **GAP 0** (*"why is this free text? all of the data is already in the
   organization"*), and on screen it is a spinner that never finishes. **Two candidate causes and I cannot
   separate them from one shot:** the app's data-source bindings are broken (D2 — `domain:"claims"` is a
   label, so `case-candidates` cannot resolve a connector), *and* the shared dev server was refusing
   connections during this capture (`report.json`: `ERR_CONNECTION_REFUSED`). **Re-check after fixing D2.**
   Either way, a never-resolving spinner is the lens's canonical blocker.
2. **The example case is a leaked test prompt.** Both the help line and the input read:
   > *"Or describe it by hand: … For example: **In one line, what does this app do for the bank?**"*

   `app-input-prompt.ts` derives the example from *"a REAL previous case from that app"* — and this app's
   real previous case is a junk probe run. So on the run screen of a **motor-insurance** app, the suggested
   case to work on is a meta-question about the app. The same string appears as the top row of "Recently
   handled" on the Work tab (D1's screenshot), marked *"Could not finish"*. Delete that probe run and the
   example becomes a real claim.
3. **"Amounts in USD ($)."** — D3 again, here in the largest description text on the screen.

**Worth protecting — this is the best thing in the section.** The right-hand panel is excellent and should
be the thing he points at:
> **WHAT HAPPENS WHEN YOU RUN THIS** — 1 Read the claim & policy · 2 Look up the customer & vehicle ·
> 3 Decide cashless vs surveyor · 4 **Claims officer approval** — *"You'll be asked to decide."* ·
> 5 Claim decision + audit note
> *"This app pauses for a human decision. After you submit, the run shows up on the Review tab for
> approval before it finishes."*

That is truthful, plain-language, pre-run disclosure of exactly what the app will do — the thing the
acceptance bar asks for — and the **"Rehearse it" / "Run for real"** pair beside it is the best copy in the
section. Lead with this panel.

### D11 — *(CORRECTED — DOWNGRADED TO A RISK)* The Solutions overview caps its data reads at 1.5s
**I predicted this would render `0 of 0` on a populated system. The live screen shows `3 of 4`, which is
correct.** Recording the correction rather than the prediction: the reads landed inside the cap, so the
symptom I described did **not** occur. Keeping it as a RISK because the mechanism is real and the box is
demonstrably slow (it stopped answering HTTP entirely during this audit), not because I observed it.

File: `src/app/(console)/solutions/page.tsx:27-33,50`.

```ts
safeWithTimeout(() => listApps(orgId), 1500, null),
safeWithTimeout(() => listSolutionBlueprints(orgId), 1500, null),
safeWithTimeout(() => listSolutionDeployments(orgId), 1500, null),
safeWithTimeout(() => listSolutionDeploymentCandidates(orgId), 2500, null),
safeWithTimeout(() => listTemplates(orgId), 1500, null),
…
const runs = await safeWithTimeout(() => listAgentRuns(6, orgId), 1200, null);
```
`safeWithTimeout` **collapses reject and timeout into the fallback by design** (`src/lib/with-timeout.ts`
— *"a failing probe and a slow probe degrade identically"*). Six live DB reads, each capped at
1.2–2.5 seconds, on the same box that just took 20–48s to answer a compile and that stopped answering HTTP
at all during this audit (three `curl /solutions` attempts, 45s each, no response).

The fallback is `null` — deliberately, so "not read" could be told apart from "empty". **The page throws
that signal away on the next line**: `(apps ?? [])`, `(blueprints ?? [])`, `(deployments ?? [])`,
`(templates ?? [])` at `:38-44` and `:51-52`. So a timed-out read renders:
- **`Published apps — 0 of 0`**
- **`Blueprints ready to deploy — 0 of 0`**
- an **empty Blueprint → App → Deployment chain**

…on a tenant with 11 apps. And the "something is wrong" styling cannot fire: `state: 'attention'` requires
`publishedApps === 0 && (apps ?? []).length > 0` (`:63`), which a `null` read can never satisfy — so the
zeros render **calm and neutral**, indistinguishable from a brand-new empty org.

The residual risk is real but unobserved: if any of those six reads *does* exceed its cap on the day, the
page renders `0 of 0` **calm and neutral** rather than "couldn't load", because `state:'attention'` requires
`(apps ?? []).length > 0` (`:63`) — a condition a `null` read can never satisfy. Raising the caps to ~8s, or
rendering the `null` as "couldn't load — retry", is a one-line fix. **Lower priority than D12/D13, which
are about the same page and are confirmed.**

**Method note for whoever resumes:** this is the second prediction I made from code alone that the
screenshot refuted (the first was the pipeline-binding claim in D5's correction). Both times the code
reading was right about the mechanism and wrong about the outcome. Do not promote a code-derived symptom to
a blocker without the image.

---

## DEMO-RISKS

### R1 — The compile is 20–48s of near-silence, and the promise on screen says 20–40s
`AppBuilder.tsx:887-895` does the right thing — a spinner, the label **"Carving steps…"**, and an honest
`aria-live` line: *"Reading your description and drafting the steps — this runs on your own hardware and
usually takes 20–40 seconds."* Good writing, and the on-prem framing is an asset.

Measured on the box: **20.5s** for the built-in example, **48.3s** for the novel one — i.e. the novel path
is 20% past the stated ceiling. On a projector that is a still frame with one 11px grey line and a small
spinning ring. **Have something to say for 30 seconds, use the built-in example (20s), and do not run two
compiles back to back** — the second call in my probe dropped the connection (`socket hang up`), though on
a dev server shared with other reviewers I cannot attribute that to the product.

### R2 — The one configurable trigger asks a business audience for a Kafka topic name
`AppBuilder.tsx:1135-1164` (`TopicTriggerFields`): a single **free-text monospace input** labelled
**"Which feed?"**, placeholder `claims.submitted`. No picker, no list of feeds that exist, no validation.
This is `docs/APP_AS_PRODUCT.md` GAP 0 (*"why is this free text? all of the data is already in the
organization"*) reintroduced on the trigger, and on a projector a monospace box wanting
`claims.submitted` reads as a developer config file in the middle of the no-code story.

### R3 — `[autotest]` app published in a customer-facing tenant, holding 4 waiting cases
`app_topicproof | org_suraksha | "[autotest] Claim event feed" | published | trigger=topic` — **4 waiting
cases.** `listApps` hides `[autotest]` titles on demo tenants (`apps-store.ts:406-409`) so it should stay
out of the Apps grid, but it is published, it is the **only** `topic`-triggered app on the box (so it is
the app he'd have to open to demo the live-feed trigger), and any surface reading runs rather than apps can
surface the literal string `[autotest]`. Rename it to "Claim event feed" or unpublish it.

### R4 — Every list on these surfaces renders an outage as "you have nothing"
On stage an empty surface looks unbuilt, which is worse than an error. Demo-relevant instances:

| file:line | swallowed read | projected result |
| --- | --- | --- |
| `build/studio/page.tsx:25` | `listApps(orgId).catch(() => [])` | **"Your apps"** with nothing under it — the front door |
| `solutions/apps/[id]/page.tsx:166` | `listAppRuns(id, orgId, 50).catch(() => [])` | app front door: no queue, no dashboard — **and the source-health banner that exists to warn about failed reads goes silent, because it is computed from the same swallowed rows** |
| `build/studio/new/page.tsx:25-26` | `listManagedAgents`, `listPipelines` | builder shows **no pipelines to pick**, steering him onto "No pipeline (unbound)" (D7) |
| `build/apps/[id]/quality/page.tsx:62,80,81,138` | four reads | Quality tab reads "no evidence" — the tab the Draft badge sends him to |
| `solutions/apps/[id]/dashboard/page.tsx:27` | `listAppRuns(…,500)` | owner dashboard: "this app has done nothing" |

~20 more of the same shape in `solutions/agents/**`, `solutions/quality/**`, `solutions/tools/**`,
`build/pipelines/**`, `build/apps/[id]/layout.tsx:32-33`. (`req.json().catch(() => ({}))` excluded.)

### R5 — The one waiting case on the FNOL app has no recommendation to approve
D1's screenshot, the "Waiting for a person" card:
> `Vehicle: TN09EF4567 · ClaimRef: CLM-20501` · Waiting for you · read 1 source · AI assessed it
> **"No recommendation was recorded — open the case to see the evidence."** · See the full case · Reject / Approve

The human-in-the-loop moment is the emotional peak of the demo — *"the AI recommends, a person decides"* —
and on the only waiting case of the app he'd open, **there is no recommendation**, because the run's data
read failed (D2). Clicking "See the full case" leads to the evidence of a failed read. Fix D2 and re-run
this case so it carries a real recommendation.

Also on that row: the label **"This was wrong"** sits between the case text and the Reject/Approve buttons
with no explanation of what it does.

### R6 — Two more items off-script
- **Back link says "Studio"**, a name the product retired. `build/studio/new/page.tsx:49-56` renders
  `← Studio` → `/solutions/apps`, while the sidebar row, the destination `<h1>` and its breadcrumb all say
  **"Apps"** (confirmed on `/tmp/audit/build/build_studio_new.png`). `/studio` is a 308
  (`route-migrations.mjs:18`). It is the only way back off the build screen.
- **"Create a custom blueprint" is a collapsed `<details>`** (`solutions/library/page.tsx:36-42`). If a
  prospect asks "can I define my own?", the answer is a small `+` disclosure row, not a call to action,
  and it is not URL-addressable so he cannot deep-link it. Same page's intro — *"Reusable BFSI contracts
  define the owner, requirements, outcome hypothesis, and evidence"* — is jargon for a business room.

---

## Demo readiness

### The story — strongest 2-minute build demo, exact route order
1. **`/solutions/apps`** — open on the roster. *"Four apps, each doing a piece of someone's job."* The
   cards read well: plain-language summaries, `2 waiting for a decision`, `Runs on: Reimbursement
   Governance`. **Fix D8 first or do not read the "9" out loud.**
2. **`/solutions/apps/new`** — *"Now let me build a new one, in a sentence."*
3. Click the built-in **"Reimbursement approval"** example card (right column) — **do NOT type a novel
   description, and do NOT take one from the audience** (D9). Click **Build the steps**.
4. **~20 seconds** — talk over it; the on-screen line already says it runs on your own hardware, which is
   the point worth making (R1).
5. **Refine phase** — five clean steps: Read Invoice → Check Employee Quota → Decide Eligibility →
   Manager Approval → Final Decision, with **"Everything is wired. You're ready to save."** This is the
   money shot. Point at the human step: *"a person decides, always."*
   **Avoid the right column** — the trigger card and the "Runs on / No pipeline (unbound)" card are D6/D7.
6. **Save** → lands on the new app's Work screen.
7. **A pre-built app with a live waiting case** for the approve-in-place moment. **Not** Motor Claim FNOL
   until D1/D2/D5 are fixed. Pick the app whose waiting case carries a real recommendation, and verify it
   on screen the morning of.

### What to avoid on stage
- **`/solutions/apps/app_e8b19b50`** (Motor Claim FNOL Triage) — red banner + amber unowned banner +
  false "Draft" pill + `$100,000` (D1, D2, D3, D4).
- **Any `/…/build` tab on a seeded app** — "Saved option (no longer available)" under a green
  "Everything is wired" (D2).
- **The trigger card** — do not click Email, WhatsApp or Schedule; do not let anyone read
  *"Runs on a recurring cron"* or *"An inbound HTTP call"* aloud (D6).
- **The "Runs on" card** — "No pipeline (unbound)" contradicts the governance promise (D7).
- **The bank tenant's Reimbursement Approval** — it will claim cases arrive by email (D5).
- **Typing `/build`** or following any pre-migration link — chromeless 404 (D10).
- **Reading the Apps stat band aloud** — "9 waiting" vs 5 openable (D8).
- **A second compile back to back** (R1).
- **`/solutions`** (the sidebar's own Solutions row) until D12 is seeded — two zero tiles, one of them red,
  a chain ending in 0, and the same warning printed twice.
- **"Start from a template"** — empty on the demo tenant (D13).
- **The Run screen's "Start a case" card** until D2/D14 are fixed — a permanent "Looking for cases…" and an
  example case reading *"In one line, what does this app do for the bank?"*. The panel to its **right** is
  excellent; show that one.

### Cheapest wins, ranked
0. **Production-build + restart the box, then re-walk every screen (D0).** Nothing else on this list is
   trustworthy until the running server provably executes the source on disk. This is also the single
   highest-value action: it may fix the dollar amounts on the review queue and the USD copy for free.
1. **Re-date the seeded runs forward** so they fall inside the dashboard window (D4). One UPDATE. Turns
   `HANDLED 0 · USUALLY TAKES Not measured · NEEDED A PERSON 50%` into a stat band that agrees with the
   list beside it. Biggest visible improvement per minute of work in this section.
2. **Fix the seeded apps' `domain` bindings** — label → real domain id (D2). One UPDATE per step. Clears
   the red banner (D1), the "Saved option (no longer available)" dropdown, and makes the app's next run
   succeed so the waiting case carries a real recommendation (R5).
3. **Set `slug` on the three published apps and re-own them to a real account** (D1). Two UPDATEs. Kills
   the false "Draft" pill and the `service@offgrid.local` banner, and makes **"Open the app"** appear —
   which is the click-through to the deployed app he currently cannot show at all.
4. **Flip the five `email`-trigger apps to `on-demand`** (D5). One UPDATE. Stops five screens promising a
   channel that does not exist.
5. **Copy only, ~30 lines:** in `InheritanceBanner.tsx` drop the zero chips and rewrite the paragraph in
   plain language; in `AppBuilder.tsx:121-136` hide `email`/`whatsapp` (or badge them from
   `triggerAvailability`, which already returns the sentence), and reword *"recurring cron"* → *"on a
   schedule you set"* and *"An inbound HTTP call"* → *"another system sends the work in"*; rename
   *"No pipeline (unbound)"* → *"Use my organisation's default"*; purge `USD`/`$100,000` from the FNOL
   app's summary and agent prompt (D3); rename `[autotest] Claim event feed` (R3); relabel the back link
   *Studio* → *Apps* (R6).
6. **Seed `solution_deployments`** — re-run `scripts/seed-solution-deployment.mts` (D12). The table is empty
   on all three tenants, which is why the Solutions overview's chain dead-ends in `0` with a warning printed
   twice. The progress log already claims this was done; it is not true on this box.
7. **Publish 2–3 of the demo tenant's apps as templates** (D13) via the existing `publish-as-template`
   route, so `Reusable templates` is not `0` and "Start from a template" is not a dead end. Alternatively
   demo from `org_bharat`, which has 3 — but that tenant has the `email`-trigger problem (D5), so fix that
   first if you go that way.
8. **Delete the junk probe run** whose input is *"In one line, what does this app do for the bank?"* (D14).
   One DELETE. It currently supplies the example case on the Run screen AND the top row of "Recently
   handled" on the Work screen.
9. **Raise the `/solutions` timeouts from 1.5s to ~8s** (D11), one line. Insurance only — the live page
   showed the correct numbers.

### Rehearsal checklist (do these on the box the morning of)
- **FIRST: production-build + restart, then confirm `/solutions/reviews` shows `₹12,00,000`, not
  `$1,200,000`** (D0). If it still shows dollars, the box is not running current code and nothing else on
  this list should be trusted.
- Load **`/solutions`** twice cold; confirm `Published apps` is not `0 of 0` (D11).
- Load **`/solutions/apps`**; confirm the "Waiting for a person" number equals the sum of the card badges (D8).
- Open the app you plan to demo; confirm **no red banner, no amber banner, no "Draft" pill**, and that
  **"Open the app"** is present (D1).
- Open its **Build** tab; confirm no dropdown reads "Saved option (no longer available)" (D2).
- Confirm its one waiting case shows a **real recommendation**, not "No recommendation was recorded" (R5).
- Run the built-in **Reimbursement approval** compile once and time it (expect ~20s); do not run a second.

---

## Out of scope for the demo (POST-DEMO, one line each)
- `src/lib/app-run-store.ts:79` — `currentPolicyVersion(orgId).catch(() => 0)` writes "policy version 0" into a run's audit row on a failed read; no visible demo symptom.
- `src/lib/app-compile.ts:186` — `modelDecompose(...).catch(() => null)` silently falls back to a keyword heuristic with identical wording; invisible unless it fires on stage (see R1 for the demo-facing half).
- DRY: trigger validity implemented twice — `app-model.ts:144` (kind-membership only, the one that runs) vs `triggers.ts:61` (real per-kind rules, dead). The correctness half of D6.
- `orgId: string = DEFAULT_ORG` default params across `app-run-store.ts`, `app-versions-store.ts`, `app-run-controls-store.ts`, `app-runs-view-reader.ts`, `webhook-triggers.ts` — every call site inspected passes an explicit org; no visibly wrong number found.
- `/build/pipelines/**` (11 pages) is source under a fully-redirected path, re-exported by `/runtime/pipelines/**`; confusing for engineers, invisible to a viewer.
- No egress enforcement (proven by a sibling audit): the builder's *"routing … applied automatically"* and *"its model gateway, data ceiling"* claim governance that is badge-only. Only becomes a demo problem if a prospect asks him to show it blocking something — in which case it is a DEMO-RISK he should not invite.
- `/solutions/catalogue` correctly redirects to `/solutions/library` (`catalogue/page.tsx:1-9`) — not a defect; the doc's claim is accurate.
- **Width discipline is CLEAN** — no `mx-auto max-w-{2,3,4}xl` page roots anywhere in the section; `PageFrame` is `w-full`. Do not "fix" this. The only width nit is `build/studio/page.tsx:83` (`lg:grid-cols-5` with four `<Stat>` children → a ~20% empty gutter on the Apps stat band).
