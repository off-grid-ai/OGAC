# The app is the department's product, not an entry in an AI console

**Status:** specification + work plan. Written 2026-07-28 from the founder's spec, to be executed one
item at a time with live verification against the persona bar below.

## The acceptance bar

From `founder-freehand.md` (the founder's own words — quoted, never paraphrased):

> Empower non-technical people to build. A person describes a workflow or process in plain English,
> and the system is smart enough to inherit the org's rules, workflows, data, connectors, policies,
> and guardrails automatically, and hand them their own lovable ecosystem, with human-in-the-loop,
> review, and reports, so they do their job better.

A change is done when a **non-technical person in a department** (tax, accounting, claims, grievance
handling) can use it without help. Not when tests pass.

## What an app IS

An app automates a process the enterprise **already runs**. Because the process already exists, its
data already arrives — by email, WhatsApp, Slack, Telegram, a webhook, a schedule, or a connector.
The app plugs into those existing flows; it never asks anyone to invent custom form fields, and it
only ever processes **enterprise data from configured sources** — never ad-hoc uploads.

Agents do the work on that data. Results leave through the integrations the org already has: a
report, an email, a Slack message, a CRM write, an API call.

Every app ships with these as standard, not as options:

- **A work queue** — the cases waiting on this person, because work arrives on its own.
- **Human-in-the-loop** — the decision screen IS the app's main surface.
- **A dashboard** — the process's health in the department's language.
- **Reports** — outcomes over time.
- **Its own RBAC** — the creator grants access; anyone above them in the org tree inherits it.

## The orientation defect (why current app pages miss it)

`BUILDER_EPIC_PLAN.md` §7 already specifies the right five screens (BUILD → INPUT → RUNNING →
REVIEW → REPORTS). The implementation drifted: an app today opens on **Build**, and its shell
(Build / Input / Runs / Review / Reports / Quality / Access / Schedule / Safety) is a set of facts
*about* the app. To use it you press Run and fill a form.

The machinery is largely built — `app-compile.ts` (plain language → steps), `org-context.ts` (org
inheritance), `triggers.ts`, `AppRunStatus.tsx` (live per-step status), the review route, the output
sinks. **What is missing is orientation, not capability.** The app must present itself as the
department's tool for that process.

## Work plan

Ordered. One at a time, each through the full gates (pure logic isolated, real tests, typecheck,
coverage, clean production build) and verified live by screenshot against the persona bar.

1. **Templates seeded from real processes.** Publish the genuine BFSI apps already in each tenant as
   templates via `publishAppAsTemplate` with `{{var}}` schemas — KYC & Re-KYC, Personal Loan
   Underwriting, Reimbursement Approval (bank); Motor-Claim FNOL Intake, Death-Claim Assessment,
   Grievance Resolution Assist (insurer). The persona must never meet a blank prompt or an empty
   library. The adopt components (`TemplateAdoptForm.tsx`, `AppReuseActions.tsx`) already exist; this
   is a data gap, not a build gap.
2. **Purge demo junk.** 7 `[autotest] …` apps in the insurer tenant; `Actions-out webhook proof` ×3,
   `Cross-Sell Advisor` ×2 and `Governed CRM follow-up — live verification 2026-07-22` in the bank.
   Check run-history references before deleting — never destroy an audit trail to tidy a list.
3. **The app opens on the work, not on its own configuration.** Default view becomes the work queue
   of cases waiting on this person. This is the item that makes the vision visible.
4. **HITL becomes the primary surface.** Case + drafted answer + the evidence used → approve / edit /
   reject → next case. Reuses the existing per-step human signal and review route.
5. **The process dashboard.** Resolved this period, past SLA, stuck, exceptions, value — from run and
   outcome data already retained. The only item on this list with no component behind it today.
6. **Complete the inputs.** WhatsApp is already a valid `TriggerKind` handled in `triggers.ts` but
   missing from the builder's picker (only 4 of 5 offered) — expose it, then add Slack and Telegram
   bound to configured integrations.
7. **Org-tree RBAC** (`#102`). Creator grants access; managers above inherit by default. The `access`
   tab exists but carries no hierarchy logic — genuinely unbuilt.
8. **Language pass on every persona-facing surface.** Pipeline, guardrail, eval, provenance, policy
   overlay leave the view and become "this was checked" / "a person approved it". The machinery keeps
   running underneath, and per the docs rule the OSS engine names never surface.

## Notes

- Items 1 and 3 are interchangeable in priority; 3 is where the vision becomes visible, 1 is where
  the persona can first get in.
- Related: `BUILDER_EPIC_PLAN.md` (the 5 screens, org inheritance `#102`, triggers `#103`),
  `VISION.md` §the plain-language builder, `GAPS_BACKLOG.md`.
