# Demo narrative — the end-to-end walk (2026-08-05)

Role: **Demo Director.** Not a section reviewer. The question is not "is this surface correct" but
**"is there a coherent 10-minute demo, and does it hold up click by click?"**

Lens: `scratchpad/demo-lens.md` — DEMO-BLOCKER / DEMO-RISK / POST-DEMO. There are no live customer
deployments; this is a conference showcase.

Method: read all nine sibling audit files first (do not re-derive their findings), then shoot and
**open** the screenshots of the narrative path at 1600px dark, follow the real links between sections,
resolve real ids from the live box, and judge each image as a projected 16:9 seen from row 10.

Status: IN PROGRESS — appended as confirmed. (A previous run of this audit lost five teams to a
session limit; this file is the durable artefact.)

---

## Coverage log

- [x] `demo-lens.md`
- [x] Sibling audits: `governance.md`, `insights.md`, `data.md`, `solutions-build.md`,
      `work-workspace.md`, `operations.md` (read); `gateway.md`, `operations-observability.md`,
      `runtime.md`, `demo-gateway-operations.md` (pending)
- [ ] `docs/APP_AS_PRODUCT.md`
- [ ] Landing copy `src/app/page.tsx` + `src/app/_landing/**` — the promise
- [ ] Shoot 1: narrative spine `/,/overview,/data,/build,/build/studio,/work,/governance,/governance/evidence,/insights,/solutions,/operations`
- [ ] Shoot 2: the transitions (real ids — app detail, run detail, evidence detail, quality tab)
- [ ] Judge every PNG as a projected image

---

## The promise the demo has to deliver (from the landing copy)

`src/lib/landing-copy.ts` + `src/app/page.tsx`. Two things matter for the walk:

1. **The landing page already picks the demo order.** `SHOTS` in `page.tsx:35-42` is the product tour,
   six real console screenshots in a deliberate sequence with a one-line caption each:
   **Act** (Studio, plain language) → **Route** (gateways) → **Govern** (pipeline) → **Watch**
   (observability) → **Review** (app review inbox) → **Prove** (regulatory). *That* is the narrative
   the buyer has already been sold before he opens the console. **The live walk should match it**, not
   the data-first order in the brief. See the recommended route at the bottom.
2. **The specific promises a live click must not contradict:**
   - `numbers.metrics`: "Control mappings **4** — ISO 42001, NIST AI RMF, EU AI Act, DPDP" → must be
     provable on `/governance/regulatory`. **It currently renders a `GAP` badge for the insurer tenant
     — see N4.**
   - `numbers.metrics`: "Live product **2** — Seeded bank and insurer environments." The seeded,
     credible Indian-BFSI data lives in `org_bharat` + `org_suraksha`. **The console's dev sign-in
     lands in `default`, which is not one of them — see N1, the single largest cross-section finding.**
   - `trust.items`: Provenance · Citations · Observability · Guardrails · Human review · Evaluation and
     drift. Five of those six have a named surface; **"Guardrails — stop unsafe behavior before it
     becomes an action" has no demonstrable blocking event on this deployment — see N3.**
   - `hero.offer`: "Five working AI use cases. Live in 14 days." So the audience expects to see a
     *working use case*, end to end — which is the Reimbursement / Death-Claim path.

---

## Findings

### N1 — DEMO-BLOCKER — The tenant he signs into decides whether the story works, and the default one is the broken one

This is the finding no per-section reviewer could produce: six teams each logged an org-scoping bug in
their own section. Stacked on one narrative, they have a single demo-level consequence.

The console's dev sign-in (`dev@offgrid.local`) resolves to org **`default`**. The seeded, credible
BFSI demo data — the thing the landing page calls "Seeded bank and insurer environments" — is in
`org_bharat` and `org_suraksha`. On `default`, from the sibling audits' own live measurements:

