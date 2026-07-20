# Agents & Studio

_Documented + verified 2026-07-17._ Surface: **Solutions → Apps (`/solutions/apps`)**.

## What it is

**Apps** is your catalog of repeatable AI work. An agent is the _simplest app_: one governed step that
reads a question, (optionally) retrieves from your Brain, decides, and answers — with the whole
[Policy](policy.md) → [Guardrails](guardrails.md) → grounding → provenance-signing pipeline wrapped
around it, and every run recorded.

The **New app** flow is where you build one. It's the unified builder documented in
[Building an app (plain language)](app-builder.md): describe the work in plain language, get an ordered set
of governed steps, wire them to your connectors/data/tools, and save. A one-step build is an agent; a
multi-step build is an app. Studio owns the canonical AppSpec and its full lifecycle. Materialized runtime
agent rows are execution details, so they never appear as a second roster or editor.

## Why use it

- **Adopt a working use case in minutes.** The catalog ships real, role-tagged agents (SOP Synthesizer,
  FNOL Intake Assistant, Sales Coach, KYC Verifier, and more) — run one immediately, no wiring.
- **Author your own without code.** A department head describes the job in plain language and gets a
  governed worker — no prompt-engineering, no pipeline to assemble by hand.
- **Every agent is governed and provenance-signed.** The same run passes policy, guardrails, and grounding
  checks, and lands tamper-evidently signed in [Agent Runs & Jobs](agent-runs-jobs.md). You can always show
  _what it did and why_.
- **Grounded answers cite their sources.** A grounded agent answers from your Brain and refuses to guess
  when the corpus doesn't cover the question (verified — see below).

## When to use it

- **Run from Apps** when an existing use case fits — you just want the outcome now.
- **Build a new app** when a repeatable job needs AI + your data + (optionally) a human gate: approvals,
  triage, drafting-with-review, scheduled digests.
- Reach for a **single-step agent** when one decision/answer is all you need; reach for a **multi-step app**
  (same builder) when the job is read-data → decide → have-a-person-approve → emit.

## How to use it

### Browse and run an app

Open **Apps** (`/solutions/apps`). Every single-step agent and multi-step workflow appears once, as the
AppSpec that owns its configuration and lifecycle. A card shows its step count, trigger, visibility,
governing pipeline, summary, and shared link when published. Click **Open** for its dedicated detail page
(`/solutions/apps/[id]`) with Build, Input, Runs, Review, and Reports.

- **Run** it — click **Run**, type your query, submit. The run executes through the governed pipeline and
  returns a full trace (policy → plan → retrieval → answer → grounding → signing). A blocked/denied run says
  so honestly with the failing check.
- **View all runs →** opens the agent's paginated run history; click any run for the full trace, its checks,
  its citations, and its signature. See [Agent Runs & Jobs](agent-runs-jobs.md).

### Build your own (Apps → New app)

From **Apps**, click **New app** to open the guided builder at `/solutions/apps/new`. This is the full flow
documented in [app-builder.md](app-builder.md); the short version:

1. **Describe** — write the outcome in plain language, or pick a starter (Reimbursement approval, Support
   triage, Simple assistant). **Infer** proposes a title/tools/grounding from your text.
2. **Compile** — the builder carves an ordered, governed skeleton: **Read data** (a connector-query bound to
   a declared [data domain](data-domains.md)), **Agent step** (decide), **Guardrail**, **Human review**,
   **Output**.
3. **Read the gaps panel** — if a phrase has no declared data source, the builder does **not** fabricate a
   connector; it shows a gap with a **Wire a data source** button. Resolve gaps before saving.
4. **Refine** — reorder/relabel/add/remove steps; rebind a step to a different data domain; point an agent
   step at an existing agent; toggle grounding; pick the output sink. Switch between **Guided** and **Visual**
   canvas — the two edit the _same_ spec and can't drift.
5. **Choose a trigger** (on-demand / webhook / schedule / email) and **who can use it** (just me / my org /
   shareable link), then **Save**. You land on the app's **Input** screen.

### Manage the ones you own (full CRUD)

Authored agents and multi-step apps both live at `/solutions/apps/[id]` with the lifecycle tabs (**Build ·
Input · Runs · Review · Reports**). Edit the instructions, tools, grounding and `Runs on` pipeline under
**Build**; run and review from the adjacent tabs; delete from the catalog with confirmation. There is no
parallel custom-agent editor. Every create / edit / delete / run / review is written to
the [Audit Log](audit-logs.md).

## How to check it's working

You can prove an agent runs and grounds honestly, entirely in-product:

1. **Run a grounded, pre-built agent.** Open a grounded agent (e.g. FNOL Intake Assistant) and ask a question
   your [Brain](brain.md) corpus covers — _"what do I capture on a death claim, and what's the contestability
   rule?"_. A healthy run returns an answer whose **citations point at the actual SOP document** you ingested,
   and the trace shows the pipeline steps (policy → retrieval → answer → grounding → signing) each with a
   verdict. _(Verified: a grounded run returns cited hits from the ingested Claims SOP.)_
2. **Confirm it refuses to guess.** Ask the same grounded agent something the corpus does **not** cover. It
   should answer that it _cannot decide from the provided sources_ rather than inventing one. _(Verified: a
   reimbursement-decision run returned "I cannot decide … the sources do not contain the invoice amount or the
   quota" instead of fabricating a number.)_
3. **Confirm data steps read real rows.** For a built app with a **Read data** step, run it and open the run
   trace: a connector-query step should report a **real row count** (e.g. _"invoices (invoices): 20 rows"_),
   and a source that returns nothing shows _"No rows returned"_ — never invented rows. _(Verified live in a
   Reimbursement Approval run.)_
4. **Confirm it's signed and recorded.** Every finished run in [Agent Runs & Jobs](agent-runs-jobs.md) carries
   a signature/algorithm and a checks count. A run with no trace and no signature didn't actually execute.

If a run comes back **blocked** or **denied**, that's the governance working — open the trace and read which
check failed (a policy rule, a guardrail, a budget gate). If a _grounded_ agent answers with no citations at
all, its Brain corpus is empty for that query — ingest the source doc first (see [Brain](brain.md)).

Inline agent steps materialize automatically on first run and retain the owning app's pipeline binding.
App dispatch, direct/scheduled agent runs, and Temporal workers revalidate that binding before retrieval
or model I/O; a
deleted, deprecated, cross-org, or changed binding stops the run rather than silently running ungoverned.
Human-in-the-loop resumption requires the durable run path — see [app-builder.md](app-builder.md).

See `docs/HOWTO.md` for cross-surface recipes and `/docs/api` for the API contract.
