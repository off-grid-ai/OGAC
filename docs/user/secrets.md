# Secrets

*Documented + verified 2026-07-07.* Surface: **Governance → Secrets (`/secrets`)**.

## What it is

One locked, audited home for every credential the platform uses — database passwords, service
tokens, connector keys. You write secrets in and services read them at runtime; the store keeps them
encrypted at rest and this page never shows a value back to anyone, including you. It also mints
**short-lived database credentials on demand** so services don't hold standing passwords.

## Why use it

- Credentials stop living in config files and heads and get a **single, encrypted, audited home** —
  write once, services read at runtime, nothing hard-coded.
- Values are **write-only**: even an admin on this page can't read a secret back, so a shoulder-surf
  or a screenshot leaks nothing.
- On-demand, expiring database credentials mean a leaked password is useless in hours, and you can
  revoke any lease instantly.

## When to use it

- Adding or rotating a credential a service needs (a connector key, a service token).
- Handing a service short-lived database access instead of a standing password.
- During an incident: checking the store is unlocked and reachable, or revoking a lease that's been
  compromised.

## How to use it

The page opens with a status band and summary tiles, then the key manager, then operational controls
and the mount table.

### Read the status

Four tiles show the honest state: **Reachable** (is the store responding), **Seal status**
(**Unsealed** = usable, **Sealed** = locked, nothing can be read or written), **Active adapter**
(where secrets are actually stored), and **Version**. A banner appears if the store isn't configured
(the console falls back to a plain environment-variable adapter) or is sealed.

### Manage keys (write-only)

The key manager lists secret **names and folders only** — never values. **Add secret** (opens via
the panel) writes a new key/value; the value you type is stored and **never echoed back**. You can
browse folders, view a key's **version history**, roll back / rotate, and delete a key with
confirmation. Because reads never return the value, the only signal a write worked is the key
appearing in the list (and its new version in history).

### Seal control (incident use)

When the store is reachable, **Seal control** shows seal status and the key-share progress.
**Seal vault** locks everything (with a hard confirm — this breaks every service reading secrets).
**Unseal** takes operator key shares one at a time (**Submit share**), with a **Reset attempt**
option. Unsealing is deliberately a manual, multi-person operation.

### Dynamic database credentials

If a database secrets engine is configured, **Dynamic DB** lists the available roles. **Generate
creds** mints a fresh username/password with a lease TTL, shown **once** with copy buttons — dismiss
to clear. These expire automatically. If no roles exist, the panel says so and points at the setting
to enable it.

### Leases

**Leases** lets you **List** active leases under a prefix, **look up** a lease's TTL / renewable /
expiry, and **revoke** one (trash icon, with confirm) — invalidating that credential immediately.

### Mounts

The **Mounts** table lists the store's mount paths and their types (status/metadata only, never
values) so you can see how the store is organized.

## How to check it's working

- The status tiles are the honest signal: **Reachable = Yes** and **Seal status = Unsealed** means
  the store is live and serving secrets. As of 2026-07-07 on the live fleet the store (OpenBao) is
  reachable and unsealed, the active adapter is the KMS-backed store (not the env-var fallback), and
  six secret folders are present (`datasources/`, `fleet/`, `gateway/`, `opensearch/`, `seaweedfs/`,
  `temporal/`) — this surface is working end-to-end.
- If the tile reads **Sealed** or **Reachable = No**, secrets can't be served — services depending on
  them will fail until it's unsealed/reachable. A **not configured** banner means you're on the
  plain env-var fallback, not the encrypted store.
- After writing a secret, confirm the key appears in the list and its version shows in history — that
  is the only confirmation you get, by design (the value is never read back). After **Generate
  creds**, the credential shows once with a live TTL.

This surface is distinct from env-level values in [Configuration](config-settings.md), which are
masked settings rather than the managed secret lifecycle here.

See `docs/HOWTO.md` for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
