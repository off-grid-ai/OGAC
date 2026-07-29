# READ THIS FIRST — the app is the department's product, not an entry in an AI console

**Every session working on Solutions / Apps / the builder MUST read this file before writing code, and
MUST update the Progress log at the bottom before finishing.** It is the direction, the acceptance bar,
and the running state. Referenced from `CLAUDE.md` so it cannot be missed.

---

## 1. The acceptance bar

From `docs/founder-freehand.md` (the founder's own words — quoted, never paraphrased):

> Empower non-technical people to build. A person describes a workflow or process in plain English,
> and the system is smart enough to inherit the org's rules, workflows, data, connectors, policies,
> and guardrails automatically, and hand them their own lovable ecosystem, with human-in-the-loop,
> review, and reports, so they do their job better.

**Done means a non-technical person in a department — tax, accounting, claims, grievance handling — can
use it unaided. Not that tests pass.** The public demo is READ-ONLY, so every surface must also be
understandable by *reading* it, without acting.

## 2. What the founder asked for, verbatim in substance

- Write a prompt → get an app or an agent.
- Reuse a previous app / agent.
- Select from templates.
- Edit what was built.
- **Visual feedback of what gets built.**
- What gets built is based on the **pipelines, data sources and UI components that already exist** for
  this user — never invented capabilities.
- Once built, the app has:
  - **its own RBAC** — the creator decides access; anyone above them in the org tree inherits it
  - a **built-in HITL screen and process**, always, not optional
  - **reports**
  - a **dashboard**
  - **varied inputs** — email, Slack, WhatsApp, Telegram, webhook, schedule, connectors: whatever is
    already configured as an enterprise data source
  - **varied outputs** — on screen, API call, Slack, email — through integrations that already exist

## 3. THE CORRECTION THAT MATTERS MOST

> *"It's a web app, but **not with customUI fields**, but a web app specifically built to automate some
> process, that already happens in the enterprise. which means that data already flows in somehow."*

**Do NOT solve input by authoring per-app form fields.** That is building custom UI, which is explicitly
ruled out. I started down that road and it was wrong.

The correct model: **work arrives; it is not typed in.** The process already runs, so its data already
flows from email, Slack, WhatsApp, Telegram or a connector. The app's front door is the **queue of
arriving cases**. A manual entry screen is a fallback, not the main event — and where entry *is* needed,
the fields must be **derived from what the app already knows** (the data domains its steps read, the
action it performs), because the app knows its own process.

Purpose-built, not free-flowing. A single generic `Input *` textbox is the defect this replaces.

## 3b. There is MORE THAN ONE shape of app — do not force them all into a queue

An app is not always a decision queue. A second, equally valuable shape (founder, 2026-07-29): **a job
people come and run to get results** — like a scheduled or set job. No case waits for a human; someone
opens it, runs it, and reads the output. `Replay`, `Re-run`, `Watch` and `New run` are all legitimate,
first-class verbs for this shape.

So the app's front door must ADAPT to what kind of app it is, rather than assuming cases arrive:

| Shape | Front door should lead with |
| --- | --- |
| **Decision queue** (has a human step; work arrives by email/WhatsApp/connector) | cases waiting for a person |
| **Job / report** (no human step; on-demand or scheduled) | run it now, and the latest results |

Presenting a job-shaped app with "0 cases are waiting for a person to decide" is as wrong as presenting a
decision queue with a Build editor. Both mislead the reader about what the app is for.

Consequence for the work screen: `buildAppWorkQueue` currently assumes the queue shape. It needs an app
shape input, derived from the spec (does any step pause for a human?) and the trigger.

## 4. Orientation, not capability

`BUILDER_EPIC_PLAN.md` §7 already specifies the right five screens (BUILD → INPUT → RUNNING → REVIEW →
REPORTS) and most machinery exists: `app-compile.ts` (plain language → steps), `org-context.ts` (org
inheritance), `triggers.ts`, `AppRunStatus.tsx` (live per-step status), the review route, the output
sinks, `TemplateAdoptForm`, `AppReuseActions`. **What drifted is ORIENTATION.** Fix how surfaces present
themselves before building anything new.

## 5. Progress log

### Live and verified (2026-07-28 → 29)
- **Solutions consolidated** — sidebar 7 rows → 5; `Library` → `Blueprints`; the orphan
  `/solutions/catalogue` duplicate collapsed into one blueprint detail carrying BOTH the live
  requirements checklist and the contract editor (the good page had been unreachable from the nav).
- **Solutions hub explains the chain** — Blueprint → App → Deployment, and names the missing
  precondition when a stage cannot proceed instead of showing a blank list.
- **Apps open on the WORK**, not on Build. `work` is the base tab; Build moved to `./build`.
  Waiting cases lead and are never truncated; plain language throughout (`awaiting_human` → "Waiting
  for you", webhook → "arrives automatically from a connected system").
- **Cases say what they are about** — subjects derived from the run's own input, amounts grouped
  (`361,030`), identifiers never grouped (a mangled policy number misleads whoever copies it).
- **108 empty demo runs backfilled** with realistic Indian-BFSI cases (INR, PAN/IFSC-shaped, Indian
  names) — `scripts/backfill-demo-run-input.mts`, idempotent.
- **Templates seeded** — six real processes across the two tenants via the real
  `publishAppAsTemplate` path (`scripts/seed-app-templates.mts`).
- **Demo junk purged** — 7 `[autotest]` apps + probe residue; reference-guarded so no audit trail was
  destroyed (`scripts/purge-demo-junk-apps.mts`).
- **Deployed is no longer a dead end** — bank tenant shows an ACTIVE adoption
  (`scripts/seed-solution-deployment.mts`). The insurer has NO compatible pair and the script reports
  why per blueprint; nothing was forced past the compatibility check.
- **One navigation** — the app's horizontal tab rail is gone; tabs nest in the left sidebar under Apps,
  split `primary` (what you do) vs `settings` (what you configure once). "Input" → "Start a case".
- **Stale-tab recovery** — a deploy used to break every open tab with `ChunkLoadError`. Handled in the
  console error boundary AND by an inline root-layout listener, because a boundary cannot catch its own
  layout chunk failing to load.
- **a11y** — exactly one `h1` per app page, enforced by tests. The mobile gate had been claiming every
  page's `h1`, which silently satisfied the `h1` assertions in the e2e suite and screen sweep.
- **Demo currency copy corrected** — 8 apps said "Amounts in USD ($)" while every case reads in rupees
  (`scripts/fix-demo-currency-copy.mts`).
- **Landing** — misaligned pricing beam removed; unfilled "Proof" placeholder section removed and
  sections renumbered; apex signin links both demo tenants.

### Open defects found while doing the above
- ~~**The seeded demo apps FAIL spec validation.**~~ **FIXED 2026-07-29** —
  `scripts/repair-demo-app-specs.mts` bound the missing domain/agent/sink from each tenant's real context
  (`report` sink deliberately, so a demo app can never email or post when someone presses Run). Verified:
  **17/17 demo apps now pass the validator that save runs.** Original defect below for context.
- **(was)** `updateApp` re-validates the whole spec and rejects them:
  `connector-query step s1/s2: needs a domain binding`, `agent step s3: needs agentId or inlineAgent`,
  `output step s5: needs a sink`. So **nobody can save an edit to these apps in the UI either** — an
  edit-then-save on any seeded demo app will fail. Worth fixing before a demo shows editing.
  (Discovered 2026-07-29 while correcting currency copy; that script writes the `summary` column directly
  and says why in its header.)

### GAP 0 — starting a case must PICK from enterprise data, not accept free text

Founder, on the Run screen: *"why is this free text? all of the data is already in the organization right?
I dont understand this?"*

He is right, and I got this wrong twice: first I hand-authored form fields (ruled out — §3), then I improved
the LABEL and the example and left the interaction as a text box. Free text is still free text. Typing
"Training course reimbursement — Vikram Desai, ₹16,107" is re-entering data the organisation already holds,
which the agent then has to parse back out of prose.

**What it must be:** the app's steps already declare the data domains they read — `invoices`,
`reimbursement quota` for reimbursement; claim documents for FNOL; grievances for grievance handling. So
starting a case is **selecting a record that already exists**: a list of pending invoices with employee,
amount and date, and you pick one. A grievance app picks a grievance. An FNOL app picks a claim intimation.
The picker is populated from the bound domain — nothing typed, nothing invented, no custom UI authored.

**Why it is not a quick fix:** it needs an endpoint that lists records from a bound data domain for an app
(the connector-query step executes a query today, but nothing exposes "show me the candidate records"), plus
the picker, plus passing the chosen record's identity as the run input. That is the single highest-value
piece of work left on this surface, and it should come before any further polish.

Free text should survive only as an explicit escape hatch, clearly secondary.

### The experience gap — read this before adding any more features (2026-07-29)

Founder, shown the Work screen after everything below was live: *"this is what you're calling done is it?"*
The honest assessment: **it is legible, but it is not a product.** It reads like an admin list view — two
columns of rows, five plain stat boxes, no hierarchy of importance, nothing that makes a clerk feel the app
is theirs. Correctness and legibility were fixed; the EXPERIENCE was mistaken for having been fixed with
them. The repo's component depth (the 397-component library, motion, the design system) is barely used.

Fix these before adding features, in this order — they are what changes the impression:

1. **Make a waiting case actionable IN PLACE.** Approve / reject on the row itself. Deciding is the whole
   job; today the row navigates you elsewhere to do it. This is the single biggest one.
2. **Stop showing the same screen twice.** The console Work screen and the deployed app's Work view are
   near-duplicates with different chrome. Pick which surface owns the queue.
3. **Give the important thing visual weight.** "2 cases waiting for you" should dominate; "Needed a person
   100%" should not have equal billing with it.
4. **Show the governed run happening.** What makes this different from a spreadsheet is currently invisible
   — no sense of the pipeline, the checks, or the provenance behind a decision.

### Not built yet — in priority order
1. ~~Input derived from the app's own definition~~ **DONE** — `app-input-prompt.ts`: label "The case to
   work on", and the example is a REAL previous case from that app. Nothing invented when there is no
   prior run.
2. **Adapt the front door to the app's shape** (see §3b) — a job-shaped app must lead with "run it now"
   and its latest results, not with an empty decision queue.
3. **The dashboard** — the only item on the founder's list with no component behind it at all.
4. **Org-tree RBAC** (`#102`) — **PARTLY DONE.** App RBAC/ABAC already existed
   (`src/lib/app-access-policy.ts`, 380 lines: role/department rules, ABAC predicates, approval authority).
   The missing half was inheritance, and the DECISION is now in place: `AppAccessCaller.manages` admits a
   caller who manages the app's owner at any depth, skip-level included, without an explicit grant.
   **It is inert until something populates that chain.** There is no reporting relationship in the schema —
   no `managerId` on `user`, no parent on `teams` — so there is no tree to walk. To activate:
   (a) add `managerId` to `user` (self-migrating DDL, as `ensureAppsSchema` does),
   (b) let Access pick a manager,
   (c) resolve the chain in the route that builds `AppAccessCaller`.
   Absent is deliberate: an access rule that fails OPEN is worse than one that is missing, because it looks
   enforced.
5. **Slack and Telegram as INPUTS** — currently outputs only. WhatsApp is done (was a valid
   `TriggerKind` handled in `triggers.ts` but missing from the builder's picker).
6. **Visual feedback while building** — steps/flow appearing as Forge composes them.
7. **Language pass** — pipeline / guardrail / eval / provenance / policy overlay must not reach a
   department reader. Never name the OSS engines.

## 6. How to work here

- One item at a time, through the full gates (pure logic isolated in `src/lib`, real tests, typecheck,
  coverage, clean production build), then **deploy and verify live by screenshot**.
- `scripts/verify-all-screens.mjs` sweeps every screen and classifies BROKEN / THIN / OK from the DOM.
  Use it — it caught a hydration mismatch, the `h1` blind spot, and eight identical "Case" rows.
- **Verify before believing.** Repeatedly this session an apparent product defect was my own probe:
  RSC prefetch aborts flagged all 174 screens, a deleted credentials file looked like 14 broken tests,
  reversed arguments looked like a store bug. If a huge fraction fails for one reason, suspect the
  detector.
- Never wait on a deploy in a tool call that can time out — killing `push.sh` mid-`.next`-sync leaves a
  torn artifact that renders as unstyled HTML. See the memory note `feedback-never-kill-deploy-midsync`.
