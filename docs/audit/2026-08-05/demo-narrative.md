# Demo narrative — the end-to-end walk (2026-08-05)

Role: **Demo Director.** Not a section reviewer. The question is not "is this surface correct" but
**"is there a coherent 10-minute demo, and does it hold up click by click?"**

Lens: `scratchpad/demo-lens.md` — DEMO-BLOCKER / DEMO-RISK / POST-DEMO. There are no live customer
deployments; this is a conference showcase.

Method: read all nine sibling audit files first (do not re-derive their findings), then shoot and
**open** the screenshots of the narrative path at 1600px dark, follow the real links between sections,
resolve real ids from the live box, and judge each image as a projected 16:9 seen from row 10.

Status: **COMPLETE.**

---

## Coverage log

- [x] `demo-lens.md`
- [x] All nine sibling audits read (`governance`, `insights`, `data`, `solutions-build`,
      `work-workspace`, `operations`, `gateway`, `operations-observability`, `runtime`,
      `demo-gateway-operations`) — findings re-scored on the demo lens, never re-derived
- [x] `docs/APP_AS_PRODUCT.md`
- [x] Landing promise: `src/app/page.tsx`, `src/lib/landing-copy.ts`, `src/lib/demo-tenants.ts`,
      `src/app/_landing/see-it-live.tsx`
- [x] **23 screens opened and judged as projected 16:9 images** — my own shoot
      (`/tmp/audit/demo-path/`: `/`, `/overview`, `/data`, `/build`, `/work`, `/governance`,
      `/governance/evidence`, `/insights`) plus the siblings' shots followed along the real link
      graph (`/work/tasks`, `/solutions/apps`, `/solutions/apps/new`, an app front door, a run detail,
      `/solutions/reviews` + its detail, `/solutions`, `/data/catalog`, `/runtime/pipelines`,
      `/runtime/models`, `/operations`, `/operations/services`, the capability map,
      `/governance/posture`, `/governance/trust/regulatory`)
- [x] Transitions resolved with **real ids** on the signed-in tenant (`app_e8b19b50`, `app_bdd24eab`,
      `seedrun_reimb_04`) and cross-tenant ids tested for the 404 behaviour
- **Not verified, stated as such:** the refine/canvas phase after "Build the steps" (no screenshot
  exists in this audit — see N13), and `/insights` sub-pages below the section root. The shared dev
  server was saturated by five concurrent reviewers; I did not treat its slowness as a product defect.
- **Hard limit on this environment:** the dev credentials provider is a single fixed identity
  (`dev@offgrid.local` → org `default`, `src/auth.config.ts:60-68`), so **every screen above is the
  `default` tenant.** The seeded bank/insurer tenants are separate hosts bound to their own orgs and
  are read-only. That limitation is itself finding N1.

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

### N14 — DEMO-BLOCKER — One case, three currencies, across three screens on the demo path

This is the cross-section inconsistency an audience is most likely to catch, and it is on the case he
will actually open. Following the SAME reimbursement case (₹/$63,000, `Client-Entertainment`):

| screen | what the amount reads |
| --- | --- |
| `/work/tasks` (`work/work_tasks.png`) | `Amount: ₹63,000 · Category: Client-Entertainment` |
| `/solutions/reviews` (`work2/reviews.png`) | `$63,000` — in the largest, amber, card headline |
| `/solutions/reviews/…` detail (`work2/review_detail.png`) | `Approve $63,000 …` + `$63,000` + `Over quota by $23,000` |
| the run's steps (`work2/…runs_seedrun_reimb_04.png`) | `Quota $40,000 — exceeded` · and `This decision covers 63,000.` **with no symbol** |

The same is true of the loan case: `₹12,00,000` on `/work/tasks`, **`$1,200,000`** on
`/solutions/reviews`. ₹12 lakh and $1.2M differ by roughly 85×. A banker in the room reads that
immediately, and it undermines every other number in the demo.

