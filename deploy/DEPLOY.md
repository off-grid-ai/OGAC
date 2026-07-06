# On-prem deploy runbook

How the Off Grid Console gets onto the fleet, and the traps that make it look like
a deploy "worked" when it didn't.

## TL;DR

From your Mac (the coordinator), not the server:

```bash
./deploy/push.sh
```

That rsyncs source + the `@offgrid/*` packages, rebuilds, and restarts. Done.

---

## The fleet

| Node | IP | Role |
|------|----|----|
| **SERVER** | `127.0.0.1` | Postgres (OrbStack), Console (native `next start`), Caddy edge, Cloudflare tunnel |
| **GATEWAY** | separate Mac | Native inference on `:7878` (Off Grid Desktop / headless gateway) |
| Services A | `192.168.1.63` | OpenSearch, Qdrant, OPA, OpenBao, Temporal, Marquez |
| Services B | — | Langfuse, Unleash, Presidio, Redis |

The console runs **natively** on the SERVER (not in Docker) via `next start` on `:3000`.
Caddy fronts it; the Cloudflare tunnel exposes `onprem-console.getoffgridai.co`.

---

## The two traps (read these)

### 1. `git` does not work on the SERVER

The SERVER Mac has **no Xcode Command Line Tools**, so `/usr/bin/git` is Apple's
stub that just prints `xcode-select: note: No developer tools were found` and exits
non-zero. Every `git pull` there fails **silently inside an `&&` chain** — the build
runs against stale code and the deploy looks successful.

**Do not deploy with git.** Use `push.sh` (rsync), or install CLT once on the server:

```bash
# on the SERVER, with a human present (interactive GUI prompt):
xcode-select --install
```

### 2. The `shared` monorepo is not on the server

Only `console` and `gateway` are checked out under `/Users/admin/offgrid`. The
console file:-links four packages:

```
@offgrid/analytics  → ../shared/packages/analytics
@offgrid/finops     → ../shared/packages/finops
@offgrid/policy     → ../shared/packages/policy
@offgrid/vectordb   → ../shared/packages/vectordb
```

If `shared/` is missing, those symlinks dangle and the build fails with
`Module not found: Can't resolve '@offgrid/analytics'`. `push.sh` rsyncs these
package dirs (dist + package.json) every run so the links always resolve.

It also syncs `gateway/dist` + `gateway/package.json`, because `src/lib/agentrun.ts`
dynamically imports `@offgrid/gateway/queue` — a subpath export that only exists in
the current gateway build.

### 3. The console (next-server) cannot egress to the LAN — use localhost Caddy proxies

The `next-server` process on S1 gets **`EHOSTUNREACH` connecting to any `192.168.1.x`
host**, while `curl` and short-lived `node` from the SAME box reach S2 fine, and
`127.0.0.1` always works. Cause: **macOS 15 (Darwin 25) Local Network privacy** blocks
the SSH-launched daemon and there's no GUI prompt to grant it. Symptom: every S2-backed
integration (Langfuse, Unleash, Superset, Fleet) shows "unreachable" / "fetch failed"
even though the services are Up and the URLs are correct.

**Do NOT** point `OFFGRID_*_URL` at `offgrid-s2.local` / a LAN IP directly — it will fail
from the console. Instead route through **Caddy** (a launchd service, *not* blocked — it
already proxies `provit`→S2): each S2 HTTP service is fronted on a loopback port in
`deploy/Caddyfile`, and the console env points at `127.0.0.1`:

```
8931 → offgrid-s2.local:3030 (Langfuse)   8933 → :8088 (Superset)
8932 → :4242 (Unleash)                     8934 → :8070 (FleetDM)
```

Debugging tip that would have saved hours: when a call fails opaquely ("fetch failed"),
**surface `err.cause.code` first** — it said `EHOSTUNREACH … Local(192.168.1.85)→(.84)`
and pinpointed this instantly. Full record in `deploy/onprem/SERVER_STATE.md`.

---

## Manual steps (what push.sh automates)

If you need to do it by hand, from your Mac:

