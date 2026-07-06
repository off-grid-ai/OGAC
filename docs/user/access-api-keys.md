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

### Sessions (who's signed in)

Per user, Access shows active **sessions** — merging Keycloak's online (live) and offline
(refresh-token) sessions, deduped so a live session wins, sorted most-recent first. Each session's IP
is shown as a friendly mDNS host (`offgrid-*.local`), never a raw internal IP. You can **revoke** a
session to sign that device out.

### Identity federation (external IdPs)

Under Access you can add/remove identity providers (OIDC/SAML) so users sign in with your existing
IdP.

> **Bootstrap note:** creating/managing an IdP requires the console's Keycloak service-account to
> hold the `realm-management` role. On a fresh realm this is **not** granted automatically — the
> first federation write returns a 403 with an **actionable message** naming exactly which role to
> grant, to which client (`OFFGRID_KEYCLOAK_ADMIN_CLIENT_ID`), in the Keycloak admin console. Grant
> it once, then retry. (Auto-granting this on provision is tracked as a gap.)

See `docs/HOWTO.md` for step-by-step recipes and `/docs/api` for the API contract.