| surface | on `default` | on the seeded tenants |
| --- | --- | --- |
| masking rules (`governance.md` B1) | **0** | 8 each |
| audit events (`governance.md` B1) | 20 | 0 — *and the seeded tenants render `default`'s 20 as their own* |
| catalogued data assets (`data.md`) | **0** `data_assets` (while the hub says "Datasets 4 · 3,60,759 rows") | 12 / 4 |
| `awaiting_human` runs (`solutions-build.md` B6, `work-workspace.md` W6) | 9 counted, **5 openable** — 4 orphaned by deleted apps | consistent |
| apps | 4 unbranded | the 11 real BFSI apps (KYC, Personal Loan Underwriting, Reimbursement, Death-Claim, Policy Underwriting) |

So on the tenant he lands in: Data says "4 datasets" and the catalogue that governs them says **0**;
Governance says PII masking is a **GAP** with 0 rules; the work count is wrong by 80%; and none of the
Indian-BFSI apps that make the story concrete are visible.

Meanwhile, **on the seeded tenants the governance surfaces render `default`'s data**
(`governance.md` B1/B3: `computeControls()` and `readProvenanceView()` take no orgId). So there is
currently **no single tenant on which the whole narrative is coherent**: `default` has the governance
data and none of the apps; the seeded tenants have the apps and are shown `default`'s governance.

**Consequence for the demo:** this is not one bug to route around, it is the *choice of demo account*.
Decide the tenant first, then make that tenant coherent. Cheapest path in "The 5 cheapest fixes".

### N2 — DEMO-BLOCKER (first 15 seconds) — "Welcome back, Dev", and the two stat bands under it are all zeros

Screenshot: `/tmp/audit/demo-path/overview.dark.png` (1600px, judged as a projected image).

**What holds up** — and it is more than I expected. Full-width, no empty gutters, high-contrast emerald
on near-black, and the lead band is a genuine human hook at a size that reads from row 10:

> **5 cases are waiting for you to decide.** · Oldest has been waiting 30 days — nobody has picked this up. · `Open my tasks →`

That is the right opening sentence for this product. Three things spoil the frame:

1. **`Welcome back, Dev`**, avatar `DE`, account `dev@offgrid.local`. The largest words on the screen
   after the h1 announce that this is a developer's test login. Every buyer in the room reads
   "engineering demo", not "product". A named business persona ("Welcome back, Priya") is a seed-data
   change, and it is the highest-leverage 10 minutes in this whole audit.
2. **"Oldest has been waiting 30 days — nobody has picked this up."** True, and honest, and on stage it
   says *nobody uses this system*. Those are the 4 orphaned cases from N1 (waiting since 2026-07-09).
   Deleting them fixes the "9 vs 5" number AND this sentence at the same time.
3. **Two consecutive all-zero bands.** *Governance posture*: `BLOCKING DECISIONS (24H) **0** — nothing
   stopped, all clear`, then a full-width panel repeating *"Nothing was blocked in the last 24 hours —
   your controls held with no interventions needed."* *Cost*: `SPEND $0` · `ON-PREM DIVIDEND 0%` ·
   `KEYS OVER BUDGET 0`. Six zeros in the top two thirds of the opening screen. Individually each is
   defensible; as a projected image it reads *nothing is happening here*.
   - `ON-PREM DIVIDEND 0% — "ran free on your own hardware"` is also **visibly self-contradicting**: if
     everything ran on your own hardware the dividend is 100%, not 0%. A CFO in the audience catches
     that in one second.
   - `POLICY ENGINE · Policy-as-code` is a stat tile whose *value* is a category name, not a
     measurement — it reads as a placeholder next to three real numbers.

### N3 — DEMO-BLOCKER — The one governance proof the landing page sells ("stop unsafe behavior") has nothing to show, on any surface

`trust.items` promises *"Guardrails — stop unsafe behavior before it becomes an action."* The obvious
follow-up question in the room is **"show me it blocking something."** Today:

- `/overview` (above): `BLOCKING DECISIONS (24H) 0`, and a panel saying nothing was blocked.
- `/governance` guardrails overview understates the live detector as *"Built-in pattern detection ·
  Supported entity types: 4"* (`governance.md` MAJOR-1) — a regex, not the real scanner.
