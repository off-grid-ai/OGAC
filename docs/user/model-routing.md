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

> This page is a skeleton written during the post-merge docs sweep. It covers what/why/when/how at a
> working level; deepen with screenshots and per-field detail in a later pass. See `docs/HOWTO.md`
> for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
