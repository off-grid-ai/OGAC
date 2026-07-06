# Audit Log

*Skeleton (how/what/why/when) — to be deepened.* Surface: **Insights → Audit Log (`/audit`)**.

## What it is

The accountability trail — who sent which chats, ran which workflows, and changed what. Filter by actor, action, project, outcome, and time; export CSV/JSON for compliance.

## Why use it

- Answer 'who did what, when' for any governed action.
- Export a defensible record for a regulator/DPO.

## When to use it

- Any compliance or incident review.
- Confirming a mutation (config change, run, key issuance) was recorded.

## How to use it

Filter by actor/action/project/outcome/time, inspect an event, and export CSV/JSON. Governed runs, config changes, and key issuance land here automatically. (Note: durable-job cancel/terminate audit is a tracked gap — see GAPS_BACKLOG #34.)

> This page is a skeleton written during the post-merge docs sweep. It covers what/why/when/how at a
> working level; deepen with screenshots and per-field detail in a later pass. See `docs/HOWTO.md`
> for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