- The guardrail **tester** is the only interactive proof, and it puts the typed PII **into the URL**
  under the sentence "Nothing is stored" (`governance.md` MAJOR-3) — so demoing it on a projector puts
  a PAN or an Aadhaar in the address bar in front of the room.
- The thresholds / recognizers / anonymizer panels he would naturally open next **do not reach the
  engine that enforces**, while the page states they "apply exactly as they do to a real request"
  (`governance.md` B7).

So the strongest single governance moment in the deck has (a) a zero on the home screen, (b) an
understated detector, (c) a tester that leaks on screen, and (d) settings that lie about being live.
**One retained blocking decision in the demo tenant fixes (a) and gives him something to click.**

### N4 — DEMO-BLOCKER — "Prove" is the landing page's closing shot, and the live page shows a `GAP` badge

`SHOTS[5]` is `/docs-shots/regulatory.png`, captioned *"Controls mapped to the frameworks a regulator
asks for"*, and `numbers.metrics` counts **4 control mappings**. The live surface behind it:
`computeControls()` reads with **no orgId** (`governance.md` B1), so on the insurer tenant the
regulator-facing pack states **"PII masking (A9) — GAP — 0/0 rules enabled"** while 8 masking rules are
configured and enforcing, and reports another tenant's 20 audit events as the insurer's evidence.

A red `GAP` badge on the compliance slide is the worst possible frame for this section, and it is a
**false negative** — the control is satisfied. Two more controls (`egress-dlp`, `erasure`) are
hardcoded `satisfied` (`governance.md` B2), so the same panel simultaneously under-reports a real
control and over-reports two unmeasured ones. Do not open the regulatory pack until B1 is threaded.

**Judged live** — `/tmp/audit/demo-gov/governance_regulatory.png`. Worse than the code reading:

- **`OVERALL POSTURE 63%`** is the largest number on the screen. On the compliance slide of a talk
  about being governed end to end, a headline **63%** is a failing grade. A CISO reads that number and
  nothing else. He must not open this page at 63%.
- `PII masking (A9)` renders as a **red/pink gap chip** on the DPDP card, exactly as B1 predicts.
  `Input guardrails (C2)` is red on **three of five** framework cards.
- **Three different counts of "frameworks" reachable in two clicks:** the landing page says
  "Control mappings **4** — ISO 42001, NIST AI RMF, EU AI Act, DPDP"; this page renders **5** cards
  (it adds GDPR); and the copy at the bottom of the same page says *"**Three** real AI-governance
  frameworks ship in the box."* Four, five and three, for one concept.
- What *is* genuinely good here and worth keeping: the **"Full evidence pack · Download"** card
  ("A regulator-ready Markdown pack … generated live from the control plane"). Handing a regulator a
  generated artefact is a strong beat — but per B1 the generated pack carries another tenant's audit
  events, so **do not download it on stage.**

### N5 — DEMO-BLOCKER — `/work/tasks` is the strongest screen in the console AND it carries four things that read as neglect

Screenshot: `/tmp/audit/work/work_tasks.png`. This is the best single image in the product and it is
two seed-data edits away from being excellent.

**Why it sells:** four cards, real Indian-BFSI cases, legible at distance —
`Reimbursement Approval · Amount: ₹63,000 · Category: Client-Entertainment` ·
`KYC & Re-KYC Verification · Pan: ABCPD1234K · Customer: Rohan Desai` ·
`Personal Loan Underwriting Assist · Foir: 47 · Amount: ₹12,00,000` ·
`Motor Claim FNOL Triage · Vehicle: TN09EF4567 · ClaimRef: CLM-20501`. Headline
*"5 cases are waiting for you to decide. Oldest first — the case that has waited longest is the one
that needs you most."* That is the product, in one frame, in plain language.

**What is wrong, all visible in the same frame:**

1. **The sidebar badge reads `My tasks 9`, 60px above a heading that reads "5 cases".** `work-workspace.md`
   W6 / `solutions-build.md` B6 in one screenshot. Nothing else on stage is this easy for an audience to
   catch, and it is the metric the whole story is about.
