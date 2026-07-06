# Services

*Fully documented.* Surface: **Gateway & Fleet → Services** (`/services`).

## What it is

The directory of every Off Grid surface — the console, the AI gateway, and each product subdomain and
backend service — each with its **live health**. One login covers them all. Health is reported
**honestly**: a service is only "down" if it's a real outage. Backends that have no endpoint to probe,
or optional dependencies you degrade past gracefully, get their own honest state rather than a scary
false "down".

## Why use it

- **One glance at platform health** — is everything up, or is something actually broken?
- **No false alarms** — an embedded backend (LanceDB, which runs in-process on disk) and an optional
  dependency (Redis, which the cache falls back past) are *not* endpoints to ping; reporting them
  "down" would be a lie. Services shows them as **embedded** (healthy, no probe) and **optional** (on
  its documented fallback), so a green board means the platform is genuinely fine.
- **One door** — every service is behind one login; Services is the map.

## When to use it

- First thing when a surface misbehaves — is its backing service up?
- After wiring a new backend in [Configuration](config-settings.md) — confirm it's now reachable.
- To distinguish a real outage from an expected fallback (Redis not answering ≠ broken).

## How to use it

Open **Services**. Each card shows a surface and its state:

- **up** — a network-probed service responded (a 401/302 still counts as up — it's answering). Shows
  latency; a slow-but-up service reads **degraded**.
- **down** — a network-probed service failed (5xx / timeout / unreachable). **A real outage.**
- **embedded** — an in-process/on-disk backend (LanceDB). Healthy whenever the console is; no network
  probe is run because there's no endpoint to hit.
- **optional** — an optional external dependency (Redis) that isn't answering, so the app is on its
  documented fallback (the in-process cache). Not an outage.

The overall rollup reads **operational** (all healthy and fast), **degraded** (something slow or a
partial issue), or **down** (nothing up). Embedded and optional states count as healthy in the
rollup — so an absent Redis won't drag the whole board to "degraded".

The authenticated Services sweep and the public `/status` endpoint share the *same* probe, so they
never disagree.

## Related
- [Configuration](config-settings.md) — set the URLs/adapters the health sweep probes.
- [Observability](observability.md) — deeper per-service latency/traffic once a service is up.
