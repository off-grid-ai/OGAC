# Configuration

*Fully documented.* Surface: **Operations → Configuration** (`/config`).

## What it is

The single place to see and edit **every environment setting** the console runs on — the gateway URL,
every service URL, auth settings, adapter selections, feature toggles — each with its group, a
description, whether it requires a restart, and its effective current value. **Secret values are
never displayed** (masked; revealed only on explicit request, per key). Host-bearing values are shown
as **mDNS hostnames** (`offgrid-s1.local`, `offgrid-g6.local`) — never a raw IP or `127.0.0.1`.

Edits are written back to the server's `.env.local` and take effect on the next restart. Every change
is recorded in the audit log (secret values redacted in the audit).

## Why use it

- **One pane for all runtime config** — instead of SSHing to the box to read/edit `.env`, you see and
  change every setting from the UI, grouped and described.
- **Safe by construction** — secrets are masked, so config is browsable without leaking credentials;
  host values render as mDNS so no raw internal IP is ever exposed in the UI (a founder directive).
- **Change what a service points at** — swap an adapter, repoint a URL, flip a toggle, then restart.

## When to use it

- Wiring a new backend (set its URL + select its adapter) — e.g. point Guardrails at Presidio, or
  Lineage at Marquez.
- Enabling durable agent runs (`OFFGRID_QUEUE_ENABLED=1` + the Temporal address) — see
  [Agent Runs & Jobs](agent-runs-jobs.md).
- Checking the *effective* value of a setting when a surface behaves unexpectedly (is the URL what you
  think it is?).
- Rotating or setting a secret value (write-only from here; the value is never echoed back).

## How to use it

1. Open **Configuration**. Settings are grouped (AI Gateway, Keycloak admin, Services, …). Each row
   shows the key, label, description, effective value, and a **restart-required** marker where
   relevant.
2. **Host values** display as mDNS (`offgrid-s1.local:6333`). This is display-only — the server keeps
   connecting to the real loopback/LAN target underneath. When you **edit and save** a host value, the
   console maps your mDNS host back to the real connect target before persisting, so **what you see is
   mDNS while connectivity is unbroken**. You can leave the mDNS form as-is when editing.
3. **Secrets** show masked. To see one, use the per-key reveal; to change one, type the new value and
   save — it's written but never displayed back.
4. **Save.** The change is written to `.env.local` on the server and audited. Settings marked
   *restart-required* apply after the console restarts (`next start` on `:3000`, no pm2 — restart per
   the deploy runbook).

## Gotchas

- **Restart to apply.** Most host/adapter changes are restart-required; the value is saved but not
  live until the console restarts.
- **mDNS is display, not connection.** Don't hand-edit a host into a raw IP expecting it to "fix"
  something — the mapping already handles loopback/g6-proxy routing; a raw private IP you type is
  itself rewritten to mDNS on display and mapped safely.
- **`.env.local` is server-only.** Never committed to git, never overwritten by deploy — Configuration
  is the supported way to change it.

## Related
- [Services](services.md) — see whether the endpoint you just configured is actually reachable.
- [Secrets](secrets.md) — the OpenBao-backed secret store (distinct from env-level secret values).
