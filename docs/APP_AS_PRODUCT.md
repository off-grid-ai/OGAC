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

**The hard part is already solved** (checked 2026-07-29, so do not re-derive it):
- `execConnectorQuery` in `src/lib/connector-exec.ts` runs a query against a resolved connector, and
  `listResources` / `recordCount` are there too.
- A data domain carries `connectorId` + `resource`, and `listDomains(orgId)` returns them — the builder
  already filters on exactly `d.connectorId && d.resource` to decide a domain is usable.
- An app's `connector-query` steps carry `domain` (the domain LABEL), which is how a step binds to one.

So the remaining work is assembly, not discovery: (a) a route that takes an app id, resolves its
connector-query step's domain to a connector + resource, and returns the first N candidate records; (b) a
picker on the Run screen listing them with the fields that identify a case (employee, amount, date); (c) pass
the chosen record as the run input instead of a typed string. Free text survives only as an explicit,
clearly-secondary escape hatch.

This is the single highest-value piece of work left on this surface and should come before any further
polish.

Free text should survive only as an explicit escape hatch, clearly secondary.

### The mistake I made most often — GREP BEFORE DECLARING SOMETHING MISSING

Three times in one session I reported a capability as absent when it was already built, and each time the
founder's question — not my own checking — caught it:
  - "where is the deployed app?" → `/app/<slug>` existed, with AppUseShell, a queue and a run panel.
  - "there is some team mapping somewhere right?" → the whole management-chain RBAC existed, tested AND wired
    into production routes; only `team_members` was empty.
  - the cross-sell copy leaks → I fixed the instance on screen instead of grepping `components/app-use` for the
    rest, so the founder found the next two.

The failure is trusting a read of the code over verifying it. Before writing "not built" about anything in this
repo: grep for the concept, check who imports it, and look for empty DATA as the explanation first. This repo is
much further along than a surface reading suggests, and the usual defect is unpopulated or unwired, not absent.

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

### The run now REACHES A DECISION (2026-07-29) — and what it took

Founder, on seeing `Result: (no output)`: *"goal is not met. goal should be successful creation of the
right UX… you haven't done that. in fact you are far from it."* Chasing that one case end to end
uncovered a chain of five defects, each of which had been presenting as something else:

1. **A failed read reported itself as an empty one.** `"No rows returned from reimbursement quota
   (employee_quota)"` — while the table held 500 rows. `execConnectorQuery` returns `null` on failure,
   and the step turned `null` into a `done` step with an empty-source message. The agent then reasoned
   from that silence ("no defined reimbursement quota"), and declined the claim. Same defect class as
   `(no output)`: **a failure wearing the costume of an empty answer.** Fixed at the seam —
   `connector-failure.ts` (pure taxonomy + sentences), `execConnectorRead` returns rows OR a named
   reason, and an unreadable source is now an **error that halts the run**. A governed run must not
   decide on data it could not read.
2. **The credential was missing, not the data.** `con_f5c959` carried `mysql://policyadmin@…` — no
   password — while its sibling in the same org had one. `scripts/fix-demo-connector-credentials.mts`
   vaults a credential for any demo SQL connector lacking one and then PROBES it. That probe also found
   `surcon_coreins` pointing at a Postgres role that **did not exist** on the insurer DB — a second
   source that would have reported "no rows" forever. All six demo connectors now connect.
3. **The case picker resolved domains differently from the run.** A compiled spec emits the domain
   **id**; the route matched on **label** only, so the picker said "not connected yet" for apps whose
   runs read that domain fine. Both now use `resolveDomainByIdOrLabel` — one rule, one place.
