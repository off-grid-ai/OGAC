# Observability

*Skeleton (how/what/why/when) — to be deepened.* Surface: **Insights → Observability (`/observability`)**.

## What it is

Agent QA: eval scores, online LLM-as-judge scores, drift, and full run traces (Langfuse-backed). Also the home tab for analytics, finops, reports, SIEM.

## Why use it

- See how well agents are actually doing, live — not just at eval time.
- Jump from a run id to its full trace.

## When to use it

- Watching quality/drift after a change.
- Debugging a specific run (open its Langfuse trace by run id).

## How to use it

Read eval + online judge scores and drift, open a run's trace by its run id. Tabs across analytics, drift, finops, usage & spend, reports, security events, and audit.

> This page is a skeleton written during the post-merge docs sweep. It covers what/why/when/how at a
> working level; deepen with screenshots and per-field detail in a later pass. See `docs/HOWTO.md`
> for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
