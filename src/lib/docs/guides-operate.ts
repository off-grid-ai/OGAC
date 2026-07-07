import type { DocSection } from './types';

export const operateSection: DocSection = {
  id: 'operate',
  label: 'Operate & observe',
  pages: [
    {
      slug: 'guides/overview',
      title: 'Overview (home)',
      description: 'The operator’s landing page — health, governance posture, cost, and quick actions.',
      body: `Overview is where an operator lands. Instead of a flat list of modules, it answers the
three questions you have every morning — is my AI healthy, is it safe, what is it costing — and puts
the next action one click away.

![The Overview home — governance posture, traffic, spend, and recent activity](/docs-shots/overview.png)

## What it shows

- **Governance posture** — the policy engine state, guardrail actions in the window, and the live
  cloud-egress state. At a glance: is the box leashed.
- **Traffic & health** — request volume, latency p95, and how much of your traffic is served
  on-prem vs. cloud.
- **Spend** — cost for the window, the on-prem share (local models cost zero), and any virtual key
  over budget.
- **Data & recent activity** — connected data sources and the most recent governed runs.

## Quick actions

Every stat is a link into the surface behind it, so you go from a number to the place you act on it:
a key over budget jumps to [FinOps](/docs/guides/finops), a guardrail spike to
[Guardrails](/docs/guides/guardrails), egress to [Control](/docs/guides/control). Start a chat,
add a connector, or open a report straight from here.

Every figure traces to a real event. An unreachable source reads as unknown or zero, never a
fabricated number.`,
    },
    {
      slug: 'guides/services',
      title: 'Services',
      description: 'The map of everything you run, with live, server-probed health.',
      body: `Services is the directory of every Off Grid AI surface — the console, the model gateway, the
product subdomains, and the swappable backends — each with health probed live from the server.

## What you see

- **Every service in one place** — its subdomain, what it does, and whether it's reachable right now.
- **Server-probed health** — the reachability check runs from the console host (where the backends
  bind to loopback), so it reflects what the platform can actually reach, not what your browser can.
- **One login** — reach any surface from here without a second sign-in.

Use it as your first stop when something looks off: a backend showing unreachable tells you where to
look before you dig into a specific module.`,
    },
    {
      slug: 'guides/edge',
      title: 'Edge & network',
      description: 'The reverse proxy and tunnel that expose the platform without open ports.',
      body: `Edge is the network boundary. A reverse proxy (Caddy) fronts your public subdomains and an
outbound tunnel exposes them without opening any inbound ports, so the platform stays reachable even
as your public IP changes.

## What it covers

- **Subdomain routing** — which public hostname maps to which internal service.
- **The tunnel** — an outbound-only connection, so nothing inbound is exposed on your network.
- **Exposure posture** — backends bind to loopback and are only reached through the console;
  the edge is the one controlled front door.

Rate limiting and WAF rules live at the edge (Caddy), not in the application, so the boundary is
enforced before a request ever reaches a service.`,
    },
    {
      slug: 'guides/gateway',
      title: 'AI Gateway & routing',
      description: 'One endpoint for every model, with the cloud on a leash.',
      body: `The gateway is the single, OpenAI-compatible endpoint every model call flows through —
open-weight models on your own nodes, and cloud models when your policy allows.

![The AI Gateway — routing rules, per-model cost, and which node served each call](/docs-shots/gateway.png)

## Routing

For each request, the first matching routing rule (by priority) decides where it runs:

- **local** — an on-prem model. Data stays on the box.
- **cloud** — an external model, and only when cloud egress is ON.
- **block** — the request is refused.

## The egress leash

Egress is the master switch. A \`cloud\` rule is forced to **block** whenever egress is off, so a
rule like \`data_class = PII → block\` means customer data cannot route off-box, whatever anyone
asks. On the **Control** page you see the live egress state and can test any request against your
rules before committing them.

## What else it does

Fallback, caching, rate limits, key management, per-model cost, and a live view of which node served
each call. Because everything flows through it, it's the one place to route, observe, and cost your
whole model estate.`,
    },
    {
      slug: 'guides/fleet',
      title: 'Fleet',
      description: 'Run the nodes and models that serve your AI.',
      body: `Fleet is how you run the hardware behind the platform. A single source-of-truth table
holds your topology; everything downstream is derived from it.

![Fleet — nodes, their roles, the model each serves, and enable/disable](/docs-shots/fleet.png)

## What you manage

- **Nodes** — each gateway node, its role (chat, vision, image, server, spare), the model it serves,
  and whether it's enabled.
- **Models per node** — edit a node's model, context size, or enable/disable it from the console; the
  change saves to the database and is pushed to the node.
- **Routing pool** — the aggregator reads its routing pool from this source of truth, so the console
  is where you decide what the fleet looks like.

Draining a node (disable) takes it out of rotation without removing it, so you can service hardware
without editing config by hand.`,
    },
    {
      slug: 'guides/observability',
      title: 'Observability',
      description: 'Traces of every run and call, on your own tracing store.',
      body: `Observability shows what your AI actually did. Every governed run and gateway call emits a
trace you can read back.

![Observability — traces of every governed run and gateway call, on your own tracing store](/docs-shots/observability.png)

## What you see

- **Agent-run traces** — the pipeline steps for each run (policy, guard, retrieve, answer, ground),
  with timing.
- **Recent traces** — a first-party read-back from your tracing store (Langfuse), with name, latency,
  and cost when available.

Traces are emitted best-effort — a failing trace never breaks a request — and read back from a store
you run, so your telemetry stays yours.`,
    },
    {
      slug: 'guides/analytics',
      title: 'Analytics',
      description: 'Volume, tokens, outcomes, and latency from the real traffic log.',
      body: `Analytics summarizes real traffic: request volume, tokens, outcomes (clean, redacted,
blocked), and latency percentiles (p50, p95). It reads from the audit/traffic index, so every number
traces to a real event — an unreachable source shows real zeros, never synthetic data.`,
    },
    {
      slug: 'guides/finops',
      title: 'FinOps',
      description: 'Cost per model, team, and key — with budgets and the on-prem dividend.',
      body: `FinOps meters usage and cost from the traffic log.

![FinOps — cost by model, team, and key, with budgets and the on-prem dividend](/docs-shots/finops.png)

## What it shows

- **Cost by model, team, and virtual key**, with request and token counts.
- **Budgets** — per-key monthly limits; a completion checks the budget before it runs.
- **On-prem dividend** — local models cost zero, so the savings from running on your own hardware are
  visible next to any cloud spend.

Manage virtual keys and their budgets from the FinOps surface.`,
    },
    {
      slug: 'guides/budgets',
      title: 'Budget enforcement',
      description: 'A spend limit that actually stops the spend — not just an alert after the fact.',
      body: `A budget you can't enforce is a suggestion. Off Grid AI checks the limit **before** a call runs,
so a team can't quietly blow past its cap and leave you to find out on the invoice.

## How it works

Every project has a virtual key with an optional monthly limit. Before a chat or agent completion
runs, the platform prices the call, adds it to what the key has already spent this month, and asks a
single question: does this stay within budget. If it doesn't, the call is refused with a clear
reason. Local models cost zero, so on-prem work never counts against the cap.

## Enforcement is on by default

The governance promise is that spend limits hold by default, not by opt-in, so hard enforcement is
**on** unless you turn it off. Three switches control it, in order of precedence:

- **A deployment-wide kill-switch** (\`OFFGRID_BUDGET_ENFORCE=false\`) forces a known posture on an
  instance regardless of database state — useful to guarantee a demo box never blocks.
- **A per-org override** (\`budget.enforce:<org>\`), so one tenant can differ from the deployment
  default — enforce for everyone but hold one team advisory, or the reverse — without flipping the
  whole instance. On a shared deployment, one org's choice never changes another's.
- **A per-deployment feature flag** (\`budget.enforce\`), editable in the console: the global default
  every org falls back to when it has no override of its own.

With enforcement off, budgets become advisory: the call still runs, but the over-budget decision is
recorded so you can alert and reconcile. It never silently changes to "no limits."

## What you set

- **Per-key monthly limits** — set on the [FinOps](/docs/guides/finops) surface, one per project key.
- **Unattributed or unlimited work runs free** — a call with no key, no limit, or zero cost is always
  allowed, so enforcement only ever bites where you've drawn a line.

Budgets pair with [Accounting](/docs/guides/accounting): the limit is the guardrail, the chargeback
report is the reconciliation.`,
    },
    {
      slug: 'guides/accounting',
      title: 'Accounting',
      description: 'Chargeback-grade cost, attributed to the team and use-case that spent it.',
      body: `Accounting turns raw usage into the numbers a finance owner needs: cost attributed to the
team, model, and use-case that spent it, over a period you choose.

![Accounting — chargeback-grade cost by team, model, and use-case](/docs-shots/accounting.png)

## What it answers

- **Who spent what** — cost by team and virtual key, so spend has an owner.
- **On what** — by model and use-case, so you can see which workloads cost the most.
- **Over which period** — pick a range; every figure is metered from the real traffic log.

Where [FinOps](/docs/guides/finops) is the live operational view (budgets, keys, the on-prem
dividend), Accounting is the period close: the chargeback report you reconcile against.`,
    },
    {
      slug: 'guides/reports',
      title: 'Reports',
      description: 'Create, run, and export signed reports over your live platform data.',
      body: `Reports turn the dashboards into a document you can hand someone. Built-in reports are
seeded; you can also compose your own templates.

![Reports — signed documents rendered live over your real platform data](/docs-shots/app-reports.png)

## Manage and run

- **Templates** — built-in reports are ready to run; create, edit, and delete custom templates.
- **Run live** — a report renders against your current platform data using the same section
  renderers as the dashboards, so a report can't drift from what the console shows.
- **Export** — as Markdown or PDF, carrying a [provenance](/docs/guides/provenance) signature so the
  exported figures are verifiable after the fact.

Custom templates compose the same live sections as the built-ins, so anything you build stays
grounded in real data.`,
    },
    {
      slug: 'guides/drift',
      title: 'Drift',
      description: 'Catch model and data drift against a baseline you control.',
      body: `Drift detection flags when a model or its inputs move away from a baseline.

## How it works

- **Signals** — per-feature distribution shift and quality degradation over a recent window vs. the
  baseline.
- **Baseline reset** — after a deliberate model or prompt change, reset the baseline so the next
  window measures against fresh reference.
- **Alert thresholds** — set bounds on drift score and eval pass-rate; crossing one raises an alert.

Manage thresholds and the baseline right on the Drift page.`,
    },
    {
      slug: 'guides/evals',
      title: 'Evals',
      description: 'Gate quality with golden sets and LLM-as-judge scoring.',
      body: `Evals prove the AI still works, with evidence rather than vibes.

![Evals — golden sets and LLM-as-judge scoring that gate quality with evidence](/docs-shots/evals.png)

## What you run

- **Golden sets** — curated query/expected-answer pairs. Manage them on the Evals page.
- **Eval runs** — score against the golden set, with pass rates and run history. LLM-as-judge scoring
  can run on live traffic when enabled.

Use evals as a regression gate: run them after a model swap or prompt change and compare the pass
rate before rolling out.`,
    },
    {
      slug: 'guides/security-events',
      title: 'Security events (SIEM)',
      description: 'The audit stream, searchable, kept to signal.',
      body: `Security Events is the read-back of the audit/security stream shipped to your search index
(OpenSearch): actor, action, outcome, and source IP for every event.

## Keep it signal

- **Filter** by outcome (allowed, denied, blocked, error), URL-driven so views are linkable.
- **Suppression rules** — mute known-noise events (a scanner IP, a service account, a health-probe
  path). Rules apply to the whole view server-side, so tiles and facets reflect them.

Full-text audit search across the stream is available from the Control page.`,
    },
    {
      slug: 'guides/audit',
      title: 'Audit ledger',
      description: 'Who sent which chats, ran which runs, and changed what — the record a regulator reads.',
      body: `The Audit ledger is the accountability record: who sent which chats, ran which workflows,
and changed what, when. It reads the same tamper-evident \`offgrid-audit\` index every governed run
writes to, so it's the artifact you hand a regulator, not a claim.

![The Audit ledger — actor, action, outcome, model, and cost per governed run](/docs-shots/audit.png)

## What each entry holds

Every completion records the actor, the action and outcome, the model and tokens, whether data left
the box, which guardrails fired with what verdict, latency, and the cost key. A single governed run
is correlated by its run id across the audit ledger, the trace store, lineage, and the signed
provenance record, so one id ties the whole story together.

## Read it

- **Filter** by actor, action, or outcome; the view is URL-driven, so a filtered slice is linkable
  and shareable.
- **Follow a run** by its id from the ledger into its [trace](/docs/guides/observability),
  [lineage](/docs/guides/lineage), and [provenance](/docs/guides/provenance).

Audit differs from [Security events](/docs/guides/security-events): audit is the full accountability
ledger; SIEM is the security-signal stream over the same events, tuned with suppression rules.`,
    },
    {
      slug: 'guides/lineage',
      title: 'Lineage',
      description: 'Trace an answer back to the sources it came from — source to answer, provable.',
      body: `Lineage traces where an answer came from: which sources fed a grounded run, all the way
back to the document. It reads OpenLineage events from Marquez, with a fallback reconstruction from
the source→answer references recorded on each run.

![Lineage — the source-to-answer graph for a governed run](/docs-shots/lineage.png)

## What it shows

- **Source-to-answer graph** — for a governed run, the retrieved sources and the answer they
  produced, linked.
- **Correlated by run id** — a lineage run is keyed to the same run id as the audit ledger and the
  trace, so you can pivot between them.

## Why it matters

When an auditor asks "how did the AI arrive at this," lineage is the map. Combined with
[provenance](/docs/guides/provenance) signing, you can both show the path and prove the answer wasn't
altered afterward.`,
    },
    {
      slug: 'guides/sandbox',
      title: 'Sandbox',
      description: 'Run agent-authored code in isolation, gated by policy.',
      body: `Sandbox runs code an agent writes, in an ephemeral, network-disabled, resource-capped
container — so an agent can compute, not just talk, without touching your systems.

## Double-gated

Execution is off by default and double-gated: the \`agent-code-exec\` feature flag must be on **and**
the active backend must be exec-capable (a Docker/Firecracker sandbox). Anything else refuses. The
Sandbox page shows the backend, its reachability, and recent runs, and states clearly when execution
is disabled.`,
    },
    {
      slug: 'guides/storage',
      title: 'Storage',
      description: 'One object store for every file the platform touches.',
      body: `Storage is the single file layer for the platform, backed by your own S3-compatible object
store (SeaweedFS). Uploaded knowledge, generated images, chat attachments, and exported artifacts all
live here.

![Storage — one object store for knowledge, generated images, attachments, and exports](/docs-shots/storage.png)

## What you can do

- Browse files by folder, with image and video previews.
- Upload and share files; a public file gets an internet-reachable URL through the gateway, a private
  one is served only to authorized callers.

There is no other file-storage path — everything the console stores goes through this one layer.`,
    },
    {
      slug: 'guides/data',
      title: 'Data & connectors',
      description: 'Connect your systems of record and keep the data real.',
      body: `Connectors bring your systems of record into the platform. Off Grid AI ships connectors for
databases (Postgres, MySQL, MSSQL), object storage (S3), event streams (Kafka), and REST APIs.

![Data — your systems of record connected, synced, and kept to real row counts](/docs-shots/data.png)

## Manage connectors

On the **Integrations** page, add a connector (point it at an endpoint, choose an auth scheme), edit
it, trigger a sync, and see the ingest history — real row and document counts from the live source,
never fabricated. Delete removes it and its history.

![Connectors — add an endpoint, choose an auth scheme, sync, and read real ingest history](/docs-shots/connectors.png)

## Real data only

A fresh deployment shows real or empty data, nothing invented. Sync counts come from the source;
metrics trace to real events. When a number can't be read, it's shown as unknown, not guessed. See
the full list of supported sources in [Integrations](/docs/integrations/catalog).`,
    },
    {
      slug: 'guides/backups',
      title: 'Backups',
      description: 'Scheduled, restorable backups of the control plane.',
      body: `Backups protect the control-plane state — the console database (every governed run, policy,
connector, and audit record) and its configuration. It is the recovery path behind
[data sovereignty](/docs/concepts/data-sovereignty): your record is only yours if you can restore it.

## What you can do

- **See status and history** — the last successful backup, its size, and the full history, read from
  a backup manifest so the figures are real, not a claimed schedule.
- **Run one on demand** — take a backup now, before a risky change, without waiting for the schedule.
- **Prune** — remove backups past your retention window.
- **Restore** — bring the control plane back from a prior backup within your recovery target.

## Scheduled and restorable

A scheduled job runs the backup sequence, writes a manifest row, and lets the surface show last-good
per component. Restore is end-to-end, not display-only: the surface triggers and verifies it. On a
[multi-tenant](/docs/concepts/multi-tenancy) deployment every org's data restores together, since
isolation is a column and a policy on shared tables, not a separate database per org.

Backups are part of running the platform, not an afterthought — the surface lets you trigger and
verify them, not just view a schedule.`,
    },
  ],
};
