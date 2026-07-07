# Session handoff — PIPELINES × GATEWAYS architecture (live as of 2026-07-08, overnight autonomous)

Read this first if you're a fresh session continuing the console work. The git log is the source of
truth for code; this file captures the **state that isn't in code**: the live task queue, in-flight
agents, the deploy workaround, and the operating cadence. (The BUILDER-EPIC section below is older
context — still true, but the ACTIVE work is the 3-tier Pipelines×Gateways architecture, next.)

## ACTIVE WORK — the 3-tier architecture (canonical: `docs/PIPELINES_AND_GATEWAYS_PLAN.md`)

**Model (founder-confirmed, hardened, stress-tested):** GATEWAYS (reusable model backends) → PIPELINES
(reusable governed model-access = gateway binding + routing + HARD data-ceiling allowlist + policy/
guardrail overlays + evals/golden/drift + telemetry lenses) → APPS/AGENTS/CHAT (consumers + real data +
humans) + EXTERNAL 3rd-parties (per-pipeline API key). A RUN is the join key for all telemetry.
Hardened decisions: chat binds a pipeline (admin sets available set, users pick per-project); pipeline
allowlist is a HARD CEILING (widen = edit pipeline; 1:1 per app/dept is fine — composition, not forced
sharing); FinOps = one run-keyed fact table many lenses; RBAC (mgmt plane) → ABAC (data plane, OPA)
compose. **WE operate it, not the enterprise** (so no self-serve Rego bar; ship pre-built pipelines).
Adversarial-review deferred gaps logged in `docs/GAPS_BACKLOG.md` as PA-3/4/6/8/9.

**DONE + deployed + verified live:** P1 Gateways first-class (4 seeded GWs, honest health) · Pipeline
foundation (pipelines + pipeline_versions tables, pure `pipelines-policy.ts` w/ effectiveGovernance
mandatory-locked + hard-ceiling `canReachData`, versioning, CRUD, 6 BFSI seed pipelines × 2 orgs,
`/pipelines` list→detail w/ tab IA scaffolded). Schema PRE-LANDED (applied live): `golden_cases.
pipeline_id`, `eval_definitions.pipeline_id`, `pipeline_api_keys` table (so tab agents don't touch
schema.ts).

