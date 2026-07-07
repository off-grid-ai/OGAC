# Audit Log

*Documented + verified 2026-07-07.* Surface: **Insights → Audit Log (`/audit`)**.

## What it is

The accountability trail — **who did what, to what, on which project, and how it turned out.** Every
governed action is attributed to an actor (a person by email, or a machine by its client id) and
stamped with the action, the resource, the model and tokens involved, the cost, and the outcome. You
filter it, read it, and export a defensible record.

The page's own one-line summary says it best: *"Who did what, to what, on which project — every
audited action attributed to an actor, with model, tokens, cost, and outcome. Filter and export for
compliance."*

## Why use it

- **Answer "who did this?" with certainty.** For any change — a policy edit, a key issued, a device
  killed, a run executed — there's a row with the actor, the time, and the outcome.
- **Hand a regulator or DPO a real record.** Filter to the scope they care about and export it as
  CSV or JSON. It's the evidence, not a screenshot.
- **Confirm a sensitive action was actually recorded** before you rely on it — the log is where you
  verify that governance did its job.
- **Auditing never gets in the way.** Recording an action is best-effort and off to the side, so it
  can never fail or slow down the action it's recording — but it captures the action.

## When to use it

- **Any compliance or incident review** — the first place you go.
- **After a privileged action** (a config change, a key issuance, a node swap, a device kill) — to
  confirm it landed in the trail.
- **Periodic assurance** — export a window and file it.

## How to use it

Open **Audit Log**. Rows are newest-first. Each column: **Time**, **Actor** (with a user/machine
badge), **Action**, **Project**, **Resource**, **Model**, **Tokens**, **Cost**, and **Outcome**
(color-coded — **ok**, **blocked**, **redacted**, **denied**, **error**, **unknown**).

### Filter

Every filter lives in the URL, so a filtered view is shareable and Back-coherent:

- **Search** — free text across model / action / resource.
- **Actor**, **Action**, **Project** — pick from dropdowns populated from the data itself.
- **Outcome** — ok / blocked / redacted / denied / error / unknown.
- **From** / **To** — an inclusive time window.
- **Clear filters** resets everything.

Paginate with **Prev / Next**; the header shows "X–Y of Z".

### Export

Two buttons in the header — **CSV** and **JSON** — export **exactly the filtered set** you're looking
at (the export uses the same filters as the page, so what you see is what you get). CSV columns:
time, actor type, actor, action, project, resource, model, tokens, cost, outcome, run id, ip.

### What lands here automatically

You don't wire anything up — governed actions record themselves. What's audited today (verified in
the code) is broad:

- **Chat & runs** — `chat.send`, `agent.run`, and a `budget.deny` when a call is blocked for spend.
- **Durable job control** — `agentrun.workflow.cancel` and `agentrun.workflow.terminate` (see the
  note below — this is now covered).
- **Governance changes** — `policy.change`, `guardrail.change`, `masking.change`, `routing.change`,
  ABAC changes, and `secret.write`.
- **Access & credentials** — issuing/rotating machine clients & keys, reading a client secret, user
  and role changes, identity-provider and federation changes, session revoke/logout, MFA changes.
- **Gateway & devices** — `gateway.node.model` / `.restart` / `.enable` / `.disable` (the per-node
  actions from [Model Routing](model-routing.md)) and `device.kill` (from [Fleet](fleet.md)).
- **Data & connectors** — connector create/update/delete/sync, retrieval queries, data-domain
  changes.
- **Apps** — create / update / delete / publish / run / run-review / signed report.
- **Org & compliance** — tenant and org-settings changes, backup runs, compliance adopt/change,
  feature-flag toggles.

Each record carries the actor, action, resource, outcome, and — where relevant — a **run id** that
correlates the entry to its trace in [Observability](observability.md) and its provenance record.

> **Status note (resolved 2026-07-06):** durable-job **cancel/terminate** and gateway **node-control**
> actions are now audited (`agentrun.workflow.cancel` / `.terminate`, `gateway.node.*`) — earlier docs
> flagged these as gaps; they're closed. A few non-destructive operations (e.g. an agent-run *rerun*,
> which itself produces a fresh, audited `agent.run`) are covered indirectly by the run they spawn
> rather than by a distinct action row.

## How to check it's working

The honest test is a round-trip: **take an action, then find it here.**

1. **Do something governed** — e.g. add a routing rule in [Control](model-routing.md), issue an API
   key in [Access & API keys](access-api-keys.md), or send a chat.
2. **Open Audit Log** and clear filters. The action should appear at the top as a fresh row —
   `routing.change` / `access.machine.issue` / `chat.send` — attributed to **you**, with an **ok**
   outcome and a recent **Time**. *(Verified live 2026-07-07: the log returned real recorded events,
   including `chat.send` entries attributed to a real actor with model and token counts.)*
3. **Filter to yourself** by Actor and confirm your action narrows in — proof the filters bind to real
   data.
4. **Export it.** Hit **CSV** with that filter applied and confirm the downloaded file contains the
   same row(s). That's the record you'd hand to an auditor.

If a mutation you *know* you made never shows up, that's a real finding — treat a missing audit row as
a gap to report, not a cosmetic issue.

## Related
- [Observability](observability.md) — the run id in an audit row opens that run's trace there.
- [Agent Runs & Jobs](agent-runs-jobs.md) — the runs behind `agent.run` and the durable-job actions.
- [Access & API keys](access-api-keys.md) — most `access.*` actions originate here.
- [Configuration](config-settings.md) — where the config changes that get audited are made.