2. **An amber warning banner across the top:** *"No decision target is set for 4 processes, so nothing
   will ever flag as late."* The first coloured thing on the screen is a misconfiguration notice.
3. **`Oldest has been waiting 30 days — nobody has picked this up.` on all four cards, in amber.** Four
   lines telling the room that nobody has used this system for a month. This is the single most
   damaging sentence in the console, and it is repeated four times on the best screen.
4. **`Invoice: INV-1 $200`** — one case subject is a placeholder id and a **dollar** amount, sitting
   directly under `₹63,000` in the same card. Both the "looks like test data" and the currency
   inconsistency, in one row.
5. Minor: the full-width `Who is covering` panel exists only to say *"Nobody is marked away"* — prime
   real estate above the cases spent saying nothing is configured. `Foir: 47` reads as a raw column name.
6. Minor: the bottom quarter of the frame is empty (4 cards in a 2-col grid at 1600px).

### N6 — DEMO-BLOCKER — Both openable apps on the demo account are `Draft`, and one opens with two error banners

Screenshots: `/tmp/audit/build3/solutions_apps_app_e8b19b50.png` (Motor Claim FNOL Triage),
`/tmp/audit/work2/solutions_apps_app_bdd24eab_runs_seedrun_reimb_04.png` (Reimbursement Approval run).

The app front door is where the story lands after the queue. On this deployment:

- Both apps carry the amber pill **`Draft — check it, then publish ↗`** top-right. "This app isn't
  finished" is the frame on the app he is demonstrating.
- **Motor Claim FNOL Triage opens with two stacked banners above its h1:**
  - RED: *"This app could not read Read the claim & policy on its last run. Until that is fixed it is
    working from nothing."* (note the duplicated verb — "could not read Read" — a copy bug in the one
    sentence he cannot afford).
  - AMBER: *"`service@offgrid.local` owns this but no longer has an account here. It is effectively
    unowned. Change who owns it"* — an internal service-account email, on screen.
- Its stat band reads `HANDLED 0 · WAITING ON A PERSON 1 · COULD NOT FINISH 1 · USUALLY TAKES Not
  measured · NEEDED A PERSON 50%`. Handled zero, failed one, duration not measured.
- Its **"Recently handled"** list leads with two `Could not finish` rows, and the first one's subject is
  **`In one line, what does this app do for the bank?`** — somebody's test prompt persisted as a case.
  A row like that on the projector ends the credibility of the data.
- The waiting case says *"No recommendation was recorded — open the case to see the evidence."*

**What holds up on the same screens** (and is worth building the demo around): the run detail
(`…/runs/seedrun_reimb_04`) is a genuinely strong governance image — three numbered steps ticking over
(`1 Fetch quota ✓ Done` → `2 Assess ✓ Done` → `3 Manager review ⚠ Awaiting review · "Exceeds quota —
needs L2 sign-off"`), then `RISK LOW · "Nothing is sent or changed after this decision — it is
recorded only."` and `CONFIDENCE HIGH · "All 1 source were read and narrowed to this case."`, then the
`Human review` block with Approve / Reject / "This was wrong" inline. That is the "governed run,
visible" beat the landing page promises.

Three defects on that otherwise-good screen:
- **`version not recorded · policy version not recorded`** in the run's own metadata line — on the
  screen whose job is to prove provenance. The landing page sells *"Provenance — see where every
  answer and action came from."*
- **Currency flips mid-narrative on ONE case:** the queue card says `₹63,000`; the run's steps say
  `Quota $40,000 — exceeded` and `Over quota by $23,000`; and the risk panel says
  `This decision covers 63,000.` with **no symbol at all**. Three currencies for one case in two clicks.
- The run id renders as **`Run seedrun_reimb_04`** — the literal word "seedrun" tells the room the data
  is fabricated. `All 1 source were read` is also ungrammatical.

### N7 — DEMO-BLOCKER — A stale or cross-tenant app link is a chromeless full-page 404 that dumps him out of the console