`docs/APP_AS_PRODUCT.md` records this as fixed (*"Demo currency copy corrected — 8 apps said 'Amounts in
USD ($)'… `scripts/fix-demo-currency-copy.mts`"*). **It is not fixed on the review surfaces or in the
step outputs** — that script corrected app `summary` copy, not the run payloads the review cards format.
This is the cheapest high-impact fix in the audit.

### N15 — DEMO-BLOCKER — At the climax of the demo, the "Trust checks" panel says nothing was checked

`/tmp/audit/work2/review_detail.png` is the approval moment — the single screen the whole narrative
builds to. Its right rail leads with:

> **Trust checks** · `Faithful to sources` — **Not scored**
> *"Not scored — grounding was not measured for this run, so treat the answer as unchecked rather than
> as verified."*
> *"No guardrail findings recorded for this draft."*

So on the screen where a human takes responsibility for an AI decision, the platform states that
grounding was not measured and no guardrail ran. The landing page sells *"Citations — check claims
against their sources"* and *"Guardrails — stop unsafe behavior before it becomes an action"* — both
answered "not scored / none" here. It is honest (and the honesty is good engineering) but it is the
worst possible sentence to project at that moment.

**The single highest-value fix in this whole audit: produce ONE reimbursement run that has a real
grounding score and at least one recorded guardrail finding, and demo that run.** Everything else on
this screen already works and reads well:
- `Approve $63,000 — Reimbursement Approval?` · `Paused at Manager review`
- `What the app recommends: Over quota by $23,000`
- `The request` — `Amount / Category / Employee: Anjali Nair`
- `WHY THIS NEEDS YOU — This step is configured to require a person to sign off before the run continues.`
- a required reason field, `Edit what this will do before approving`, `Escalate to`, and
  `Reject · Escalate · Approve`.

Two further defects on that screen: the word **"draft"** appears again (*"for this draft"*), and **the
left 60% of the frame is empty** — one small card holding a single line of text, then ~600 px of blank
space, with the entire substance in the right rail. On a projector the climax screen looks half-built.

### N16 — DEMO-RISK — `/solutions/reviews` is a strong screen with two hollow cards and a tautological title

Same screenshot (`work2/reviews.png`). The copy is excellent — *"Decisions waiting on you. Each one is
a run an app has paused for a person to approve or reject. Open one to see what you're approving, why,
and the amount at stake."* — and `AWAITING YOU 5 · YOU CAN APPROVE 5 · ABOVE YOUR LIMIT 0 · APPS
INVOLVED 4` is a clean band. But:

- **Two of the five cards are visibly hollow** — "Approve Motor Claim FNOL Triage?" and "Approve
  Reimbursement Approval?" carry no amount and no requester, leaving a large blank middle beside three
  cards that have both.
- **"Approve Reimbursement Approval?"** is a tautology, and it appears twice in the grid (once with
  `$63,000`, once bare), reading as a duplicate row.
- The sidebar still shows `Work 9` next to `AWAITING YOU 5`.

### N17 — DEMO-RISK — `/work` (the section landing) is a `9` beside three zeros; skip it and deep-link `/work/tasks`

`/tmp/audit/demo-path/work.png`: `WAITING ON YOU 9` (red-tinted tile — the wrong number again) then
`PROJECTS 0 · CONVERSATIONS 0 · ARTIFACTS 0`. Three consecutive zeros. The `Inside work` 6-card grid
below is clean and the h1 (*"Your work"*) and its subtitle are good, but the stat band says the
workspace is unused. There is nothing on this page that `/work/tasks` does not do better.

(Seeding one project, one conversation and one saved artifact would fix the band — and would also give
him somewhere to go if a prospect asks about chat or documents.)

### N18 — The "9 vs 5" contradiction is on FIVE surfaces, not one

Worth stating as its own line because it is the most-repeated wrong number in the console and the
cheapest thing on this list to fix (delete two orphaned apps' runs, or scope the sum to visible apps):

| shows **9** | shows **5** |
| --- | --- |
| the sidebar badge `My tasks 9` (on every screen) | `/overview` — *"5 cases are waiting for you to decide"* |
| `/work` — `WAITING ON YOU 9` | `/work/tasks` — *"5 cases are waiting for you to decide"* |
| `/solutions/apps` — `WAITING FOR A PERSON 9` | `/solutions/reviews` — `AWAITING YOU 5` |

The badge is rendered in the sidebar of **every** screenshot above, so the contradiction is present in
the same frame as the correct number on three different pages.

### N19 — The proof section HAS two real numbers, and they are hidden behind two zeros and 65% empty screen

`/tmp/audit/demo-path/governance_evidence.png` — four cards in one row and nothing else:

| card | value |
| --- | --- |
| Audit log | **422** events recorded |
| Security events | **94** refusals recorded — *"Blocked, denied, and suspicious activity."* |
| Provenance | **0** signed answers — *"No signed answers yet — runs are signed as they complete."* |
| Evidence export | **0** destinations configured |

**The good news is the most important finding in this section: `94 refusals recorded` is the "show me
it blocking something" evidence I said did not exist in N3.** It does exist — it is just not on the
home page (which says "Nothing was blocked in the last 24 hours") and not on the guardrails overview.
`/governance/evidence/security` should be in the demo.

Two problems:

1. **`Provenance 0 signed answers` contradicts its own detail page.** `governance.md` B3 measured the
   live tables: `default` holds **78 signed / 118 runs**. The card reads `app_runs` via
   `evidence-posture-reader.ts` and the ledger reads a different table via `provenance-view.ts`, so the
   overview says **0** and the page one click down renders **78 records**. On the surface that exists to
   prove provenance — which the landing page sells as *"See where every answer and action came from"* —
   the headline is zero. **This is a wrong number, not an empty system.**
2. **The bottom ~65% of the frame is blank.** Four cards, one row, then nothing, at 1600×1000. This is
   the emptiest non-error screen on the demo path and a direct hit on the repo's own
   "no wasted real estate" rule.

### N20 — `/data/catalog` is the emptiest screen on the demo path, and it is one click from `/data`

`/tmp/audit/data/data_catalog.png`, confirming `data.md`'s BLOCKER visually:
`DATASETS 0 · HOLDING PII 0 · FRESHNESS ALERTS 0 · TOTAL ROWS 0`, then a single wide card reading
*"No datasets catalogued yet. Use **Seed from connectors** to register the datasets your declared
connectors and data-domains already point at, or add one manually."* — and **~75% of the screen blank**.

Four zeros and an empty state, arrived at by clicking the `DATASETS 4 · 3,60,759 cataloged rows` tile
on `/data`. If he clicks that tile on stage the demo stops.

### N21 — `/runtime/models` is a good "many models, your hardware" screen with two cheap blemishes

`/tmp/audit/runtime/runtime_models.png`. Strong: a green **`connected`** badge on the gateway, a
Modalities grid with **five `ready`** chips (text · vision understanding · embeddings · transcription ·
speech), and a `Model catalog · 4 live · 25 total` list with real `live` badges, context windows and a
right-hand spec panel. This is a credible "Route" beat.

- **`http://offgrid-s1.local:8800/v1` is printed under the heading** — an internal host and port,
  projected. Same class as the `/operations/services` leak.
- **`image generation · not_installed` and `image edit · not_installed`** — two grey chips carrying a
  raw snake_case token. A business audience reads "two capabilities are missing" and an engineer's
  identifier at the same time.
- The **default-selected model is the least informative one**: `Qwen 9B (fleet)` shows
  `ctx unknown · Context window unknown · License unknown · On fleet no`. Four "unknown"s and a "no" in
  the detail panel. Pre-select `Qwythos 9B · 1M (cluster)` (512K ctx, `live`) instead — a one-line
  change to what the page opens on.

### N22 — THE STRUCTURAL FINDING: every section HUB page is worse than the page one level below it. Skip all six.

This is the pattern that only shows up when you walk the whole thing. Each section has an overview /
hub page that aggregates the section's numbers, and on this deployment **every one of them aggregates
zeros, red tiles and warnings** while the working surface sits one click down.

| hub (do not open) | what it renders | go here instead |
| --- | --- | --- |
| `/data` | red `INGEST ATTENTION 1`, `Data quality Offline`, self-contradicting `3 vectors / 0 documents`, dead `Manage sources` CTA | *(nothing — tell the data story inside the app, see below)* |
| `/solutions` | red `BLUEPRINTS READY TO DEPLOY 0 of 3`, `REUSABLE TEMPLATES 0`, `DEPLOYED 0`, and the sentence *"No App currently satisfies a blueprint contract"* **twice** | `/solutions/apps` |
| `/work` | `WAITING ON YOU 9` (wrong) + `PROJECTS 0 · CONVERSATIONS 0 · ARTIFACTS 0` | `/work/tasks` |
| `/governance` (= `/governance/posture`, same screen) | `CLOUD EGRESS Allowed`, red `SOURCES WITHOUT A LAWFUL BASIS 5`, red `ACCESS CERTIFIED Never`, `TEAMS 0`, activity feed of `qwen3-vl-8b` | `/governance/evidence` → `/governance/evidence/security` |
| `/operations` | three red `Unavailable` tiles, guaranteed by a 1500 ms budget on a 20–37 s probe | `/operations/services/capability-map` |
| `/insights` | see N23 | *(nothing — do not enter this section)* |

The hubs are also where the platform jargon concentrates (`/solutions`: blueprint / app / deployment /
contract / data domains / pipeline in one paragraph; `/runtime/pipelines`' subtitle; `/data`'s "governed
solution context"). **The demo should never land on a section root.** Every beat below is a deep link.

### N23 — DEMO-BLOCKER — Do not enter Insights. Its front page shows three tiles that do not add up and a feed of raw internal plumbing.

Screenshot: `/tmp/audit/demo-path/insights.png`. Judged as a projected image, two things end this
section's candidacy before the deeper problems in `insights.md` even come up:

1. **`RECENT RUNS 50 · COMPLETED 29 · ERRORED 0`.** Fifty runs, twenty-nine completed, zero errored —
   **twenty-one runs unaccounted for, with no third bucket on the screen.** Anyone in the audience does
   that subtraction in two seconds. (And `ERRORED 0` is described as *"Runs that halted on a guardrail,
   policy, or failure"* — another zero on the guardrail claim.)
2. **`Recent activity` is six rows of the platform's own internals, verbatim**, under a page headed
   *"Prove business impact, quality, and ROI"*:
   - `One sentence: what is answer-quality drift?` — `agent_system_ai_quality_judge · done`
   - `Answer the question` — `agent_30e80f87 · done`
   - `Answer the question` — `agent_c6b8d40d · done`
   - **`CONTEXT FROM PRIOR STEPS: — [agent] No question was provided`** — `agent_system_ai_quality_judge · done`
   - two more identical `Answer the question` rows

   Raw agent ids, an internal prompt fragment leaked as a case title, and four identical rows. This is
   the most damaging single feed in the console.

The h1 and subtitle are actually good (*"Prove business impact, quality, and ROI"* / *"Prove where AI
makes work faster, better, or cheaper…"*) and the sidebar IA (Outcomes / AI behavior / Usage / Cost) is
sensible — which makes this a data-and-copy problem, not a missing section.

Beneath that, `insights.md` (complete, measured live on this box) says *"the numbers in this section
cannot currently be trusted, and it is demonstrable on the live box rather than arguable."* The specific
things that would appear on a projected screen deeper in:

- **Three of four retained drift runs say "drift detected — engine proven"** when the only thing that
  changed between the compared windows is which evaluator ran (mean 90.3 → 32.3 by evaluator mix).
- **Six live `pii_leakage` runs scored 0** — a *perfect* result on a lower-better metric — averaged into
  the org quality mean as 0% quality.
- **A "Performance degradation: p95 812 ms recent versus 0 ms baseline" banner that fires by
  construction** whenever all traffic is newer than two days.
- **"Trace records: 0"** when the tracing store is unreachable, and the drift page reporting an adapter
  crash as *"At least four recorded evaluation runs are required…"*.
- **The nav into quality is three redirect hops** and `INSIGHTS_QUALITY_DESTINATIONS` still points at
  `redirect()` stubs, so the section has no working way into its own quality tabs.

"Here is whether the AI is any good" is a question the demo must answer — but it should be answered on
the **`Trust checks` panel of the review screen** (N15), per-run and per-check, not from this section's
aggregates. That is also what `quality-plain.ts` already does correctly.

---

## Demo readiness

### The verdict

**Yes, there is a 10-minute demo here — but not the one in the brief, and not on the account he is
currently signed into.** The product has roughly eight genuinely good screens, and they line up into a
coherent human story: *work is waiting → a person decides, with the machine's reasoning shown → the app
that did it was described in plain language → it ran on a governed on-prem pipeline → here is the
evidence → here is the fleet, all verified.*

What breaks it is not missing features. It is, in order of how much damage it does:

1. **Every section hub page is a wall of zeros and red tiles** (N22). The narrative in the brief walks
   hub to hub, which is the worst possible route through this console.
2. **The demo account is `dev@offgrid.local` on the `default` org** — the tenant with the draft apps, the
   orphaned runs, the zero masking rules and the 30-day-stale cases (N1, N2).
3. **A handful of wrong numbers that repeat across screens** — 9 vs 5 on five surfaces (N18), ₹ vs $ on
   one case across three screens (N14), `0 signed answers` vs 78 (N19), `Allowed` vs `0% egress` (N9).
   None of these needs a refactor. All of them are visible to the audience.
4. **The climax screen says nothing was checked** (N15) — one good run away from being the best moment
   in the talk.

### What is genuinely impressive — the three images that should carry the talk

1. **`/work/tasks`** — `/tmp/audit/work/work_tasks.png`. Four real Indian-BFSI cases with a plain-English
   headline and oldest-first ordering. The only screen in the console that makes a non-technical viewer
   say "I understand what this does for me." (Fix the badge, the SLA banner, the 30-day lines, `INV-1 $200`.)
2. **The review detail** — `/tmp/audit/work2/review_detail.png`. `Approve $63,000 — Reimbursement
   Approval?` · `Paused at Manager review` · *What the app recommends: Over quota by $23,000* · `The
   request` (Amount / Category / Employee) · *"WHY THIS NEEDS YOU — This step is configured to require a
   person to sign off before the run continues."* · a required reason · `Reject · Escalate · Approve`.
   Nothing else in the product delivers "governed AI, with a human in the loop" this directly.
3. **`/runtime/pipelines`** — `/tmp/audit/runtime/runtime_pipelines.png`. Seven pipelines, all
   `published`, all `On-Prem Cluster` + `on-prem`, each with a `Data ceiling`, all named after real BFSI
   processes. This is the single most convincing image of the product's actual positioning.

Runners-up worth a beat each: the **run detail with its ticking steps + RISK/CONFIDENCE panels**
(`work2/…runs_seedrun_reimb_04.png`), **`/solutions/apps`** for its intro copy and four app cards, and
**`/operations/services/capability-map`** for `49 / 49 · current · verified · 0 stale · 0 pending`.

---

## The recommended 10-minute demo

**Preconditions (do these first, they are not optional):**
- Sign in as a **named business persona** (not `dev@offgrid.local`), on **one** tenant, decided in advance.
- Every step below is a **deep link**. Never click a sidebar section header — see N22.
- Have `/solutions/apps` open in a **second tab** as the fallback for step 5.
- Prefer light theme for a projector unless the room is dark; both render, but the light shots read
  better at distance (`work_tasks.png` vs `work.dark.png`).

| # | Route | ~time | What to say | What to point at |
| --- | --- | --- | --- | --- |
| 1 | `/overview` | 0:00–0:45 | "This is what a person sees when they open it. Not a dashboard — a job." | The lead band: **"5 cases are waiting for you to decide."** Then the `CLOUD EGRESS 0% — fully on-prem, nothing left` tile. Do **not** linger on the Cost band. |
| 2 | `/work/tasks` | 0:45–2:00 | "Four processes, real cases, oldest first. Nobody configured a screen for this — the apps route their own work here." | The four case subjects: `₹63,000 Client-Entertainment`, `PAN ABCPD1234K · Rohan Desai`, `FOIR 47 · ₹12,00,000`, `TN09EF4567 · CLM-20501`. |
| 3 | click a case → its **run detail** | 2:00–3:30 | "Here is what the machine actually did, step by step, and where it stopped." | The three numbered steps ticking (`Fetch quota ✓` → `Assess ✓` → `Manager review ⚠ Exceeds quota — needs L2 sign-off`), then `RISK LOW` / `CONFIDENCE HIGH`. |
| 4 | `/solutions/reviews` → open the reimbursement card | 3:30–5:00 | "And here is the decision itself. The person is told what they are approving, why it needs them, and what it will do." | `Approve … Reimbursement Approval?` · `WHY THIS NEEDS YOU` · `The request` (Employee: Anjali Nair) · the required reason field · `Reject · Escalate · Approve`. **Approve it live.** |
| 5 | `/solutions/apps` | 5:00–5:45 | "Where did that app come from? Not from us. Somebody in the department described it." | The intro paragraph (*"An app does a piece of your work — describe it in plain language and it gets built… so you do not set any of that up"*) and the four app cards with `Runs on: <pipeline>`. |
| 6 | `/solutions/apps/new` → type → **Build the steps** | 5:45–7:30 | "In plain English. Watch." Type the **rehearsed** sentence. | The typed description, then the steps it produces. **If it stalls or the steps look thin, switch to the fallback tab and open a finished app instead.** |
| 7 | `/runtime/pipelines` | 7:30–8:30 | "Every one of those apps runs on one of these. The rules are bound once, here, and the app inherits them. All of it on your own hardware." | The seven `published` cards, the `On-Prem Cluster` + `on-prem` badges, and one card's `Data ceiling: 3 domains`. |
| 8 | `/governance/evidence` → `/governance/evidence/security` | 8:30–9:15 | "And it is all on the record." | `Audit log 422 events recorded`, then **`Security events 94 refusals recorded`** — this is the "show me it blocking something" answer. Click through to the refusals list. |
| 9 | `/operations/services/capability-map?service=<one>` | 9:15–10:00 | "Forty-nine services, all of it yours, every one verified — nothing phones home." | `INVENTORY 49 · CURRENT AUDITS 49 · STALE 0 · PENDING 0`, all rows `current` / `verified`. **Open it with a service already selected** or the right 60% is blank. |

**Why "Data" has no beat of its own.** The brief's narrative opens on Data. It cannot: `/data` has two
red indicators, a self-contradicting tile and a dead primary CTA (N8), and its first drill-down is four
zeros (N20). But the data *story* is stronger told inside the app anyway — `read 1 source · AI assessed
it` on the case, `All 1 source were read and narrowed to this case` on the run, and `Data ceiling: 3
domains` on the pipeline. That is the repo's own doctrine (*deliver capabilities inside their app, never
as more links*). If a prospect asks where the data comes from, answer from the pipeline card in step 7.

**Why "Insights" has no beat.** N23. The question it answers belongs on the `Trust checks` panel in
step 4 — once one run has a real grounding score (see fix #2 below).

**If he only gets 3 minutes:** steps 2 → 4 → 7. Queue, decision, governed on-prem pipeline. That is the
whole product and all three screens hold up.

---

## Do not open these on stage

| Route / click | Why |
| --- | --- |
| `/insights` (and anything under it) | `RECENT RUNS 50 · COMPLETED 29 · ERRORED 0` — 21 runs unaccounted for; and a `Recent activity` feed of raw agent ids plus the literal string `CONTEXT FROM PRIOR STEPS: — [agent] No question was provided`. |
| `/operations` | Three red **`Unavailable`** tiles, every time — the 1500 ms budget cannot beat a 20–37 s probe. |
| `/operations/services` | Every card spins on `checking` forever; every readiness chip truncates to `DEPLOY… REACHA… FUNCTI…`; internal hosts and ports (`offgrid-s1.local:4000/:8800/:8010`) on screen. |
| `/governance` **and** `/governance/posture` (the same screen) | `CLOUD EGRESS Allowed` contradicting the home page's `0% — nothing left`; red `SOURCES WITHOUT A LAWFUL BASIS 5`; red `ACCESS CERTIFIED Never`; `TEAMS 0`; activity rows reading `qwen3-vl-8b`. |
| `/governance/trust/regulatory` + the **Download** on it | Headline **`OVERALL POSTURE 63%`**; `PII masking (A9)` as a red gap chip that is a **false negative**; framework count says 4 (landing) / 5 (cards) / 3 (copy). The downloadable pack carries another tenant's audit events. |
| `/data` | Red `INGEST ATTENTION 1`; red `Data quality Offline`; `3 vectors / 0 source documents` in one tile; `Manage sources` navigates to the page you are on. |
| `/data/catalog` (i.e. clicking the `DATASETS 4` tile) | `DATASETS 0 · HOLDING PII 0 · FRESHNESS ALERTS 0 · TOTAL ROWS 0` and "No datasets catalogued yet" — 75% empty screen, directly contradicting the tile he clicked. |
| `/solutions` | Red `BLUEPRINTS READY TO DEPLOY 0 of 3`; `REUSABLE TEMPLATES 0`; `DEPLOYED 0`; *"No App currently satisfies a blueprint contract"* stated **twice**. |
| `/work` (the hub) | `WAITING ON YOU 9` (the wrong number) beside `PROJECTS 0 · CONVERSATIONS 0 · ARTIFACTS 0`. |
| `/build` — or any pre-migration `/apps`, `/studio`, `/evals` bookmark | Chromeless full-page **"Page not found"** with no sidebar. Purge every stale bookmark and slide link before the talk. |
| **Any app id from a different tenant** | Same chromeless 404 — the whole console blanks. Verified across eight routes. |
| Opening **Motor Claim FNOL Triage** | Opens with a red banner (*"could not read Read the claim & policy… working from nothing"*) and an amber one naming `service@offgrid.local` as an absent owner; `HANDLED 0`; a `Recently handled` row titled *"In one line, what does this app do for the bank?"*. |
| The **guardrail tester** (`/governance/guardrails/*`, the Test panel) | It is a `method="GET"` form: whatever PAN/Aadhaar he types goes **into the address bar**, on the projector, under the sentence "Nothing is stored." |
| `/solutions/quality/drift` and the drift catalog | "Drift detected — engine proven" verdicts that are artifacts of which evaluator ran, and `score_psi` / `share_drifted` rendered as bare numbers. |
| Any **Insights → Quality** nav row | Three redirect hops onto `redirect()` stubs; the shell never renders. |
| `/governance/egress`, `/governance/policies/bundles`, `/insights/copilot`, `/insights/finops` | Live pages that no navigation links to — if he lands on one he cannot get back except via the sidebar. |

---

## The 5 cheapest fixes that most improve the demo

Ranked by (damage removed ÷ effort). All five are seed data, one UPDATE, or one line of copy — no refactors.

### 1. Make one tenant coherent, and sign in as a person — **60–90 minutes**
Decide the demo tenant, then on that tenant:
- create a **named business user** so the home page reads *"Welcome back, Priya"* instead of *"Welcome back, Dev"* (avatar `DE`, `dev@offgrid.local`);
- **delete the runs of the two orphaned apps** (`app_4108cf57`, `app_d9f008e3`, 4 `awaiting_human` runs since 2026-07-09). One statement fixes **the 9-vs-5 contradiction on five surfaces** (N18) *and* the *"nobody has picked this up in 30 days"* line on four cards *and* the `WAITING ON YOU 9` tile;
- **re-date the remaining demo runs to the last 48 hours** so nothing says "30 days";
- **publish both demo apps** so the `Draft — check it, then publish` pill disappears, and reassign `app_e8b19b50`'s owner away from `service@offgrid.local`;
- fix or delete the `Invoice: INV-1 $200` case and the `In one line, what does this app do for the bank?` run.

This one item removes more visible damage than the other four combined.

### 2. One reimbursement run with a real grounding score and a real guardrail finding — **1–2 hours**
The climax screen currently says `Faithful to sources — Not scored` and `No guardrail findings recorded`
(N15). Run the reimbursement app once with the eval judge and guardrails actually engaged, retain the
verdict, and demo **that** run. Payoff: the review screen stops disclaiming itself, and it becomes the
answer to "how do you know the AI is any good?" — which lets him skip the entire Insights section.

### 3. Fix the currency, everywhere it renders — **30–60 minutes**
`₹63,000` on `/work/tasks` → `$63,000` on `/solutions/reviews` → `$40,000 / $23,000 / 63,000` in the run
steps, for **one case** (N14); `₹12,00,000` → `$1,200,000` for the loan. Format from one money helper
(`money.ts` exists) and correct the seeded step outputs. A banker catches this instantly and it discredits
every other number.

### 4. Six copy / default changes, one sitting — **60–90 minutes total**
Each is a single line, each removes a specific projected embarrassment:
- **Set the org policy to leashed** so `/governance` stops saying `CLOUD EGRESS Allowed` two clicks from the home page's `0% — nothing left` (N9). *(5 min, one setting.)*
- **Set a decision target (SLA) on the four demo apps** so the amber *"No decision target is set for 4 processes"* banner leaves the top of the best screen. *(10 min.)*
- **Rewrite the `/runtime/pipelines` subtitle** — it is five platform terms in one sentence on one of the three best screens (N12). *(5 min.)*
- **Drop `0 tools` / `0 KB docs` from the builder's inheritance strip** when the count is zero, and stop printing `policy v10` (N13). *(15 min.)*
- **Pre-select `Qwythos 9B · 1M (cluster)`** on `/runtime/models` instead of the model whose panel is four `unknown`s, and hide `http://offgrid-s1.local:8800/v1` (N21). *(15 min.)*
- **Open the capability map with a service selected** so its right 60% is not blank (N11). *(10 min.)*

### 5. Seed one project, one conversation, one artifact — **20 minutes**
`/work` currently reads `PROJECTS 0 · CONVERSATIONS 0 · ARTIFACTS 0` (N17). This does not earn a demo
beat, but it is the most likely **off-script** click in the whole console (the sidebar's Work group is
right under My tasks), and three zeros is what he lands on.

**Explicitly NOT on this list, despite being real:** thread `orgId` through `computeControls`, fix the
`63%` posture, reconcile the two dataset registries, raise the `/operations` timeout budget, wire the
worker readiness probes, un-truncate the readiness chips. Each is hours-to-days of real work, and the
demo route above simply does not open the screens they affect. Fix them after the conference.

---

## Out of scope for the demo (one line each)

- The `Next.js` dev-overlay pill (`N 1 Issue ✕`, bottom-left of several shots) is a dev-server artefact and will not appear on the production box — but confirm he is not presenting from `next dev`.
- The landing page's full-page capture shows sections 01–07 as blank because `BlurFade inView` needs a real scroll to fire; this is a screenshot artefact, not a live defect. Scroll it once to confirm before the talk.
- Under five concurrent audit shooters the shared dev server took >30 s to answer `/api/auth/csrf` and 20–37 s for `/api/v1/status`; the 20–37 s figure is corroborated by `operations.md` and is a real product issue for `/operations`, but the rest is load from this audit, not the product.
- `/solutions/apps` says `LIVE 3 · DRAFTS 1` while both apps I opened show a `Draft` pill — worth a two-minute check, but it resolves either way once fix #1 publishes them.
- Framework count 4 (landing) vs 5 (regulatory cards) vs 3 ("three real frameworks ship in the box") — same page family, low audience impact, folded into "do not open regulatory".
- All backend correctness findings from the nine sibling audits (org-scoping, the approve/reject race, self-approval, `expectStatus`, `unverified` in the numerator, audit action strings) are real and unaffected by demo prep — they stay in their own files.

### One negative result worth recording (so nobody re-derives it)

I HTTP-probed 23 plausible off-script routes as the signed-in user. **Every one returned `200`** —
`/solutions/quality`, `/solutions/quality/performance`, `/solutions/library`, `/solutions/templates`,
`/solutions/deployed`, `/solutions/tools`, `/governance/evidence/provenance`,
`/governance/trust/regulatory`, `/data/lake`, `/work/chat`, `/operations/runs`,
`/runtime/models/cache` and the rest. So **the off-script risk is not HTTP 404s** — it is the two
chromeless-404 cases proven by screenshot (bare `/build`, and any app id the signed-in org does not own)
plus the empty and red-tiled surfaces catalogued above.

A detector caveat, recorded because it nearly became a false finding: my probe flagged the literal
string `Page not found` in the response body of **every** page, including ones the sibling teams have
clean screenshots of. The global not-found copy is present in the RSC payload of every route, so that
signal is worthless — **do not build a "404 sweep" on a body-text match.** Latencies in the same probe
ran 7–32 s per route, but five audit shooters were hammering the box, so those numbers say nothing about
the product.

