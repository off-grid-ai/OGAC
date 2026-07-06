# Off Grid Console — developer guide

Next.js 15 app. The AI gateway runs separately (aggregator at `127.0.0.1:8800` on-prem).

## Engineering standards (non-negotiable)

- **SOLID + clear abstraction layers.** Isolate pure policy/logic from I/O (see `src/lib/tenancy-policy.ts` — a zero-import, unit-testable rule — vs `tenancy.ts`, its session/claims adapters). Business logic in `src/lib`, thin route handlers, swappable backends behind `src/lib/adapters`. Full rules: `docs/ENGINEERING.md`.
- **Write unit AND integration tests.** Tests live in `test/`, run with `npm test` (`node --test`, type-stripped). Unit-test the pure logic; integration-test the real wiring.
- **Use mocks very sparingly** — prefer exercising real functionality (real functions, real DB/services where feasible) so tests don't hide underlying behavior. If you're mocking a lot, the code probably needs a cleaner seam instead.
- **Navigation must live in the URL / history stack.** Every screen change or in-page navigation (opening a folder, a tab, a detail view, a modal that's a "place") MUST push a corresponding history entry — drive it from the route/`searchParams` (`useRouter`/`useSearchParams`), not local `useState`. This keeps the browser Back button coherent (Back steps out of a folder/tab, doesn't dump you off the page) and makes views deep-linkable/shareable. Client-only state for a navigational position is a bug.
- **Every module is a full CRUD management surface — not a read-only dashboard.** The console is how operators **run and maintain their systems**, so each module must let them **create, read, update, AND delete** the entities it covers, and **trigger the actions** that manage the underlying system (run an eval, run/schedule a backup, re-run/cancel an agent run, push/reload a policy, create/delete a collection, write a secret, edit a masking rule). A page that only lists/aggregates data is **the bare minimum and NOT a finished feature.** For each entity: create/edit forms with validation, delete with confirmation, proper error handling, and the write routes (POST/PATCH/DELETE) behind them — console-owned entities in the DB, external-service entities pushed through the service's API. Keep the SOLID split (pure rules in `src/lib`, thin routes, tests), but the deliverable is a working management console, end-to-end usable.

## Systems of record — READ THESE (don't keep infra knowledge in your head)

Every out-of-code change to the on-prem deployment MUST be captured in one of these, in the
same commit that makes the change — otherwise it's lost when the session ends:

- **`deploy/onprem/SERVER_STATE.md`** — server env vars, DB tables created directly, Docker containers, DNS, launchd services. The imperative-change ledger.
- **`deploy/onprem/SERVICE_MAP.md`** — subdomains → services, node → model, aggregator auth.
- **`deploy/DEPLOY.md`** — deploy runbook (rsync-only; git is broken on the server; tunnel-deploy when LAN is down).
- **`deploy/onprem/cloudflared-tunnel.yml`** — tunnel ingress (keep in sync with the live `~/.cloudflared/config.yml` on S1).
- **`deploy/onprem/data-sources.yml`** + `seed-corebank.sql` — real enterprise data-source containers.
- **`deploy/onprem/dns-records.sh`** — replay Cloudflare DNS records.
- **`docs/ROADMAP.md`** — phases + milestones. **`docs/ENGINEERING.md`** — SOLID / ports-and-adapters rules.

If you change server env, DNS, a container, Keycloak, or a launchd job: update SERVER_STATE.md.

## Dev

```bash
npm run dev          # start dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run db:push      # push schema changes
npm run smoke        # hit each service health endpoint
```

Infra (Postgres, OpenBao, Redis, etc.) lives in `deploy/`. Start what you need:

```bash
cd deploy && make up           # full stack
cd deploy && make data         # Postgres + SeaweedFS only
cd deploy && make secrets      # OpenBao only
```

## Deploying to the on-prem fleet

**Full runbook: [`deploy/DEPLOY.md`](deploy/DEPLOY.md) — read it before deploying.**

```bash
./deploy/push.sh          # from YOUR Mac: rsync source + @offgrid pkgs, build, restart
```

Two traps that make a deploy silently no-op (both handled by `push.sh`, documented in DEPLOY.md):
1. **`git` is dead on the SERVER** (no Xcode CLT) — `git pull` fails silently, code stays stale. Deploy via rsync, not git.
2. **`shared/` monorepo isn't on the server** — the `@offgrid/*` file: deps must be rsync'd or the build fails with "Module not found".

Other essentials:
- The console runs **natively** (`next start` on `:3000`), **no pm2**. Restart = `pkill -f next-server` then relaunch.
- Non-interactive SSH has a minimal PATH — always call node by absolute path (`/usr/local/bin/node node_modules/.bin/next`).
- `drizzle-kit push` hangs over SSH; apply schema changes with the `pg` client directly (see DEPLOY.md § Database migrations).
- Runtime config is `.env.local` / `.env.production` **on the server** — not in git, never overwritten by deploy.

