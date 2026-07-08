# Regression & smoke — the repeatable verification playbook

The one place that captures **how we verify the console works end-to-end**, so any
deploy or big change can be re-checked as a regression instead of ad-hoc curls.
Layered fastest → slowest, cheapest → most-real.

## TL;DR — one command per layer

```bash
npm run regression        # coverage gate + real-DB integration + API smoke (local, needs Postgres up)
npm run smoke:prod        # API smoke against the LIVE console over the tunnel
```

`npm run regression` = `coverage:check` + `test:integration` + `smoke:api`. Run it before every deploy;
run `smoke:prod` right after, to confirm the live box.

## The layers

### 1. Unit + coverage gate — `npm run coverage:check`
Pure-logic layer (`src/lib` + adapters' pure paths). Enforces ≥85% on branches/statements/lines/functions
(the same gate the **pre-push hook** runs; see CLAUDE.md § Engineering standards). ~2670 tests, no services needed.

### 2. Real-DB integration — `npm run test:integration`
The `*.integration.test.ts` suite exercises the real wiring against a **live Postgres** (bring it up with
`cd deploy && make data`, or the full stack `make up`). ~80 tests: governed run paths (agent/app/chat/pipeline
contract enforcement + PII-mask escalation), connector-credential vaulting round-trip, DSAR erasure propagation,
gateway CRUD/partial-PATCH, pipeline release/consumers/quality, evals. A couple skip when a LAN-only sidecar
(Qdrant/GE) isn't reachable — expected offline.

### 3. Smoke — `npm run smoke` (full: API + real-browser UI) / `npm run smoke:api` (API only)
`scripts/smoke.mjs` drives the running console like a user. Needs a server up (`npm run start` or `npm run dev`)
+ Postgres + `AUTH_DEV_LOGIN=true` for the UI phase.

**API phase** (`--api`, no browser) — the governed-primitives gate the insurer use cases sit on:
- agents CRUD **+ governed run**: create → run → assert the full pipeline step chain
  (`policy → guard → retrieve → answer → ground → sign`) + Ed25519 provenance. Accepts **201** (inline, durable
  off) *or* **202** (durable dispatch → polls the runs list until the run settles, then asserts).
- provenance sign/verify, grounding verify, PII scan (Indian-BFSI recognisers), sandbox exec, ABAC, cache stats,
  MDM devices, QA status (evals + drift + online).

**UI phase** (full run) — real headless-Chromium e2e: dev-login → sidebar nav → detail views → interactive
checks (PII scanner, ABAC tester, Fleet/Brain/Insights detail pages).

Env-conditional (reported honestly, not failed): **sandbox** shows "engine unreachable" when no local Docker
daemon; the UI phase needs dev-login + a warm local server.

### 4. Prod smoke — `npm run smoke:prod` (`deploy/smoke-prod.sh`)
Runs the **API phase against the live console over the Cloudflare tunnel**. Pulls the admin bearer from the
server's `.env.local` (never stored locally), hits `https://onprem-console.getoffgridai.co`. On prod the agent
run is durable, so it returns 202 and the smoke polls to completion. Exit code gates a deploy.

### 5. Deploy health (post-deploy, manual spot-checks)
- `curl -s -o /dev/null -w '%{http_code}' https://onprem-console.getoffgridai.co/signin` → **200**
- workers fresh after a run-path change (launchd; see `deploy/onprem/SERVER_STATE.md` § worker restart)
- schema present: `agent_runs.org_id`, `erasure_tombstones`, `connectors.secret_ref` (self-migrate; apply
  eagerly via the `pg` client per `deploy/DEPLOY.md` § Database migrations)

## What's covered vs. still thin (be honest)
- **Strong:** governed agent run (durable, e2e), provenance, PII/guardrails, connector vault, DSAR, pipeline
  CRUD/enforcement — real DB + live prod.
- **Thin / next:** a broader **Playwright e2e suite** over the full consumption layer — build an app through the
  5-screen lifecycle, run a pipeline as a provisioned API, a guardrail **block** path, chat with citations,
  data-quality + drift surfaces. Tracked as the e2e-smoke buildout; today the smoke UI phase covers nav + a few
  interactive widgets, not full multi-step flows.
