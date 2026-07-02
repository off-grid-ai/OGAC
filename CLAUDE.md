# Off Grid Console — developer guide

Next.js 15 app. The AI gateway runs separately on `127.0.0.1:7878` (not in this repo).

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