```bash
KEY=~/.ssh/id_ed25519 ; SRV=admin@127.0.0.1 ; R=/Users/admin/offgrid

# 1. shared packages
for p in analytics finops policy vectordb; do
  rsync -az -e "ssh -i $KEY" --exclude node_modules \
    ../shared/packages/$p/ $SRV:$R/shared/packages/$p/
done

# 2. gateway (provides @offgrid/gateway/queue)
rsync -az -e "ssh -i $KEY" --exclude node_modules --exclude src \
  ../gateway/dist/ $SRV:$R/gateway/dist/
rsync -az -e "ssh -i $KEY" ../gateway/package.json $SRV:$R/gateway/package.json

# 3. console source (never clobber env or build)
rsync -az --delete -e "ssh -i $KEY" \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude '.env' --exclude '.env.local' --exclude '.env.production' \
  --exclude deploy/console.log --exclude .claude \
  ./ $SRV:$R/console/

# 4. build + restart (full node path — SSH PATH is minimal, `npx`/`next` not found)
ssh -i $KEY $SRV "cd $R/console && /usr/local/bin/node node_modules/.bin/next build"
ssh -i $KEY $SRV "pkill -f next-server; sleep 2; cd $R/console && \
  NODE_ENV=production nohup /usr/local/bin/node node_modules/.bin/next start \
  -H 0.0.0.0 -p 3000 >> deploy/console.log 2>&1 & echo started"
```

### Gotchas baked into the above
- **Full node path** (`/usr/local/bin/node`): non-interactive SSH has a minimal
  `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) — `node`, `npm`, `npx`, `next` are all
  "not found". Always call node by absolute path and run `next` via
  `node_modules/.bin/next`.
- **No pm2**: the console is a plain backgrounded `next start`. Restart = `pkill -f
  next-server` then re-launch. Logs go to `deploy/console.log`.

---

## Database migrations

`drizzle-kit push` **hangs** over SSH — it wants interactive confirmation and
`--force` doesn't suppress the prompt. For a new table, apply SQL directly with the
already-installed `pg` client (run from inside `console/` so `pg` resolves):

```bash
ssh -i ~/.ssh/id_ed25519 admin@127.0.0.1 \
  "cd /Users/admin/offgrid/console && /usr/local/bin/node -e \"
    const pg=require('pg');(async()=>{const c=new pg.Client({connectionString:'postgres://offgrid:offgrid@127.0.0.1:5432/offgrid_console'});
    await c.connect();await c.query('<YOUR CREATE TABLE ...>');await c.end();})()\""
```

The DB is Postgres in OrbStack on `:5432`; the app reads `DATABASE_URL` from
`.env.local` (`postgres://offgrid:offgrid@127.0.0.1:5432/offgrid_console`).

---

## Verify

```bash
ssh -i ~/.ssh/id_ed25519 admin@127.0.0.1 \
  "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/signin"   # → 200
```

A protected page (e.g. `/storage`) returns **307** (redirect to signin) when
unauthenticated — that means the route exists. **404 means the build is stale** (you
hit trap #1 or #2).

---

## Env / config

Runtime config lives in **`.env.local`** (and `.env.production`) on the SERVER — it
is NOT in git and `push.sh` never overwrites it. To change a service URL, secret, or
gateway address, edit those files on the server and restart. The **Integrations**
module in the UI (`/integrations`) surfaces adapter URLs + health read from these.

## Deploying when the LAN is down (cloudflared tunnel) — 2026-07-06

If direct LAN (`127.0.0.1:22`) times out, deploy over the cloudflared SSH tunnel. Add this Host
alias to `~/.ssh/config` once:

```
Host offgrid-tunnel
  HostName ssh.example.internal
  User admin
  IdentityFile ~/.ssh/id_ed25519
  ProxyCommand cloudflared access ssh --hostname ssh.example.internal
  StrictHostKeyChecking accept-new
```

Then point `push.sh` at it (it reads `SERVER`/`SSH_USER`/`SSH_KEY`):

```bash
SERVER=offgrid-tunnel SSH_USER=admin SSH_KEY=~/.ssh/id_ed25519 ./deploy/push.sh
```

The server repo lives at `/Users/admin/offgrid/console` (the aggregator runs from
`/Users/admin/offgrid/console/scripts/gateway-aggregator.mjs`). Restart the aggregator after any
change to that script: `sudo launchctl kickstart -k system/co.getoffgridai.aggregator`.
