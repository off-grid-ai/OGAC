# Secrets

*Skeleton (how/what/why/when) — to be deepened.* Surface: **Governance → Secrets (`/secrets`)**.

## What it is

Secrets management (OpenBao) — seal status, mounts, and secret lifecycle. Values are never displayed.

## Why use it

- One audited home for credentials, sealed at rest.
- Service credentials are minted/held here, not hard-coded.

## When to use it

- Writing/rotating a secret a service needs.
- Checking seal status / mounts during an incident.

## How to use it

View seal status and mounts, write/rotate a secret (value never echoed back), and manage its lifecycle. Distinct from env-level secret values in [Configuration](config-settings.md).

> This page is a skeleton written during the post-merge docs sweep. It covers what/why/when/how at a
> working level; deepen with screenshots and per-field detail in a later pass. See `docs/HOWTO.md`
> for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
