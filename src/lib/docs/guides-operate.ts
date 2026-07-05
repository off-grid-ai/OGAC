import type { DocSection } from './types';

export const operateSection: DocSection = {
  id: 'operate',
  label: 'Operate & observe',
  pages: [
    {
      slug: 'guides/gateway',
      title: 'AI Gateway & routing',
      description: 'One endpoint for every model, with the cloud on a leash.',
      body: `The gateway is the single, OpenAI-compatible endpoint every model call flows through —
open-weight models on your own nodes, and cloud models when your policy allows.

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

## What it shows

- **Cost by model, team, and virtual key**, with request and token counts.
- **Budgets** — per-key monthly limits; a completion checks the budget before it runs.
- **On-prem dividend** — local models cost zero, so the savings from running on your own hardware are
  visible next to any cloud spend.

Manage virtual keys and their budgets from the FinOps surface.`,
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
      body: `Connectors bring your systems of record into the platform. Off Grid ships connectors for
databases (Postgres, MySQL, MSSQL), object storage (S3), event streams (Kafka), and REST APIs.

## Manage connectors

On the **Integrations** page, add a connector (point it at an endpoint, choose an auth scheme), edit
it, trigger a sync, and see the ingest history — real row and document counts from the live source,
never fabricated. Delete removes it and its history.

## Real data only

A fresh deployment shows real or empty data, nothing invented. Sync counts come from the source;
metrics trace to real events. When a number can't be read, it's shown as unknown, not guessed. See
the full list of supported sources in [Integrations](/docs/integrations/catalog).`,
    },
    {
      slug: 'guides/backups',
      title: 'Backups',
      description: 'Scheduled, restorable backups of the control plane.',
      body: `Backups protect the control-plane state (the console database and configuration).

## What you can do

- See backup status and history.
- Run a backup on demand and prune old ones.
- Restore from a prior backup within your recovery target.

Backups are part of running the platform, not an afterthought — the surface lets you trigger and
verify them, not just view a schedule.`,
    },
  ],
};
