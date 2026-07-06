# Evals

*Skeleton (how/what/why/when) — to be deepened.* Surface: **Intelligence → Evals (`/evals`)**.

## What it is

Golden sets and quality gates — pass-rates and recent eval / red-team runs by suite. Runs on promptfoo through the gateway.

## Why use it

- Prove quality before shipping a change; catch regressions with a gate.
- Red-team suites surface safety failures.

## When to use it

- Before promoting an agent/prompt/model change.
- On a schedule, to watch for drift in quality.

## How to use it

Create/edit a golden set (suite of cases + expected outcomes), run it, read pass-rates and per-case results, delete suites you don't need. Trigger a run from the surface; results feed Observability.

> This page is a skeleton written during the post-merge docs sweep. It covers what/why/when/how at a
> working level; deepen with screenshots and per-field detail in a later pass. See `docs/HOWTO.md`
> for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
