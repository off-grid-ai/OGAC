# Access & API keys

*Skeleton (how/what/why/when) — to be deepened.* Surface: **Governance → Access (`/access`) · FinOps → keys**.

## What it is

**Access** manages users, roles, and machine clients via Keycloak. **Virtual keys** (FinOps) are the `ogk_…` tokens you issue for scoped, budgeted API access.

## Why use it

- One identity system (Keycloak) for people and machines; one credential works everywhere.
- Virtual keys give scoped, budget-capped programmatic access without sharing a human login.

## When to use it

- Onboarding/offboarding a user or a service account.
- Issuing a key for a team/project/integration with a budget.

## How to use it

In **Access**, create/edit/delete users, roles, and machine clients. To issue a virtual key: FinOps → Issue key (name, scope, subject, optional budget) → copy the `ogk_…` token (shown once). Revoke by toggling it off. See `docs/HOWTO.md`.

> This page is a skeleton written during the post-merge docs sweep. It covers what/why/when/how at a
> working level; deepen with screenshots and per-field detail in a later pass. See `docs/HOWTO.md`
> for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
