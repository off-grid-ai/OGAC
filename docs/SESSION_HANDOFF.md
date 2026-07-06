# Session handoff — console UX pass + BUILDER EPIC (live as of 2026-07-06)

Read this first if you're a fresh session continuing the console work. The git log is the source of
truth for code; this file captures the **state that isn't in code**: the live task queue, in-flight
agents, the deploy workaround, and the operating cadence.

## Git trunk (IMPORTANT)
Work is on **`main`**, pushed to `origin` (github.com/off-grid-ai/console). Commit small + meaningful
(one per feature) and **push `main` after each merge** — the founder wants this. NOTE: git works
LOCALLY (only the on-prem SERVERS have broken git — deploys are rsync, never git). Earlier this
session ~19 commits drifted onto a `task-89-*` feature branch while `main` sat stale; reconciled by
fast-forwarding main + pushing. Stay on `main`; don't let a worktree checkout strand HEAD on a branch.

## THE BUILDER EPIC (the founder's current priority — #101-108)
Studio + Agents unify into ONE governed builder where a non-technical dept head describes a
multi-step business process in plain language (canonical: reimbursement approval — read invoice →
check quota → check eligibility → approve) and gets a RUNNING, GOVERNED app. It inherits org
connectors/data-sources/tools/guardrails/policy/Brain; connectors act as a SEMANTIC RULE ENGINE
(declared data→source map: "customer data → Salesforce", "transactions → Postgres"); real input
triggers (email/WhatsApp/reports/webhook/schedule); human-in-the-loop + input forms + reports; the
React-node canvas must actually work. **The architecture + phased disjoint-agent decomposition is
being written to `docs/BUILDER_EPIC_PLAN.md`** — read it before launching epic agents (execute phase
by phase, ~3 disjoint agents at a time; foundation model + connector rule engine BEFORE surface).

## How to deploy RIGHT NOW (LAN is down — use the tunnel)

Direct LAN (`127.0.0.1`) is **unreachable** this session. Deploy over the cloudflared tunnel:

```bash
SERVER=offgrid-tunnel SSH_USER=admin SSH_KEY=~/.ssh/id_ed25519 ./deploy/push.sh
```

`offgrid-tunnel` is a Host alias added to `~/.ssh/config`:

```
Host offgrid-tunnel
  HostName ssh.example.internal
  User admin
  IdentityFile ~/.ssh/id_ed25519
  ProxyCommand cloudflared access ssh --hostname ssh.example.internal
  StrictHostKeyChecking accept-new
```

- `push.sh` rsyncs source (incl. `scripts/`) + `@offgrid/*`, builds ON the server (node22), restarts
  the console. It does **NOT** restart the aggregator or run migrations.
- Server paths: repo at `/Users/admin/offgrid/console` (NOT `~/console`). Node at `/usr/local/bin/node`.
- **Restart the aggregator** after any `scripts/gateway-aggregator.mjs` change:
  `sudo launchctl kickstart -k system/co.getoffgridai.aggregator`
- Admin token for server-side API tests: `OFFGRID_ADMIN_TOKEN` in `/Users/admin/offgrid/console/.env.local`.
- Public URL: `https://onprem-console.getoffgridai.co`. Login `mac@example.com` / `changeme`.

## Operating model (RE-READ — we drifted; get back on it)

Per CLAUDE.md: parallel worktree agents ~3 at a time on DISJOINT file-sets; a **gap agent** for any
breakage (logged in `docs/GAPS_BACKLOG.md`); a **QA/platform-integration + user-docs sweep** after
every 3 merges. **Merge gate includes LIVE vision (screenshot) verification** — we drifted by only
build-gating, so the founder caught UI bugs we should have. Every UI merge: screenshot-verify before
calling it done.

## In-flight agents (worktree branches — check `git worktree list`)

Done, awaiting merge (wrap BrainNav in the shared `src/components/nav/SubNav` at merge — its base
predated SubNav):
- `worktree-agent-ae16936914440ff87` — Brain `?view=` sub-nav (commit a36532b)
- `worktree-agent-a28ba6bb704453024` — Data page grid overhaul (commit 8ad3cfe)

Running (wait for completion notifications):
- `worktree-agent-a8c05ef7934ae2166` — Gateway tabs: Fleet-config grid, Node-control wiring,
  Tuning stat-grid, Tokens IP→mDNS (tasks #82/#83/#84/#85)
- `worktree-agent-aac6d9a4e44891817` — GAP agent: Keycloak Sessions (#36) + Federation 403 (#37)

Merge order: reconcile BrainNav→SubNav, then merge all, clean `.next`, typecheck+test+build gate,
deploy over tunnel, restart aggregator if scripts changed, **vision-verify live**, prune worktrees.

## Pending task queue (session-bound — mirrors the in-session task list)

- #81 Services page → denser grid (ServicesDirectory.tsx) — NOT started
- #82 Fleet configuration → grid (GatewayFleetConfig.tsx) — Gateway agent
- #83 Node control clickable (GatewayControl.tsx → wire to aggregator `POST /nodes/:name`) — Gateway agent
- #84 Gateway Routing/Health tuning → stat grid (GatewayTuning.tsx) — Gateway agent
- #85 Tokens tab: mDNS raw 127.0.0.1 (GatewayTokens.tsx). Clarifying copy DROPPED (founder OK with it) — Gateway agent
- #86 Connector directory (Data) → cards — Data agent (done, awaiting merge)
- #87 Sidebar "DATA / Data" dupe → renamed module label to **"Connectors"** (registry.ts) — DONE in code, uncommitted, rides next deploy
- #88 [FOUNDER TODO] document how to actually enroll a device — PARKED for the founder, do not action
- #89 Integrations page → categorized sub-navs — NOT started
- #90 / GAPS #37 Federation 403 — gap agent
- GAPS #36 Sessions "no active sessions" — gap agent

## Shipped + live-verified earlier this session (see git log for hashes)

- `ogak_` API-key prefix (was `ogk_`), E2E verified minting→aggregator auth (200).
- Sandbox: `--pull never` + pre-pulled `python:3.11-slim` + `node:20-slim` on S1 (both run, exit 0).
- `/docs/api`: self-hosted Scalar bundle (`public/scalar.standalone.js`), branded pageTitle/favicon.
- CSP: `font-src 'self' data:`. Shared `SubNav` emerald band on Workspace/Build/Data/Insights/Governance navs.
- Workspace revamp, Temporal Jobs surface, Config mDNS + honest health, chat Settings/Memory → side panels,
  project-detail redesign, toast-on-toggle, Studio+Agents→Build consolidation, Keycloak multi API-keys.

## Systems of record (keep updated with any infra change)

`deploy/onprem/SERVER_STATE.md`, `SERVICE_MAP.md`, `deploy/DEPLOY.md`, `docs/GAPS_BACKLOG.md`.
