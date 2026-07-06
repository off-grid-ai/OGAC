# Policy

*Skeleton (how/what/why/when) — to be deepened.* Surface: **Governance → Policy (`/policy`)**.

## What it is

Policy-as-code (OPA) — the active policy set plus recent allow/deny decisions read back from the engine.

## Why use it

- Enforce governance as versioned code, not tribal rules.
- See real allow/deny decisions, not just the intended policy.

## When to use it

- When changing what's allowed (routing, access, data class).
- When investigating why a run was denied.

## How to use it

View the active policy set, push/reload policy, and read recent decisions. Denies show up correlated to runs in [Agent Runs](agent-runs-jobs.md) and the [Audit Log](audit-logs.md).

> This page is a skeleton written during the post-merge docs sweep. It covers what/why/when/how at a
> working level; deepen with screenshots and per-field detail in a later pass. See `docs/HOWTO.md`
> for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