**IN FLIGHT — 4 disjoint worktree agents (launched 2026-07-08, gate=typecheck+tests+build, commit-not-
merge). Process SEQUENTIALLY as they land (token budget). File ownership is STRICT/disjoint:**
- **FANOUT-G** (task #162): Gateways full CRUD + detail view (the founder's "no way to edit gateway"). Owns `gateways*` lib/policy/routes/components/pages.
- **FANOUT-A** (task #163): Pipeline mgmt UX — fix card overflow, make pipeline EDITABLE, comprehensive Overview dashboard. Owns pipelines Manager/Overview/RoutingEditor/DetailNav + Overview/routing/versions pages + `pipeline-detail.ts`.
- **FANOUT-B** (task #164): Governance+Quality tabs (Policy/Guardrails/Quality/Drift) scoped+editable; re-point evals/golden/drift → pipeline_id. Owns those tab pages + `components/pipelines/governance/**` + eval-defs.ts/evals.ts.
- **FANOUT-C** (task #165): Per-pipeline API keys (mint/revoke/verify) + Integrate tab + public run route + telemetry tabs (Observability/Audit/Cost lenses). Owns api/observability/audit/cost tab pages + `components/pipelines/telemetry/**` + `pipeline-api-keys.ts` + keys routes.

**THE MERGE GATE IS A LIVE USABILITY AUDIT (founder: "don't give me half-assed stuff", "make sure it's
actually usable", "audit it"):** do NOT merge on green build alone. For each agent: exercise the real
write flow against the live DB (edit/mint/attach/run/toggle/revoke → read-back persists), screenshot
EVERY surface + tab (Playwright harness — see `../desktop/scripts/screenshots-pro.mjs` pattern, wide+
light), and run the full-CRUD checklist (create/read/update/delete/trigger). Placeholder-that-does-
nothing / 404-on-submit / fabricated metric / overflow = REJECT, bounce to the agent with evidence.
Anything not fully wireable this round → honest empty state (never fake) + logged gap. Report each
surface as verified-usable (with evidence) or bounced — never inflate "done."

**NEXT ROUND (after these 4 land+verify):** consumers binding — `apps.pipeline_id` + chat/project
pipeline binding (admin-sets-available-set, user-picks); then the Overview "consumers" section goes
live. Then a QA/platform-integration + user-docs sweep agent (operating-model cadence: every ~3
completions). Deferred: PA-3 team tier, PA-6 FinOps rollups + on-prem cost model, PA-8 chat multi-
pipeline, PA-4 ABAC attr-sourcing.

**Ops quickref:** deploy `SERVER=offgrid-tunnel SSH_USER=admin SSH_KEY=~/.ssh/id_ed25519 ./deploy/
push.sh`. Server docker = `/usr/local/bin/docker`; DB = `docker exec -i offgrid-console-postgres-1 psql
-U offgrid -d offgrid_console` (drizzle-kit push hangs over SSH — apply SQL directly). Admin token:
`grep OFFGRID_ADMIN_TOKEN /Users/admin/offgrid/console/.env.local` on the server. Build ON server before
restart (node22 there vs node26 local — circular-import TDZ only shows on server). Migrations don't run
on deploy — apply the `deploy/onprem/2026-*.sql` files manually.

---


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

## Live status — autonomous run (2026-07-06, founder away)

Founder stepped away; drive the tools/MCP + evals work to fully-integrated, no stopping.

**Running now (background agents, commit-early):**
- #117 tools — apps-as-tools + primitives (web_search/read_url/http) + 3-group step picker.
- #120 evals — expand template catalog to full ragas+deepeval set + G-Eval custom LLM-judge.

**Chain (MUST follow, not parallel — shares tool surface):**
- #119 MCP-server catalog — one-click add curated MCP servers (Fetch/Filesystem/Git/Memory/Sequential-Thinking + popular community) from registry.modelcontextprotocol.io; operator points at an on-prem server endpoint (air-gap-safe). Launch AFTER #117 merges.

**Also still open:**
- #114 — enable the durable `offgrid-apps` Temporal worker live on the fleet (worker:apps registered; console uses submitAppRun; queue not yet confirmed running) so HITL resume works durably in prod.
- #88 — device enrollment docs (PARKED for founder).

**Loop for each landing:** merge --no-ff → resolve conflicts (keep both) → rm -rf .next → typecheck+test+build gate → push origin main → deploy over tunnel (SERVER=offgrid-tunnel) → prune worktree. Then chain the next. North star: `docs/BUILDER_EPIC_PLAN.md` §North star — a non-technical tax/accounting person must be able to build+run a workflow unaided.

## Autonomous run — COMPLETE (2026-07-06)
Everything from the founder-away run shipped, gated (1291 tests), pushed to origin/main, deployed live:
- Evals 12→24 templates + G-Eval custom judge (#120); Tools = apps-as-tools + primitives + executor hook (#117);
  MCP-server catalog /tool-catalog, 18 servers one-click-add (#119); durable HITL live — offgrid-apps worker
  running, reimbursement app verified running durably (#114).
- Open: #88 (device-enroll docs, parked for founder); #121 (worker PII deep-config, P2); app-worker needs a
  launchd plist to survive reboot (SERVER_STATE noted).
Nothing in flight. Task list #81–120 done except the parked/noted items above.

## Catalog + IA initiative — COMPLETE (2026-07-06)
All "bundle the ecosystem catalog" tasks shipped (grounded in real libraries, air-gap-safe, honest degradation, deployed live, 1436 tests):
- Evals (24 templates + G-Eval), Tools/MCP (18 servers), Guardrails (Presidio recognizers + Guardrails-AI validators), Compliance (ISO42001/NIST-AI-RMF/EU-AI-Act + cross-map), Drift (Evidently methods+presets), Connectors (18 types), Model spec catalog (fleet-reconciled), Prompt starters + Policy templates.
- Unified Tools home under Build; catalog search/filter/sort; common Pagination component + applied broadly; list→detail views (connector/knowledge/data-domain) + audit (docs/LIST_DETAIL_AUDIT.md).
- P0 fixes: ChunkLoadError (clean rebuild + push.sh now `rm -rf .next` before build); Evals/Sandbox/Visual-QA nav orphans surfaced (+ reachability regression test).
Standing rules now in CLAUDE.md: full-width · full-CRUD · list→detail · nav-in-URL. Brand rule #9 (fill-the-width) in brand/DESIGN_PHILOSOPHY.md.
Open: #88 device-enroll docs (parked for founder); #121 worker PII deep-config (P2); app-worker launchd plist (reboot durability); Users list→detail (top list→detail follow-up per LIST_DETAIL_AUDIT.md).
