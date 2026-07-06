# Agent Runs & Jobs

*Fully documented.* Surface: **Intelligence → Agent Runs** (`/agent-runs`). Two related views live
here: the **recorded run history** (every agent/chat run and its governed pipeline timeline) and the
**Jobs** view (durable executions running on the Temporal runtime).

## What it is

Every time an agent or chat runs, the console records it: the query, the agent, and the governed
pipeline it passed through — **policy → guardrails → retrieval → gateway → grounding → provenance** —
stamped with a single **run id** that correlates the run across the audit log, Langfuse trace,
Marquez lineage, and its signed provenance record. That's the *run history*.

The **Jobs** view is a different thing sitting next to it: the live view of **durable executions** on
the Temporal runtime. When durable mode is enabled, an agent run is submitted as a retryable,
resumable Temporal workflow instead of running synchronously in-process. Jobs shows which workflows
are running, at what state, how many history events they've logged, and their correlated run id — and
lets you **re-run** a finished job or **cancel / terminate** a running one.

The two are correlated by run id: a durable job's workflow id embeds the console run id, so a Job row
links straight back to its recorded run.

## Why use it

- **Accountability & debugging** — see exactly what an agent did, in what order, and where it was
  blocked or denied. The pipeline timeline shows every governance stage, so a blocked run reads as a
  *governed outcome*, not a failure.
- **Operate long-running work** — durable jobs survive restarts and retry on failure. Jobs is where
  you watch and control them: re-run a job that finished (e.g. after fixing data), or stop one that's
  stuck or misbehaving.
- **Correlation** — one run id ties a run to its trace, lineage, and provenance, so you can jump from
  "this run" to "its audit record" to "its signed answer" without guessing.

## When to use it

- After a chat/agent gives a wrong or blocked answer — open the run to see which stage acted.
- When durable mode is on and you need to know **what's running right now** (the Jobs list
  auto-refreshes while anything is open).
- To **re-run** a completed job with the same agent + query (e.g. after ingesting the missing doc, or
  to reproduce an issue).
- To **cancel** a job that's hung, or **terminate** (force-kill) one that won't cancel gracefully.

## How to use it

### View run history
Open **Agent Runs**. Each row is a recorded run; click it to see the pipeline timeline (policy /
guard / retrieval / gateway / grounding / sign) and outcome. Follow the run id into Observability
(the Langfuse trace), Lineage (the source→answer graph), or Provenance (the signed record).

### The Jobs (durable) view
Jobs shows durable Temporal executions. Its state depends on your runtime:

- **Durable runtime not enabled** — you'll see "Durable runtime not enabled." Runs still execute
  synchronously in-process; nothing is broken. To turn on durable dispatch, set
  `OFFGRID_QUEUE_ENABLED=1` (or `OFFGRID_ADAPTER_AGENTRUNTIME=temporal`) in **Configuration**, plus
  the Temporal address, and restart. Then run an agent and it's submitted as a durable job.
- **Configured but unreachable** — Temporal is set but the cluster isn't answering. The view says so
  and stays empty; runs fall back to synchronous execution, so **selecting Temporal never breaks a
  run**.
- **Live** — a table of jobs with columns: **Job (workflow)**, **State** (mapped to running / done /
  failed / cancelled, with the raw Temporal status in parentheses), **Run** (the correlated console
  run id), **Events**, **Started**, **Closed**, and **Actions**. A pulsing "live" chip appears and
  the list auto-refreshes every 5s while any job is still open.

Click a **Job (workflow) id** to drill into its detail (execution run id, task queue, history events,
timings, and any result payload). The detail view is URL-driven (`?wf=…`), so it's back-button
coherent and shareable.

### Actions

Which actions a row offers depends on the job's state (the console gates them so it never offers a
no-op):

- **Re-run** (offered on *closed* jobs — completed / failed / cancelled / terminated / timed-out) —
  re-dispatches the **same agent + query** as a fresh run. The console correlates the workflow back to
  its recorded run, then re-submits through the normal run path — so it re-enters durable dispatch if
  enabled, or runs inline otherwise. **Re-run does not require Temporal to be reachable** (the source
  run lives in the recorded history). You get a toast on success and the list refreshes. The re-run is
  itself a new governed run — it shows up in the audit log like any other.
- **Cancel** (offered on *open* jobs — running) — requests a graceful cancellation of the workflow.
  You'll be asked to confirm.
- **Terminate** (offered on *open* jobs) — force-kills the workflow immediately. **This cannot be
  undone** and you'll be asked to confirm. Use it only when a graceful Cancel won't take.

> **Note (known gap #34):** cancel/terminate currently does not yet write its own audit event —
> re-runs are audited (they're new governed runs) but the cancel action's accountability record is a
> tracked gap. Until it lands, note terminations out-of-band.

## Related
- [Observability](observability.md) — the Langfuse trace for a run id.
- [Audit Log](audit-logs.md) — the accountability record for runs (and, once #34 lands, cancels).
- [Agents & Studio](agents-studio.md) — where the agents that produce these runs are built.
