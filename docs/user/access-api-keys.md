# Access & API keys

*Documented + verified 2026-07-07.* Surface: **Governance → Access (`/access`) · Insights → FinOps (`/finops`)**.

## What it is

The place you decide **who and what can sign in** — people (with roles, passwords, and MFA), machine
clients (for services), and identity federation to your own login provider — plus **virtual keys**:
scoped, budget-capped tokens you issue for programmatic access without ever sharing a human login.
One identity system stands behind all of it, so a person or a service is defined once and works
everywhere.

## Why use it

- One front door for the whole platform: onboard a person or a service in one place, and their
  access is consistent across every surface.
- **Least privilege by construction** — roles gate what each user can do, MFA hardens sign-in, and
  sessions are visible and revocable, so offboarding is one click, not a scavenger hunt.
- Virtual keys give an integration **scoped, budgeted access** that you can revoke instantly — no
  shared passwords, and a per-key spend cap so a runaway job can't blow the budget.

## When to use it

- Onboarding/offboarding a person or a service account.
- Granting or removing a role, forcing MFA, or signing a compromised device out.
- Connecting your existing corporate login (SSO) so people sign in with credentials they already have.
- Issuing a key for a team/project/integration, with a monthly budget.

## How to use it

### Access — people, machines, roles (tabbed at `/access`)

- **Users** — search, **Add user** (email, password, name, temporary-password option, role
  toggles), and delete (with confirm). Click a user to open their **detail page**: reset password,
  add/remove roles, require or clear **MFA** (and remove a stale MFA credential), and see/revoke that
  user's **sessions** (or **Log out everywhere**).
- **Machine clients** — **New client** for a service; the client secret is shown **once** with a
  copy button. You can **reveal** or **rotate** the secret later (rotate invalidates the old one
  immediately) and delete the client.
- **Roles** — **Add role** (name + description) and delete; built-in roles (admin, viewer, editor,
  compliance) are tagged and warn before removal.
- **Sessions** — pick a user to see active sign-ins; each session's device is shown as a friendly
  `offgrid-*.local` host, **never a raw internal IP**. Revoke one session, or all.
- **MFA** — per user, require OTP setup, cancel a pending requirement, or remove a credential; the
  realm's required-action policy is shown read-only.
- **Federation** — **Add OIDC provider** (alias, display name, endpoints, client ID/secret) so users
  sign in with your existing IdP; delete to stop federated logins.
- **Realm lifetimes** — tune token and session lifespans (access-token lifespan, SSO idle/max,
  offline-session idle, etc.); blank fields keep the current value, so you never clobber settings.

### Virtual keys — issue & budget (FinOps, `/finops`)

The FinOps page shows spend, requests, tokens, and on-device %, then the **Virtual Keys** table.
**Issue key** opens a form: Name, Scope (**user** or **project**), Subject, and an optional monthly
**budget (USD)**. The token is shown **once** in a copy block — save it then, it's never shown again.
The FinOps tables (spend by model / person / project, token budgets) track what each key spends.
Revoke a key to make it stop working immediately.

## How to check it's working

- Open **Access**. If it shows the **users/roles/clients tabs with real data**, identity is wired
  end-to-end. If instead you see a **"Keycloak not configured"** card listing environment variables,
  it isn't connected yet — that card names exactly what to set. As of 2026-07-07 on the live fleet
  Access is configured: real users, roles, machine clients, and realm lifetimes all load.
- **Add a user** and confirm they appear in the list; open them and confirm roles/MFA/sessions load.
  A live session shows the friendly host name, not an IP — that's the mDNS mapping working.
- **Issue a virtual key** and confirm the `ogak_…`-style token appears in the one-time copy block and
  the key shows in the Virtual Keys table. As of 2026-07-07 the key store is configured and reachable
  (no keys issued yet on the fleet — an honest empty list, not a failure).
- **Honest bootstrap gap:** the first federation or user/client write can return a **403 with an
  actionable message** if the console's service account hasn't been granted the `realm-management`
  role. The message names exactly which role to grant to which client; the Federation tab even offers
  a **Grant access** button (with a manual fallback command). Grant it once, then retry — this is a
  known first-run step, tracked as a gap, not a broken surface.

See `docs/HOWTO.md` for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
