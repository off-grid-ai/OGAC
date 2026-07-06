# AI Gateway & Model Routing

*Skeleton (how/what/why/when) — to be deepened.* Surface: **Gateway & Fleet → AI Gateway (`/gateway`)**.

## What it is

The LLM gateway — model routing (local + leashed cloud), providers, an OpenAI-compatible endpoint, and a cache. Routing rules decide where each request goes by attribute (data class, task, cost, region).

## Why use it

- One endpoint for all inference, with policy-driven routing (e.g. PII → local, public → cloud).
- Cloud is leashed by the egress switch — a cloud decision with egress off becomes block.

## When to use it

- To add/adjust a routing rule (incl. data-residency/geo).
- To manage providers, the cache, or inspect the node→model map.

## How to use it

Add a routing rule (attribute, operator, value, action local/cloud/block, optional model), test it with the evaluator, manage providers and cache. See `docs/HOWTO.md` § routing for exact steps.

### Node control (per-node fleet actions)

The gateway page lists the pool of model nodes (node → model map). For each node, an **admin** can
trigger control actions that the cluster gateway executes over SSH from the S1 aggregator:

- **Swap model** — set the active model on that node.
- **Restart** — restart the node's model server.
- **Enable / Disable** — add or remove the node from the routing pool.

These are **honest about backing support**: if the aggregator doesn't implement an action (or is an
older build), the console reports it as *not actionable* (501) rather than faking success; if the
aggregator is unreachable you get a clear error, never a silent no-op. Node control is admin-only.

> Note: node-control actions are not yet written to the Audit Log (tracked as a gap). Model-routing
> rule changes and chat completions are audited.

See `docs/HOWTO.md` for step-by-step recipes and `/docs/api` for the API contract.