`solutions-build.md` B7 found this for bare `/build`. It is broader and worse: **any app id the
signed-in org does not own** renders the global not-found — no sidebar, no header, no breadcrumb, just
a centred magnifier, *"Page not found"* and *"That route doesn't exist, or the module isn't enabled for
this deployment."* Verified on eight consecutive routes: `/tmp/audit/build2/solutions_apps_app_77b5b421*.png`
(the base page and all seven tabs) and `/tmp/audit/build-flow/05-canvas.png`.

Confirmed live for bare `/build` too: `/tmp/audit/demo-path/build.dark.png` is a **19 KB** image where
every other console page is 130–200 KB — i.e. a blank page.

**Why it is a demo-blocker and not a nicety:** the chrome disappearing is what makes it fatal. A 404
inside the console shell is a shrug; a white page with one button is "the product crashed". The three
plausible ways he hits it on stage: a bookmark or slide link from an earlier rehearsal on a different
tenant; typing `/build` (it prefixes every internal file path and every pre-migration URL); and
demoing a restricted role, where a *permission* outcome is rendered as a broken product by that copy.

### N8 — DEMO-BLOCKER — `/data` is the worst possible opening section: a red tile, a red `Offline` badge, a self-contradicting tile, and a dead primary CTA

Screenshot: `/tmp/audit/demo-path/data.dark.png`. The brief's narrative starts here. It should not.

Good bones: full-width, strong h1 (*"Make enterprise context reusable intelligence"*), a 4-tile stat
band, a 7-card "Inside data" grid, and a "Manage the data plane" row. Then:

1. **`INGEST ATTENTION 1` is rendered in a RED-BORDERED tile** — *"Ingest jobs currently marked failed
   or error."* A red tile in the stat band of the demo's opening screen.
2. **`KNOWLEDGE INDEX · 3 vectors · "0 source documents available for indexing."`** — the tile
   contradicts itself. (Three surfaces render this one number as `0`, `—` and `3` — `data.md`.)
3. **`DATASETS 4 · 3,60,759 cataloged rows` → `Open catalog` → "No datasets catalogued yet."** The
   first drill-down in the demo lands on an empty page that contradicts the tile you clicked
   (`data.md` BLOCKER: two unrelated registries). A broken transition in section 1.
4. **`Data quality — Offline`** as a red badge in "Manage the data plane".
5. **The primary CTA `Manage sources` navigates to the page you are already on** (`/data/sources`
   re-exports `/data`), and so does the `Sources` card below it (`data.md` MAJOR).
6. Four card descriptions truncate mid-word (`"Moves source data into the wareh…"`) — sloppy at
   projector size.

Two red indicators, one impossible tile, one dead CTA and one empty drill-down, before he has said
anything. **Data must not be the opening act** — see the recommended route.

### N9 — DEMO-BLOCKER — The home page says "fully on-prem, nothing left"; the Governance page says cloud egress is "Allowed". Two clicks apart.

This is the worst cross-section contradiction in the console, and it lands on the product's single
biggest claim.

| screen | what it states |
| --- | --- |
| `/overview` (`overview.dark.png`) | `CLOUD EGRESS` · **0%** · *"fully on-prem — nothing left"* |
| `/governance` (`demo-gov/governance.png`) | `CLOUD EGRESS` · **Allowed** · *"Org egress posture — when leashed, cloud routes are blocked everywhere."* |

One says nothing leaves; the other says leaving is permitted. The positioning is *"a private AI on
your own hardware."* A CISO reconciles those two tiles faster than he can finish the sentence, and the
honest reading — 0% is a measurement, "Allowed" is a setting — is a distinction the audience will not
make for him. Compounding it, that setting is deployment-global and mislabelled "Org egress posture"
(`governance.md` B5).

**Cheapest fix: set the org policy to leashed** so both tiles agree, and the `0%` becomes evidence of
an enforced rule rather than a coincidence.

### N10 — DEMO-BLOCKER — `/governance` and `/governance/posture` are the same screen, and it has three red tiles

Screenshots: `/tmp/audit/demo-gov/governance.png`, `/tmp/audit/demo-gov/governance_posture.png` — the
h1, the subtitle and the stat band are **identical**, so the sidebar's first Governance row does not
go anywhere new. On that shared screen:

