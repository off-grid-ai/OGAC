# Building an app in plain language (the unified builder)

Status: ✅ fully documented (post-builder-epic sweep, 2026-07-06)

**What it is** — The builder turns a plain-language description of a business process into a
*governed, runnable app*. An "agent" is just the simplest app: one step. A real app is an ordered
chain of steps — read data, decide, have a person approve, emit a result — each of which runs
through the same governance (policy, guardrails, grounding, provenance signing) as a single agent.

You reach it from **Studio → New app**. There are two editing modes over the *same* app spec:

- **Guided text builder** (`/studio/new`) — describe the process, get an ordered list of steps you
  refine with forms and dropdowns. Best for non-technical operators.
- **Visual canvas** (`/studio` canvas) — the same spec rendered as a node graph you click to edit.
  Same steps, same edits — the two modes can never drift because they call the *same* edit rules.

**Why use it** — A department head can stand up a governed workflow ("reimbursement approval",
"support triage") without writing code, and without the platform silently inventing a data source
or a tool. What it can't wire, it tells you honestly.

**When to use it** — Whenever a repeatable process needs AI + your data + (optionally) a human
gate: approvals, triage, drafting-with-review, scheduled digests.

## The five screens (the app lifecycle)

1. **Build** (`/studio/new` or `/studio`) — describe → compile → refine → save.
2. **Input** (`/studio/new/[id]`) — the saved app's run form (from the spec's input fields), plus a
   test-run.
3. **Running** (`/apps/runs/[id]`) — the live per-step trace, polling until the run is terminal.
4. **Review** (inline on the Running screen) — a run paused at a human step; approve or reject.
5. **Reports** (`/apps/reports`) — rollups across runs (volume, outcomes, human-review rate).

For Apps with a governed **Action** step, the Running screen also carries the post-action business
result. It deliberately keeps two facts separate: the signed execution receipt proves what the system
changed; the business result records what happened afterward.

## How to build one

1. **Describe.** Write the outcome and the steps in plain language. Example:
   *"Reimbursement approval — read the invoice, check the employee's quota, decide if they're
   eligible, then have a manager approve or reject."* Or pick a starter example.
2. **Build the steps.** The compiler carves an ordered skeleton. Each data-access phrase becomes a
   *connector-query* bound to one of your **declared data domains** (see `data-domains.md`); each
   decision becomes an *agent* step; each approve/reject becomes a *human* step; it always ends with
   an *output*.
3. **Read the gaps panel.** If a phrase ("invoices") has no declared data domain, the builder does
   **not** fabricate a connector — it drops the step and shows a gap: *"No data source declared for
   'invoices' — add a data-domain mapping."* Resolve gaps before saving.
4. **Refine.** Reorder / relabel / add / remove steps; rebind a connector-query to a different data
   domain; point an agent step at an existing agent or write an inline instruction; toggle grounding
   ("answer strictly from retrieved knowledge, cite it"); pick the output sink.
5. **Choose a trigger** — On demand (a person runs it), Webhook (an inbound HTTP call), Schedule
   (cron), or Email (on-prem only).
6. **Choose who can use it** — just me / my org / a shareable link.
7. **Save.** The spec is re-validated server-side. You land on the **Input** screen.

## Running & the human-in-the-loop caveat (read this)

- From the **Input** screen (and the canvas "Run"), a test-run executes **inline** and to
  completion — *unless* it hits a human step, where it **pauses** and returns `awaiting_human`.
- **An inline test-run that pauses at a human step cannot be resumed from the Review screen.** The
  Review screen will tell you so honestly (it can't signal a workflow that never started). To use
  human-in-the-loop for real, the run must go through the **durable** path (a published app fired by
  a trigger, with the durable runtime enabled — `OFFGRID_QUEUE_ENABLED=1` and a Temporal worker on
  the `offgrid-apps` queue). Until the durable app worker/queue is enabled on the fleet, treat HITL
  as *design-complete but not yet live end-to-end*. See `docs/GAPS_BACKLOG.md`.

## Honesty guarantees (why you can trust the output)

- **No fabricated data sources.** A connector-query only binds to a domain your org declared; the
  resolver is deterministic and *no-guess* — an ambiguous or weak match binds to nothing.
- **No fake connector rows.** A read that fails returns "no rows", never invented data.
- **Every step is governed.** An agent step runs the full policy/guardrail/grounding/signing
  pipeline. A guardrail step can halt the run. Every save/edit/run/review is written to the audit log.

## Record what happened after an action

Use this after a governed Action step has completed and its signed receipt is visible on the App run.
For example, creating a CRM follow-up task is system completion; a customer accepting or converting
is the later business result.

1. Open **Solutions → Apps**, choose the App, open **Runs**, then choose the completed run.
2. In **Action and result**, check the signed system receipt on the left. On the right, choose
   **Record customer result**.
3. Select what happened: customer accepted, customer declined, customer converted, account cured,
   or claim settled. Add when it happened, a plain-language confirmation, and an evidence link.
   Revenue is optional.
4. Save. The result has its own shareable URL and stays correlated to the exact action step and
   receipt. Retrying the same source event does not add a duplicate.
5. If evidence changes, open the result and choose **Correct this record** or **Withdraw record**.
   The original remains in the result history for audit. It is never silently overwritten.

Only admins can record, correct, or withdraw business results. Other roles see a clear read-only
state. Deleting an App with retained result evidence is intentionally blocked so audit history cannot
be erased accidentally.

Current boundary: results are recorded from the run journey. Automatic CRM webhook/import capture
and portfolio baseline-versus-result reporting are not yet available, so one recorded result must not
be treated as automated learning or ROI proof.

## Known limitation — inline agent steps

If the compiler creates an *inline* agent step (an instruction, not a reference to an existing
agent), it currently **cannot execute** — running it returns an honest error asking you to point the
step at a real agent first. Rebind inline agent steps to an existing agent before running. Tracked
in `docs/GAPS_BACKLOG.md`.