4. **The app read the whole table, not the case.** `ConnectorQuery.params` was documented as "reserved
   for equality filters"; nothing applied it. So "Read the invoice" returned 20 unrelated invoices and
   "Check the employee's quota" returned 20 unrelated employees, and the agent — correctly — said it
   could not decide. `connector-filter.ts` (pure) adds `{{case.employee_id}}` placeholders, bound
   equality filters per dialect, and `caseRecordFrom()` which finds the record in any of the three
   envelopes a case can arrive in. **An unsatisfiable placeholder is an ERROR**, because reading
   unfiltered would return other people's records under a step labelled "check THIS employee's quota".
5. **Editing an app's instructions was a silent no-op.** A step's instructions are materialized into a
   runtime-agent row at first run, and nothing ever updated them again — so the App row changed and the
   running behaviour did not. `updateApp` now re-syncs the instructions of agents the app OWNS (never a
   shared library agent). This was broken on the one path the builder exists for.

**The data was also incoherent, and that is a product defect too.** "Reimbursement Approval" read the
ERP's VENDOR invoices — a table with no employee column — so no scoped join was even possible. The
missing entity was the claim itself. `gen-expense-claims-sql.mts` emits the roster, the per-category
quota AND the claims from ONE source, so a claim can never be checked against a different person's
quota; `seed-insurer-expense-claims.sql` derives the insurer's claims from its own richer roster
in-database. Every 5th claim deliberately exceeds quota, so an approval is a real decision.

**Verified live, both tenants:** claim ₹41,346.44 · remaining ₹137,454.12 · headroom ₹96,107.68 →
"Recommendation: within quota — approve" → pauses for a human. The insurer's app decides the same way
against its single pool.

The lesson worth carrying: **every one of these presented as emptiness.** An empty list, an empty read,
an empty answer. Fixing them meant refusing to accept "nothing there" as an explanation and asking what
would have to be true for it to be genuinely empty.

### Not built yet — in priority order
1. ~~Input derived from the app's own definition~~ **DONE** — `app-input-prompt.ts`: label "The case to
   work on", and the example is a REAL previous case from that app. Nothing invented when there is no
   prior run.
2. **Adapt the front door to the app's shape** (see §3b) — a job-shaped app must lead with "run it now"
   and its latest results, not with an empty decision queue.
3. **The dashboard** — the only item on the founder's list with no component behind it at all.
4. **Org-tree RBAC** — **DONE. It was already built, tested AND wired; only the DATA was missing.**
   I declared this missing twice. Both times the code was there and I had not looked.
   - `resolveManagementChain` (`app-sharing-policy.ts`) treats a team `lead` as a manager to that team's
     members and climbs TRANSITIVELY, cycle-guarded, creator excluded, nearest-first. Unit-tested.
   - `evaluateShareAccess` calls it (line ~207) and admits with `HIERARCHY_INHERITED_ROLE = 'approver'` —
     view/run/trigger/approve but NOT edit, because editing someone's app stays with its owner.
   - `enforceAppAccessWithSharing` (`app-sharing.ts`) UNIONS that with the RBAC/ABAC decision and is imported
     by real routes: trigger dispatch, agent runs, action outcomes, the deployed app's endpoints.
   - The only gap was that `team_members` was EMPTY, so every chain resolved to `[]`. Seeded by
     `scripts/seed-demo-org-chart.mts` (12 memberships per tenant, leads rotated so the transitive climb has
     more than one level).

   **The founder's requirement is met:** the creator grants access explicitly, and anyone above them in the
   team tree inherits by default.

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
- **Read the step's `detail`, not its `outcome`.** `errorResult(step, reason)` writes the reason to
  `detail`. A diagnostic that printed `outcome` cost a previous session two wrong theories about a run
  failure whose cause was sitting in `detail` the whole time. `scripts/run-one-case.mts` prints both.
- **`tsx` on the box runs `src/`, not `.next`.** A script verifying new behaviour needs `rsync src/`
  first, or it silently exercises the previously deployed source and you conclude the fix did not work.
- **When a read returns nothing, prove the source is genuinely empty** before believing it. Two hours
  went into a "missing quota" that was a password-less connection, and the table had 500 rows all along.