1. **`SOURCES WITHOUT A LAWFUL BASIS` · `5` · red border** — *"Of 5 data sources, 5 do not record why
   we are permitted to process them. Runs reading these are flagged."* Five of five. On the DPO's page.
2. **`ACCESS CERTIFIED` · `Never` · red border** — *"Nobody has ever certified this access list."*
3. **`PEOPLE WITH ACCESS`** rendered **`3`** on one load and **`Unavailable` · "Users did not respond."
   in a red-bordered tile** on the next — the same tile, two consecutive shots. So the count of red
   tiles on his governance screen is **2 or 3 depending on the load**, and he cannot rehearse it away.
4. **`TEAMS 0`** — the delegated-access story has no data on the demo org (the memory note records
   Teams RBAC as verified live; the *rows* are missing, not the feature).
5. **`Recent activity`** — four rows reading **`qwen3-vl-8b`** with actors
   `chat:codex-dlp-c5e8e01e@getoffgridai.co` and `chat:demo-editor@getoffgridai.co`, dated 2026-07-22 /
   07-31. The governance ledger's activity feed is a raw model tag plus machine-generated identities,
   stale by a fortnight. That is engine jargon and obviously-synthetic actors on the compliance surface.

What holds up: the *"Inside governance"* 8-card grid (Posture / Policies / Access / Teams / Guardrails /
Secrets / Evidence / Trust & regulatory) is clean, legible and a good "here is the shape of governance"
frame. The h1 — *"Set controls once and inherit them everywhere"* — is the right sentence.

### N11 — DEMO-BLOCKER — The narrative's closing section opens on three red `Unavailable` tiles

Screenshot: `/tmp/audit/ops/operations.png`. `operations.md` OPS-10 proved this is arithmetic, not a
flake: the page gives `computeStatus()` a **1500 ms** budget and it measured **20.1 s / 37.3 s**. So
`/operations` will ALWAYS render:

> `SERVICE HEALTH` **Unavailable** *"Service probes did not complete."* ·
> `RUNS IN PROGRESS` **Unavailable** ·  `RUNS NEEDING ATTENTION` **Unavailable** *"Run records did not respond."*

Three red-bordered tiles, side by side, as the image for *"and it all runs on infrastructure you own."*
Also on this screen: the sidebar renders **`Managed devices  SOON`** — a coming-soon badge in the nav.

`/operations/services` is not the alternative (`/tmp/audit/demo-ops/operations_services.png`):
- **every readiness chip is truncated to gibberish** — `DEPLOY…` `REACHA…` `FUNCTI…` `SEEDED` `CONSOL…`,
  five per card across 13 cards. Unreadable from row 10 and it looks broken.
- **every card shows a spinner and the word `checking`, permanently** (`gateway.md` §5: `health = {}` on
  any non-2xx, re-polling forever). Nothing on the screen ever turns green.
- **infrastructure coordinates and engine names, projected**: `offgrid-s1.local:4000`,
  `offgrid-s1.local:8800`, `offgrid-s1.local:8010`, `offgrid-s1.local:8080`, `gateway.getoffgridai.co`,
  plus "LiteLLM Router", "PostgreSQL + pgvector", "LLM Guard", "Caddy reverse proxy".
- `CAPABILITY AUDIT · 0/1 in workflow` on Gateway Control — a zero, in language nobody can read.

**The one Operations screen that DOES sell** is `/operations/services/capability-map`
(`/tmp/audit/ops2/operations_services_capability-map.png`): `INVENTORY 49 · CURRENT AUDITS 49 · STALE
AUDITS 0 · PENDING AUDITS 0`, and every row a green `current` + `verified`, with tabs (Data 11 · AI
runtime 7 · Governance 6 · Observability 8 · Operations 11 · Enterprise sources 6). "Forty-nine
services, all verified" is a real closing line. Two caveats: **the right 60% of the screen is empty
until a row is clicked** (*"Choose a service to inspect its evidence"*), so open it with a service
already selected; and `LiteLLM Router` appears in the list.

### N12 — Two of the strongest screens in the product, and the one number that spoils each