## Production hardening

**Local hardening/verify script:** `deploy/prod.sh`

```bash
./deploy/prod.sh          # build + start
./deploy/prod.sh start    # start only (skip build)
./deploy/prod.sh verify   # smoke-test headers, dev-login, rate limiter
```

**Before running in production:**
1. Fill in `.env.production` — copy `.env.local`, then:
   - Replace `DATABASE_URL` password (not `offgrid:offgrid`)
   - Add Keycloak env vars (see below)
   - `AUTH_DEV_LOGIN=false` is already set — do not change it
   - `AUTH_URL` is not needed — `AUTH_TRUST_HOST=true` handles it via Cloudflare headers
2. Set up Cloudflare Access on your tunnel subdomain (free tier, email OTP)
3. Run `./deploy/prod.sh verify` after starting to confirm headers + rate limiter are live

**What hardening is in place:**
- Security headers (CSP, HSTS, X-Frame-Options, etc.) — `next.config.mjs`
- Rate limiter 60 req/min per IP on `/api/*` — `src/middleware.ts`
- Dev login disabled via `AUTH_DEV_LOGIN=false` in `.env.production`
- Admin token rotated from dev default in `.env.production`

## Auth

NextAuth v5. Providers activate based on env vars — Google, Microsoft Entra, Keycloak, or dev credentials (dev only, never in production). See `src/auth.config.ts`.

Service accounts use `Authorization: Bearer <OFFGRID_ADMIN_TOKEN>` — middleware passes these through to handler-level verification.


## Design

Inherit the shared Off Grid design philosophy from `../brand/DESIGN_PHILOSOPHY.md` (the source of truth — brutalist/terminal, Menlo mono, emerald accent, tokens in `@offgrid/design`). Platform specifics: this repo has no separate design doc yet — follow the shared philosophy and the tokens directly.

### Use the full width — no wasted real estate (NON-NEGOTIABLE, applies to EVERY page)

This is a desktop-first operator console on wide (≥1440px) screens. **Content must fill the available width.** The single most repeated piece of design feedback here is "wasted real estate / not desktop-optimised" — do NOT reintroduce it.

- **Never wrap a full PAGE in `mx-auto max-w-2xl/3xl/4xl`.** That centers content in a skinny column and leaves 30–50% of a wide screen empty. Page shells fill the width (the console `<main>` already pads with `p-6`); a page's root should be full-width (`w-full`, or at most `max-w-7xl`/`max-w-[110rem]` for the very widest surfaces).
- **Lay out with responsive grids/columns**, not one tall centered stack: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`. Card lists are grids. A form + its help/preview sit side-by-side on `lg+`, not stacked in a narrow column. Stat rows are multi-column bands.
- **The ONLY thing that stays narrow is a single reading/measure column** — long prose, or one focused input (a chat composer, a single textarea) — cap those at ~`max-w-2xl`/`prose` *inside* a full-width page, never by centering the whole page.
- Still responsive: columns stack on narrow/tablet; wide tables/diagrams scroll inside their own `overflow-x-auto`, the page body never scrolls horizontally.
- Verify against a wide viewport: if a full-page surface leaves a large empty gutter on either side, it's a bug — fix it before calling the work done.

## Multi-agent operating model (how we build here)

Substantial work is executed by a fleet of parallel subagents orchestrated by the main session — not one linear thread. The standard:

- **Parallel workers, 3 at a time.** Decompose work into worktree-isolated subagents that run concurrently in a rolling window of ~3, each on a DISJOINT file-set so they never merge-conflict. As each lands: review against the engineering standards, merge, run a **local production build gate** (typecheck + tests do NOT catch build/route errors — build before deploy), deploy, verify, then launch the next from the backlog. One agent owns nav/shared-file changes per round; the others avoid them.
- **The gap agent.** Any gap, regression, or "not fully done" is logged to the repo's gaps doc (`docs/GAPS_BACKLOG.md`). A standing gap agent is woken whenever there are gaps: it picks them up, closes them, and marks them resolved with evidence. Gaps are surfaced honestly, never hidden.
- **The QA / platform-integration + docs sweep agent.** After every 3 agent completions, run a sweep agent that (a) verifies the whole platform integrates and works end-to-end (run the integration harness + exercise real cross-service/-surface flows), (b) surfaces any new gaps into the gaps doc, and (c) writes/updates USER-FACING documentation live — how to use / what to do / why / when, per surface — so docs stay current with the build.
- **Merge gate (every merge, non-negotiable):** SOLID + pure logic isolated (unit-testable, zero-IO) separated from I/O; thin handlers; REAL tests exercising real behavior (mocks sparingly); typecheck clean; tests pass; a clean local production build; verify UI by screenshot (vision) and integration by the harness. Nothing is "done" until VERIFIED live, not merely merged.
- **Honesty bar:** report status as a gate (code / wired / verified), never inflate "done." A premature "complete" is a defect.