**`/solutions/apps`** (`/tmp/audit/build/build_apps.png`) — the best "front door" in the console. The
intro copy is exactly right for a business room: *"An app does a piece of your work — describe it in
plain language and it gets built. Your company's rules about data, safety and who approves what are
already applied to every one, so you do not set any of that up."* Four real BFSI apps with plain
descriptions, step counts, waiting badges, `Runs on: <pipeline>`, and `New app` / `Start from a
template` as the two primary buttons.
- **Spoiler:** the stat band reads `WAITING FOR A PERSON` **9** while the four cards below badge
  **2 + 1 + 1 + 1 = 5**, in the same frame (`solutions-build.md` B6).
- **Second, needs a 2-minute check:** the band says `LIVE 3 · DRAFTS 1`, but **both** apps I opened
  (`app_e8b19b50` Motor Claim FNOL, `app_bdd24eab` Reimbursement Approval) render the
  `Draft — check it, then publish` pill. Either the stat or one pill is wrong; confirm which before
  opening an app on stage.
- The bottom third of the frame is empty (4 cards, one row, 1600px).

**`/runtime/pipelines`** (`/tmp/audit/runtime/runtime_pipelines.png`) — seven pipelines, **all
`published`**, all badged `On-Prem Cluster` + `on-prem`, each with a `Data ceiling: N domains`, and all
named after real BFSI processes (Fraud Screening, KYC Verification, Loan Underwriting, Motor-Claim FNOL,
Reimbursement Governance, Cross-Sell Advisor). This is the most convincing single image of "governed,
on your own hardware" in the console.
- **Spoiler:** the subtitle is five platform terms in one sentence — *"Reusable, governed model-access
  contracts. A pipeline binds a **gateway**, fixes a hard **data ceiling**, and layers **policy** +
  **guardrails**; apps, agents, and chat consume it."* Rewrite that one line and the screen is
  presentable to a department head.
- A **red delete icon on every card** is the most visually prominent per-card control; at distance a
  red glyph on seven cards reads as seven errors.
- `AI Quality Judge` is an internal system pipeline shown with `Data ceiling: none` — an opt-out of the
  ceiling, on the screen selling the ceiling.

### N13 — DEMO-RISK — The single most important click in the demo is unverified, and it can silently degrade

"Build the steps" on `/solutions/apps/new` is the moment the headline claim is proved. Two facts:

- **The live drive did not visibly advance.** `/tmp/audit/build-flow/03-refine.png` and `04-refine-full.png`
  are **byte-identical frames** (same typed GST description, same "Build the steps" button, no steps),
  and `05-canvas.png` is a chromeless 404. So no screenshot in this audit shows the refine phase. I
  could not re-drive it — the shared dev server would not answer `/api/auth/csrf` within 30 s under five
  concurrent reviewers, which is a measurement artefact, not a product fact.
- **When it does run, it can fall back silently.** `app-compile.ts:186` —
  `await deps.modelDecompose(...).catch(() => null)` — and either path shows the same toast
  (`solutions-build.md` R1). A model flake gives him the keyword heuristic's steps, possibly without the
  human-approval step that is the whole governance story, with nothing on screen to say so.

**Therefore: rehearse the exact sentence he will type, time it, and have a pre-built app open in a
second tab.** Do not let the live build be the only path to the rest of the demo.

The describe screen itself (`03-refine.png`) is otherwise good — big textarea, real GST use case, three
example cards, *"We only bind steps to data sources your org has declared — never a fabricated one."*
Three things to fix on it:
- the green inheritance strip reads `8 connectors · 5 data domains · **0 tools** · **0 KB docs** ·
  guardrails on · policy v10` under the heading **THIS APP INHERITS** — two zeros in a band whose job is
  to say you are not starting from nothing, plus nine platform terms (`solutions-build.md` B4).
- `What you can use · 16 ready · 3 need approval · **3 unavailable**` — "3 unavailable" reads as
  "3 things are broken".
- the back link says **`← Studio`**, a name the product retired, while the sidebar highlights **Apps**
  (`solutions-build.md` R4).

