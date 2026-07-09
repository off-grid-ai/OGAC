# S1 server state — the system of record for imperative changes

Everything here was applied to S1 (`127.0.0.1` / `admin`) outside the app code, so it must
be captured here to be replayable. **When you change server env, DNS, containers, or the
Keycloak/launchd setup, update this file in the same commit.**

Related records: `SERVICE_MAP.md` (subdomains + node→model), `../DEPLOY.md` (deploy runbook),
`cloudflared-tunnel.yml` (tunnel ingress), `data-sources.yml` (data containers), `dns-records.sh`.

## Console env (`/Users/admin/offgrid/console/.env.local`) — not in git

Set/changed this session (values below; secrets marked — real values live on the box / plists):

| Key | Value | Why |
|---|---|---|
| `OFFGRID_GATEWAY_URL` | `http://127.0.0.1:8800` | Point console at the aggregator (was dead localhost:7878) |
| `OFFGRID_GATEWAY_API_KEY` | *(matches aggregator plist)* | **DEPRECATED (task #74)** — the single static `/v1/*` key. Still honored as a backward-compat fallback, but new keys are the Keycloak-backed `ogk_…` API keys minted in the console (Gateway → **API keys** tab). Each key is a Keycloak service-account client (clientId prefix `ogk-`); the aggregator verifies via `client_credentials` (`scripts/lib/gateway-key-verify.mjs`) using the SAME `OFFGRID_KEYCLOAK_URL` + `OFFGRID_KEYCLOAK_REALM` — **no new env var**. Revoke a key = disable/delete its `ogk-` client in Keycloak (aggregator picks it up within ~60s). |
| `OFFGRID_ADMIN_EMAILS` | `mac@example.com` | Founder admin override (Keycloak role is chicken-and-egg) |
| `OFFGRID_KEYCLOAK_ISSUERS` | `http://127.0.0.1:8080,https://auth.getoffgridai.co,http://auth.getoffgridai.co` | Accept LAN + public Keycloak issuers. **Added `http://auth.getoffgridai.co`**: Keycloak behind the tunnel stamps `iss` with scheme `http` (tunnel forwards to :8080 over http), so public-issuer service tokens were 401'ing until this host was accepted. |
| `AUTH_COOKIE_DOMAIN` | `.getoffgridai.co` | Cross-subdomain SSO (provit/status/landing share the session) |
| `OFFGRID_LANGFUSE_URL` | `http://192.168.1.60:3030` | Was 127.0.0.1 (wrong host) |
| `OFFGRID_UNLEASH_URL` | `http://192.168.1.60:4242` | Was 127.0.0.1 (wrong host) |
| `OFFGRID_ADMIN_TOKEN` | `offgrid-local-dev` | ⚠️ still the dev default — rotate for prod |
| `OFFGRID_REDIS_URL` | `redis://offgrid-s2.local:6379` | Was `127.0.0.1` (no Redis on S1 → Integrations showed "unreachable"). Redis runs on S2. |
| `OFFGRID_SUPERSET_URL` | `http://offgrid-s2.local:8088` | Was UNSET → Bi/Superset unhittable. Superset runs on S2 `:8088`. |
| `OFFGRID_FLEET_URL` | `http://offgrid-s2.local:8070` | Was `127.0.0.1:8070` (closed on S1). FleetDM runs on S2 `:8070`. |
| `OFFGRID_LANGFUSE_OTLP_URL` | `http://127.0.0.1:8931/api/public/otel` | otel.ts appends `/v1/traces` + Basic auth (`OFFGRID_LANGFUSE_AUTH`). Via the localhost Caddy proxy (see below). |
| `OFFGRID_LANGFUSE_URL` | `http://127.0.0.1:8931` | Langfuse read-back, via the localhost Caddy proxy. |
| `OFFGRID_FLAGS_OPEN` | `true` | **Gate-open instance (2026-07-04):** forces every feature flag ON so nothing is gated (agent-code-exec, online-evals, etc.), regardless of DB flag state. Honored in `store.isEnabled` + the Unleash adapter. Unset it to enforce per-flag state. |
| `OFFGRID_UNLEASH_URL` | `http://127.0.0.1:8932` | via localhost Caddy proxy → S2. |
| `OFFGRID_SUPERSET_URL` | `http://127.0.0.1:8933` | via localhost Caddy proxy → S2. |
| `OFFGRID_FLEET_URL` | `http://127.0.0.1:8934` | via localhost Caddy proxy → S2. |
| `OFFGRID_SUPERSET_DB_URI` | `postgresql://offgrid:offgrid@127.0.0.1:5432/offgrid_console` | SQLAlchemy URI Superset (on g6) uses to reach the console Postgres (on S1/`.59`) when **provisioning** the starter dashboard (`POST /api/v1/admin/superset/provision`). Points at the routable S1 LAN IP — `localhost`/`127.0.0.1` would resolve to the Superset container, not the DB. |
| `OFFGRID_SUPERSET_USERNAME` / `_PASSWORD` | `admin` / `Offgrid-Superset-2026!` | Superset stock admin login used by the console to auth the REST API (guest-token mint + provisioning). **2026-07-08:** the container's admin password did NOT match this env (login 401'd) — re-synced on g6 with `docker exec offgrid-services-b-superset-1 superset fab reset-password --username admin --password '…'`. If Superset login 401s again, reset it to this value. |
| `OFFGRID_SUPERSET_EMBED_UUID` | `8cf450b7-3b71-47e8-8c2b-f86bc2a62b45` | **Embed UUID of the provisioned "Off Grid AI — Gateway Overview" dashboard** (`dashboard_id=1` on g6 Superset). This is the *embedded-SDK* uuid (`GET /api/v1/dashboard/1/embedded`), **not** the dashboard's native uuid — the two differ, and the dashboard LIST endpoint exposes no uuid column at all. The console verifies existence by matching dashboard **title** in the list → then confirming that id's `/embedded` uuid equals this (`embeddedUuidMatches`), so a drifted/missing embed uuid degrades to an honest "not provisioned" CTA, never a blank iframe. |

> **Superset starter dashboard — LIVE (task #9, 2026-07-08).** "Off Grid AI — Gateway Overview"
> (`dashboard_id=1`, embed uuid `8cf450b7-…a62b45`, published, embedding enabled with open
> `allowed_domains`) is provisioned on g6 Superset over the console Postgres `audit_events` table,
> with two charts: **Requests over time** (daily event count) and **Tokens by model** (summed
> tokens grouped by model), both laid out in the dashboard `position_json`. Provisioning is
> idempotent — `POST /api/v1/admin/superset/provision` (or the "Provision dashboard" button on
> `/analytics`) reuses it by title rather than duplicating. To re-provision from scratch: delete
> dashboard 1 in Superset, then hit the route. Charts read the console DB directly via
> `OFFGRID_SUPERSET_DB_URI` (Superset on g6 → Postgres on S1).
| `OFFGRID_TOOL_EGRESS` | _(unset → OFF)_ | **Composable-tool air-gap master switch (task #117).** The built-in internet-reaching tool PRIMITIVES (`web_search`, `read_url`, `http_fetch`) are OFF by default — the on-prem "nothing leaves the network" default. Set truthy (`1`/`true`/`yes`/`on`) to opt the whole org IN to every internet primitive. Per-tool opt-in below overrides per primitive. Gated purely in `src/lib/tool-primitives.ts` (`isPrimitiveEnabled`). |
| `OFFGRID_TOOL_WEB_SEARCH` | _(unset → OFF)_ | Per-tool opt-in for the `web_search` primitive only (no need for the master flag). Requires `OFFGRID_WEB_SEARCH_URL` to point at an org-run search endpoint (e.g. SearXNG) so egress stays through a controlled proxy. |
| `OFFGRID_TOOL_READ_URL` | _(unset → OFF)_ | Per-tool opt-in for the `read_url` primitive only. |
| `OFFGRID_TOOL_HTTP_FETCH` | _(unset → OFF)_ | Per-tool opt-in for the `http_fetch` primitive only. |
| `OFFGRID_WEB_SEARCH_URL` | _(unset)_ | The search endpoint `web_search` calls (JSON `?q=…&format=json`, e.g. an org-run SearXNG). Required when `web_search` is enabled; without it `web_search` degrades honestly to a "not configured" error. |
| `OFFGRID_WEBSEARCH_URL` | _(unset)_ | **Governed web-search provider adapter (§14 Exa/Tavily parity).** The pluggable search API endpoint the `governedWebSearch` seam (`src/lib/adapters/web-search.ts`) calls — SearXNG, a Tavily/Exa-compatible proxy, or any HTTP search API returning a JSON result list (`results`/`data`/`items`). Required when `web_search` is enabled through this seam; unset ⇒ honest `not_configured` (never fabricated results). The reach is gated by the air-gap opt-in above AND the pipeline egress leash (external egress refused when a bound pipeline is local-only/blocked). |
| `OFFGRID_WEBSEARCH_KEY` | _(unset)_ | Optional bearer/API key for `OFFGRID_WEBSEARCH_URL` (sent as `Authorization: Bearer …`). **Never commit real keys.** |
| `OFFGRID_WEBSEARCH_METHOD` | `GET` | Request method for the search provider — `GET` (query in the URL) or `POST` (query in a JSON body: `{query,q,count,max_results}`). |
| `OFFGRID_CLOUD_OPENAI_API_KEY` | _(unset → provider not wired)_ | **Cloud model routing (gap #26, Phase D).** API key for OpenAI. When set, requests a routing rule sends to `cloud` AND the org egress switch is ON reach OpenAI via the OpenAI-compatible contract. No key ⇒ provider not configured ⇒ cloud routes fall back to local (honest degradation, never a fabricated cloud answer). **Never commit real keys.** |
| `OFFGRID_CLOUD_OPENAI_BASE_URL` | `https://api.openai.com/v1` | Optional override of the OpenAI base URL (e.g. Azure OpenAI-compatible). |
| `OFFGRID_CLOUD_OPENAI_MODEL` | `gpt-4o-mini` | Default upstream model when a rule routes to `openai` without naming a model. |
| `OFFGRID_CLOUD_ANTHROPIC_API_KEY` | _(unset → provider not wired)_ | API key for Anthropic (via its OpenAI-compatible `/v1` endpoint). Same gating as OpenAI above. |
| `OFFGRID_CLOUD_ANTHROPIC_BASE_URL` | `https://api.anthropic.com/v1` | Optional Anthropic base-URL override. |
| `OFFGRID_CLOUD_ANTHROPIC_MODEL` | `claude-3-5-haiku-latest` | Default upstream model for the `anthropic` provider. |
| `OFFGRID_CLOUD_COMPAT_BASE_URL` | _(unset → provider not wired)_ | Base URL of a generic OpenAI-compatible endpoint (vLLM, OpenRouter, a self-hosted cloud). REQUIRED for the `compat` provider (no well-known default). |
| `OFFGRID_CLOUD_COMPAT_API_KEY` | _(unset)_ | API key for the generic compat provider. Both URL + key needed to wire it. |
| `OFFGRID_CLOUD_COMPAT_MODEL` | _(unset)_ | Default upstream model for the `compat` provider. |

> **⚠️ Console can't egress to the LAN (root cause of every S2 "unreachable"/Langfuse "fetch
> failed"):** the `next-server` process gets `EHOSTUNREACH` connecting to any `192.168.1.x` host,
> while `curl` and short-lived `node` from the SAME box reach S2 fine, and localhost always works.
> This is macOS 15 (Darwin 25) **Local Network privacy** blocking the SSH-launched daemon; there's
> no GUI to grant it. **Fix (in `deploy/Caddyfile`):** Caddy (launchd, not blocked — it already
> proxies provit→S2) fronts each S2 HTTP service on a loopback port; the console's `OFFGRID_*_URL`
> point at `127.0.0.1:893x`. Map: 8931→langfuse:3030, 8932→unleash:4242, 8933→superset:8088,
> 8934→fleet:8070. Redis (`:6379`, non-HTTP) can't be Caddy-proxied → the cache adapter falls back
> to in-memory by design (non-fatal); add a TCP forward if a shared cache is actually needed.

> **Reachability note (2026-07-03):** all S2 services (Langfuse, Unleash, Superset, Redis, Fleet,
> Presidio) are Up and reachable from S1 **by hostname** `offgrid-s2.local`. The Integrations
> "unreachable" alarms were stale/mispointed env (post-migration the old `192.168.1.60` IP and
> `127.0.0.1` were wrong) — NOT undeployed services. Qdrant `:6333` + Evidently `:8001` genuinely
> run on S1 (`127.0.0.1` correct). Always use hostnames, never IPs (DHCP reassigns).

After editing `.env.local`, restart the console (see DEPLOY.md).

## DB tables created directly (not via drizzle migrate)

Created with the `pg` client because `drizzle-kit push` hangs over SSH. **TODO: add proper
drizzle migrations** (`drizzle/000X_*.sql`) so a migrate-based deploy reproduces them:
`studio_templates`, `config_settings`, `config_audit`, `gateway_client_tokens`,
**`fleet_nodes`** (2026-07-05 — the gateway SSOT; seeded with the 9 live nodes),
**`gateways`** (2026-07-08 — Gateways × Pipelines P1: the registry of model-serving endpoints a
pipeline runs on. Applied live via `deploy/onprem/2026-gateways.sql`; ALSO self-creates via
`ensureGatewaysSchema()` in `src/lib/gateways.ts`. Seeded with the 4 sample gateways — On-Prem
Cluster / OpenAI / Anthropic / OpenRouter — for org `default` AND `org_bharat` (stable ids
`gw_seed_<org>_<key>`, `ON CONFLICT DO NOTHING`). `egress_class` derived from `kind`
(on-prem⇒on-prem, cloud kinds⇒cloud). Availability is NOT stored — merged live from the aggregator
+ cloud-providers probe at read time),
**`pipelines`** + **`pipeline_versions`** (2026-07-08 — Gateways × Pipelines, the PIPELINE tier: the
reusable, GOVERNED model-access contract that binds a gateway, fixes a HARD data allowlist ceiling,
carries routing/egress leash + policy/guardrail overlays, and is consumed by apps/agents/chat.
`pipelines` holds the live config + a `version` int + `status` (draft|published|archived);
`pipeline_versions` is the append-only immutable snapshot per publish/edit. Applied live via
`deploy/onprem/2026-pipelines.sql`; ALSO self-creates via `ensurePipelinesSchema()` in
`src/lib/pipelines.ts` (CREATE TABLE IF NOT EXISTS + ALTER ADD COLUMN IF NOT EXISTS). Seeded with 6
sample Indian-BFSI templates — Reimbursement Governance / Motor-Claim FNOL / Loan Underwriting / KYC
Verification / Fraud Screening / Cross-Sell Advisor — for org `default` AND `org_bharat` (stable ids
`pl_seed_<org>_<key>`, `ON CONFLICT DO NOTHING`), each bound to that org's seeded on-prem gateway.
Seed both via `POST /api/v1/admin/gateways/seed` then `POST /api/v1/admin/pipelines/seed`).
DDL for each is in `src/db/schema.ts`; the create statements used are in git history / DEPLOY.md.

Self-creating tables (via `CREATE TABLE IF NOT EXISTS` on first use — no manual/migration step, deploy over SSH just works): `guardrails_rules`, and (2026-07-05, DEEP Presidio guardrails) **`presidio_recognizers`** (org-scoped custom recognizers: regex-pattern + context words, or deny-list terms — pushed to Presidio `/analyze` as `ad_hoc_recognizers`) and **`presidio_thresholds`** (per-org global + per-entity `score_threshold`). DDL in `src/lib/presidio-recognizers.ts` (`ensureRecognizersSchema`).

**Self-healing additive columns (2026-07-06, hardening wave 2 / TASK #139)** — added by `ensureOrgSchema()` in `src/lib/store.ts` on first use (idempotent `ADD COLUMN IF NOT EXISTS`, so a normal deploy applies them with no migration step). If you want to apply them eagerly on the server via psql (`docker exec -i <pg> psql -U offgrid -d offgrid`):

```sql
-- Tenant-scope ingest jobs (was a cross-tenant leak: listIngestJobs was global).
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
-- Random per-device data-plane secret (replaces the predictable dt_<id>). Nullable: devices
-- enrolled before this fall back to the legacy dt_<id> form until they re-enroll.
ALTER TABLE devices     ADD COLUMN IF NOT EXISTS token  text;
```

**Re-enroll note:** devices enrolled BEFORE this deploy have `token = NULL` and keep authenticating with the legacy `dt_<id>` bearer (backward-tolerant — see `src/lib/device-token.ts`). New enrollments get a random secret returned ONCE at `POST /api/v1/devices/enroll` (`deviceToken` field). To close the legacy form on an existing node, re-enroll it (issue a fresh enrollment token, enroll again) so its row gets a random `token`.

**Burndown deploy (2026-07-09, main @ `85ca60b`)** — the (B)-tier OPEN_ITEMS burndown was deployed over the cloudflared tunnel (server-built on node22, console + all 3 workers restarted). Two DB changes were applied directly via the `pg` client (both ALSO self-migrate on first use — `ensureErasureTombstoneSchema()` / `ensureConnectorSecretRefColumn()` — so a normal deploy applies them with no manual step; applied eagerly here to be safe):

```sql
-- DSAR / right-to-erasure device-replica propagation queue (src/lib/erasure-tombstone-store.ts).
CREATE TABLE IF NOT EXISTS erasure_tombstones (
  id text PRIMARY KEY, org_id text NOT NULL DEFAULT 'default', subject text NOT NULL,
  status text NOT NULL DEFAULT 'pending', requested_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz);
CREATE INDEX IF NOT EXISTS erasure_tombstones_org_idx ON erasure_tombstones (org_id);
CREATE INDEX IF NOT EXISTS erasure_tombstones_status_idx ON erasure_tombstones (status);
-- Vaulted connector-credential reference (insurer-connector-creds-vault): secret lives in OpenBao,
-- the DB endpoint column no longer carries the password (src/lib/store.ts, connector-secrets.ts).
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS secret_ref text;
```

**Worker restart is required on any deploy that touches a run path** (`agent-run`/`app-run`/`chat` activities) — `next start` reload alone does NOT reload the Temporal workers. They are launchd-managed on S1; restart with:

```sh
UID_=$(id -u); for w in agent-worker app-worker chat-worker; do launchctl kickstart -k gui/$UID_/co.getoffgridai.$w; done
```

Still pending on S2 (separate infra step): the **Great Expectations sidecar rebuild** (G-F4) — the console adapter is deployed and will report the real engine once the S2 GE container is rebuilt from `deploy/sidecars/great-expectations/` (native evaluator by default; GE lib opt-in).

**insurer demo tenant — "Suraksha Life" (2026-07-09, #207 foundation).** A fictional Indian LIFE INSURER tenant for the insurer use cases (NOT the literal Suraksha brand, per founder). Applied to the console DB (`offgrid_console`) idempotently via the pg client: **tenant** `org_suraksha` (name "Suraksha Life", slug `suraksha`, plan enterprise) + **3 connectors** (`surcon_coreins` Postgres, `surcon_policyadmin` MySQL, `surcon_warehouse` S3) + **12 data-domains** (policies/premiums/claims/advisors/kyc + insurer tools). Emitter: `node deploy/onprem/seed-suraksha-console.mjs | <pg client>` (source of truth: `src/lib/suraksha-tenant-seed.ts`). Also applied defensive `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slug text / plan text / enabled_modules jsonb` (idempotent). **Source data — DONE (2026-07-09).** Suraksha gets its OWN isolated databases on the SAME shared source servers as bharatunion (DB-level isolation, no row collision):
- **Postgres `suraksha`** on the corebank server (`127.0.0.1:5433`, corebank superuser): policies(600), premiums(2140), claims(220), claim_documents(400), kyc_documents(300, PAN/Aadhaar-masked), pricing_rfq(120), pricing_rate_card(20), helpdesk_cases(300), competitor_products(80).
- **MySQL `suraksha`** on the policyadmin server (`127.0.0.1:3307`): advisors(250), employee_quota(500), job_requisitions(8), candidates(126). NOTE: the `policyadmin` app user can't `CREATE DATABASE` — the `suraksha` schema was created as MySQL **root** (`root`/`policyadmin`) + `GRANT ALL ON suraksha.* TO 'policyadmin'@'%'`, then the seed (which connects as policyadmin) succeeds. Re-running the seed is idempotent.
- Seed script: `node deploy/onprem/seed-suraksha-dataplane.mjs` (env defaults hit the loopback ports). Connectors reconciled via `deploy/onprem/reconcile-suraksha-connectors.sql` (pg client → offgrid_console): `surcon_coreins → …:5433/suraksha`, `surcon_policyadmin → …:3307/suraksha`, + added the `reimbursement quota → employee_quota` domain. Verified: data reads back through the connector path, insurer-flavored (ULIP policies, INR, PAN, Indian names).

The 15 insurer use cases are built one-at-a-time (founder loop: auto-test end-to-end, then founder runs it manually via `/build/studio/new`), in the Suraksha tenant, easiest-first (reimbursement → pension insights → competitive intel → …).

### Gateway fleet SSOT (2026-07-05) — how it's wired
`fleet_nodes` is the single source of truth for the on-prem fleet. Flow + gotchas:
- **Console** `GET /api/v1/gateway/pool` derives the aggregator POOL/IMAGE_POOL from the table;
  `PATCH /api/v1/gateway/fleet/[name]` edits a node (validated) + pushes model/ctx to the node.
  Editor UI: AI Gateway → **Control** tab (`GatewayFleetConfig`).
- **Aggregator** (`scripts/gateway-aggregator.mjs`) fetches `/pool` on startup + every 30s with a
  **hardcoded fallback** (routing can't drop if console/DB is down). `OFFGRID_POOL` env still pins.
  - **`GET /config` (read-only tuning):** exposes the aggregator's live runtime knobs — routing
    refresh interval, health thresholds (`OFFGRID_HEALTH_*`), upstream timeouts (`OFFGRID_GATEWAY_/
    IMAGE_UPSTREAM_TIMEOUT_MS`), pool/fallback counts — plus honest capability flags (no response
    cache, no per-request fallback chain, no live-reconfigure; rate-limit is Caddy's). All knobs are
    env-set in the aggregator plist → **restart (`launchctl kickstart`) to change.** Console reads it
    at `GET /api/v1/gateway/config` → AI Gateway → **Tuning** tab. No secrets in the payload.
  - **/pool auth:** aggregator MUST send `Authorization: Bearer <key>` (the console middleware only
    lets `/api/*` through with a Bearer header; `x-api-key` alone → 401 at middleware). /pool itself
    is gate-less (read-only topology, behind the tunnel's Keycloak gate).
  - **push-to-node:** `POST /nodes/:name` on the aggregator SSHes to the node (`activate` = write
    active-model.json incl. `ctx` + kickstart; `restart`; `enable/disable` = adopt SSOT). The aggregator
    launchd job has **no HOME**, so ssh needs an explicit `-i /Users/admin/.ssh/id_ed25519` +
    `UserKnownHostsFile` (else "publickey denied"). Override via `OFFGRID_SSH_KEY`.
- **Deploy caveat:** after adding/removing a route, `next build` can serve a STALE compiled route —
  do `rm -rf .next && next build` (clean) and verify BOTH `.next/server/middleware-manifest.json`
  and `pages-manifest.json` exist before restart.

## Native launchd services (S1)

Long-running native Node processes that are NOT in Docker and NOT pm2 — owned by launchd so they
survive reboot/crash.

- **`co.getoffgridai.landing`** — the **console landing page** (`console-landing-page` repo), native
  `next start -p 3100`. Added 2026-07-07. Plist source of truth:
  `console-landing-page/deploy/onprem/co.getoffgridai.landing.plist` (installed to
  `/Library/LaunchDaemons/`). Server dir `/Users/admin/offgrid/console-landing-page`; log
  `/tmp/offgrid-landing.log`. Fronted by the edge Caddy (`console-landing.getoffgridai.co`,
  `import gated` → `127.0.0.1:3100`) → cloudflared. Deploy: `console-landing-page/deploy/push.sh`
  (rsync source → `npm install` + `next build` on the box → `launchctl kickstart -k
  system/co.getoffgridai.landing`). **Gotcha:** the landing has no `@offgrid` file: deps (unlike the
  console), so no shared-monorepo sync is needed. **History:** found DOWN on 2026-07-07 — the fleet
  was *configured* for it (tunnel + Caddy → :3100) but the source/process were absent and nothing
  listened on :3100; redeployed + put under launchd so it stays up. Restart: `sudo launchctl
  kickstart -k system/co.getoffgridai.landing`.
- Note: the **console** itself (`:3000`) still runs as a plain backgrounded `next start` (no launchd),
  restarted by `deploy/push.sh` (pkill + relaunch). The aggregator (`co.getoffgridai.aggregator`),
  edge Caddy (`co.getoffgridai.edge`), app-worker (`co.getoffgridai.app-worker`), and Provit
  (`co.getoffgridai.provit`) are the other launchd jobs.

## Docker containers (S1 OrbStack — daemon already initialised, no GUI first-run)

Data sources — replay with `docker compose -f data-sources.yml up -d` (docker at
`/Users/admin/.orbstack/bin/docker`). Full enterprise stack:
- `offgrid-ds-corebank` — Postgres `:5433`, real data (2.4k customers / 3.8k policies / 1.45k claims / 9.2k txns), seeded by `seed-corebank.sql`. **UP.**
- `offgrid-ds-policyadmin` — MySQL `:3307`, agents/branches/commissions, seeded by `seed-policyadmin.sql`.
- `offgrid-ds-erp` — MSSQL (Azure SQL Edge, ARM) `:1433`, SA pw `Offgrid!Erp2026`.
- `offgrid-ds-kafka` — Redpanda (Kafka) `:19092`, admin `:9644`.
- `offgrid-ds-minio` — S3 warehouse `:9010` (console `:9011`).
- `offgrid-ds-crm` — mock CRM REST `:8090` (json-server over `crm.json`).

> S1's Docker Hub link is flaky — image pulls may need retries; `compose up -d` resumes. Re-run until all six are Up.

### RAGAS eval sidecar — `offgrid-ragas` (S1, added 2026-07-06)

The real ragas library, wrapped in a FastAPI service the console's eval-runner calls. Bound
**loopback-only** `127.0.0.1:8002`. Source + compose in `deploy/onprem/ragas-sidecar/`.
- **Build + run (reproducible):** `cd deploy/onprem/ragas-sidecar && docker compose up -d --build`
  (docker at `/usr/local/bin/docker`; compose is the v2 plugin). `restart: unless-stopped` → survives reboot.
- **Gateway auth (the gotcha):** the sidecar forwards `OFFGRID_GATEWAY_API_KEY` to the aggregator
  (`host.docker.internal:8800`) as a **Bearer** when it runs ragas's judge LLM + embeddings. The
  built-in default `offgrid-local` is **rejected 401** → every eval silently degrades to the
  first-party heuristic. The **real** key lives in `ragas-sidecar/.env` on the server (gitignored;
  same `oglb_…` value as console `.env.local`'s `OFFGRID_GATEWAY_API_KEY`) — compose auto-loads it.
  Replay: `cp .env.example .env`, paste the real key, `docker compose up -d --build`.
- **Container→host:** `extra_hosts: host.docker.internal:host-gateway`; app.py rewrites a loopback
  gateway URL (127.0.0.1) → `host.docker.internal` so it reaches the on-host aggregator.
- **Metric scoping:** the console passes `metrics:[def.metric]` so ragas scores only the ONE metric
  the eval def needs (each metric ≈ 30–90s of gateway calls; all 5 blew past the client timeout).
  Client timeout is 600s. **VERIFIED live 2026-07-06:** faithfulness eval → `computedBy:ragas`,
  score 1.0, gateway 200 OK, 88s — no heuristic fallback.

## Registered connectors (rows in console DB `connectors`)

- `con_corebank` → **Core Banking (Postgres)**, `postgres`, endpoint `postgres://corebank:corebank@127.0.0.1:5433/corebank`. Sync reports **real** row counts (16,850 seeded). Replay:
  ```sql
  INSERT INTO connectors (id,name,type,endpoint,auth,description,custom,status)
  VALUES ('con_corebank','Core Banking (Postgres)','postgres',
    'postgres://corebank:corebank@127.0.0.1:5433/corebank','password',
    'Live core-banking OLTP',false,'connected')
  ON CONFLICT (id) DO UPDATE SET endpoint=EXCLUDED.endpoint;
  ```
- `con_crm` → **Salesforce CRM (mock)**, `rest`, endpoint `http://127.0.0.1:8090/db`. Sync counts real records (13: accounts+opportunities+contacts). Same INSERT pattern, type `rest`.
- `con_warehouse` → **Data Warehouse (MinIO/S3)**, `s3`, endpoint `http://127.0.0.1:9010`, status connected (object-count wiring TBD).
- `con_policyadmin` → **Policy Admin (MySQL)**, `mysql`, `mysql://policyadmin:policyadmin@127.0.0.1:3307/policyadmin`. Real count **6,110** (needs `mysql2` on server — installed; run `ANALYZE TABLE` once so InnoDB stats are accurate).
- `con_kafka` → **Event Stream (Kafka)**, `kafka`, `127.0.0.1:19092` (Redpanda). Status connected (no row-count; stream).
- `con_erp` → **Finance ERP (MSSQL)**, `mssql`, `mssql://sa:Offgrid!Erp2026@127.0.0.1:1433/erp` (Azure SQL Edge). Real count **13,066** rows (erp DB: invoices + gl, seeded via the `mssql` driver from the console since azure-sql-edge ships no sqlcmd). `mssql` + `@types/mssql` added — **`npm install mssql` on the server** (done). All 6 data sources live with real counts on the 3 relational DBs.
- **Removed the seeded/synthetic connectors** `con_core`, `con_dwh` (fake Snowflake), `con_s3` (fake). NOTE: `src/db/seed.ts` still defines these — trim `SEED_CONNECTORS`/`SEED_DATASETS` so a re-seed doesn't reintroduce them.

## Synthetic-data purge (server data ops — done this session)

- Cleared 178 seed-only rows: `audit_events, devices, tenants, api_keys, tools, golden_cases, governance_items, datasets, masking_rules, routing_rules` (all matched seed sizes; each has a real write path). Fleet/Control/Admin/Data now show real/empty.
- Removed the seeded Brain vector table: `rm -rf .lancedb/documents.lance` — recreates empty on next use.
- `seed.ts` + `brain.ts` now gate demo seeding behind `OFFGRID_SEED_DEMO=1` (off by default), so none of this returns.

## Real-data rewires (code, in git)

- **Analytics + FinOps** now compute from the real `offgrid-gateway` OpenSearch index (`gatewayEvents()` in `src/lib/analytics.ts`), NOT seeded Postgres audit. Empty/unreachable → real zeros.
- `mysql2` added to `package.json` — **must `npm install` on the server** (done) for MySQL connector counts; not in the default node_modules.
- *(when policyadmin/erp/kafka are up:)* register MySQL/MSSQL/Kafka connectors — MySQL real counts need the `mysql2` driver (not yet added); MSSQL needs `mssql`; Kafka a topic/lag probe. Until then register as `connected` without live counts.

## DNS (Cloudflare, via API) — replay with `dns-records.sh`

CNAMEs → the tunnel (`…cfargotunnel.com`, proxied): `auth`, `ssh`, `provit`.

**LIVE (Phase 5 — unified API gateway, applied 2026-07-05):** `console-api.getoffgridai.co` is up
end-to-end. Verified: `/openapi.json` + `/docs` → 200, `/v1/models` → 401 (routes to aggregator
:8800), `/specs/<id>` → 401 (routes to the console spec proxy via a `/specs/*`→`/api/v1/specs/*`
rewrite), `/api/v1/status` → 200. What was done:
1. **DNS:** CNAME `console-api` → the tunnel, created via the CF API (token in `mobile/.env.keygen`);
   `console-api` added to `dns-records.sh` NAMES for replay.
2. **Tunnel:** added the `console-api → http://127.0.0.1:80` ingress rule to the LIVE
   `~/.cloudflared/config.yml` (surgical insert before the `http_status:404` catch-all; live config
   differs from the repo copy, so DON'T blind-copy — edit in place), validated with
   `cloudflared --config … tunnel ingress validate` (OK), reloaded with **SIGHUP** (graceful; note
   SIGHUP briefly resets tunnel conns incl. the SSH-over-tunnel session, but routes recover).
3. **Caddy:** the vhost was already on disk (rsync'd); `admin off` in the Caddyfile means no
   API reload — restart via `sudo launchctl kickstart -k system/co.getoffgridai.edge` (brief blip on
   Caddy-fronted routes: gateway/ai/provit/status/landing/console-api; onprem-console/auth/ssh bypass
   Caddy and stay up). `caddy validate --config … --adapter caddyfile` first.
Console-side code (CORS on `/api/v1/*` bearer-only + the in-app `/api/v1/specs/<id>` proxy) was
already deployed.

## Network migration (2026-07-03) — fleet moved to Airtel_Wednesday (fast net)

The whole fleet was on `Airtel_Wednesday_2` (~190 KB/s WAN — WiFi backhaul cap). Migrated all
10 machines to **`Airtel_Wednesday`** (pw `Wednesdaysol@25`) → ~3 MB/s (15×+). Method: staged a
self-healing `networksetup` switch on every machine via S1, coordinated timed flip; the
Cloudflare tunnel survived S1's move (it dials outbound). **Reach nodes by mDNS hostname
`offgrid-gN.local` / `offgrid-s2.local` — NOT by IP** (DHCP reassigned everything).

New IPs (do not hardcode — use hostnames): S1 `.85`, S2 `.84`, g1 `.82`, g2 `.83`, g3 `.86`,
g4 `.89`, g5 `.90`, g6 `.88`, g7 `.91`, g8 `.87`. All config now uses hostnames/127.0.0.1
(aggregator POOL, Caddyfile, console `.env.local`) so a future network change won't break it.

> If a machine won't join: `networksetup -setairportnetwork en0 "Airtel_Wednesday" "Wednesdaysol@25"`.
> `_2` uses the same password. S1's en0 is Wi-Fi (macOS 15 misreports "not associated").

## Network — SSID PARTITION discovered (2026-07-05)

**The fleet is split across two client-isolated SSIDs — g1/g8 are NOT down, they're partitioned.**
Guarded hop on g6 (`hop-probe.sh`: switch en0 to `Airtel_Wednesday`, probe, ARP-sweep, restore to
`_2`, all detached/self-restoring) proved:
- On `Airtel_Wednesday`, g6 got `.93` and **reached `offgrid-g1.local` AND `offgrid-g8.local`** — both
  ALIVE. `offgrid-s2.local` unreachable on both SSIDs = **S2 is the only truly-down node.**
- **The two SSIDs are separate L2 segments** (client isolation): router MAC is `a0:91:ca:37:1e:d1` on
  `Airtel_Wednesday` vs `a0:91:ca:96:79:a0` on `_2`. So S1 (on `_2`) and its aggregator **cannot reach
  g1/g8** even though they're up — that's why they looked "offline/unresolvable."
- **`Airtel_Wednesday` IS broadcasting again** (contradicts the 2026-07-04 "not broadcasting" note below).
  Nodes prefer it at index 0 but don't roam until they drop `_2`, so g2–g7 stayed on `_2` while g1/g8
  are on `Airtel_Wednesday`.
- **Live count: 9 of 10 up** (7 on `_2`: S1,g2,g3,g4,g5,g6,g7 · 2 on `Airtel_Wednesday`: g1,g8), S2 down.
- **Impact:** g1's qwythos is alive but unusable (aggregator can't route to it) → qwythos still has 0
  *reachable* nodes. **Fix = un-partition:** move g1/g8 onto `_2` (they'll re-prefer `Airtel_Wednesday`
  on reconnect unless index-0 is changed), OR consolidate everyone on one SSID, OR disable AP client
  isolation on the router (`.1`). Reachable meanwhile only via a g6-style hop (probe path, not serving).

## Network stability — learnings (2026-07-04, after a router reboot)

A router/AP reboot (~23:29 on 2026-07-03) re-DHCP'd the whole fleet again (S1 `.85`→`.59`; nodes
got fresh IPs) — same router (`.1`, MAC `a0:91:ca:96:79:a0`), same `/24`. Confirmed **not a hack**
(clean login/process/port/persistence sweep; only extra launchd is your `AdGuardHome`). Learnings:
- **`Airtel_Wednesday` and `_2` are two SSIDs on the SAME `192.168.1.0/24`** (same router), not
  separate subnets. A probe node hopped `_1`→`_2` and stayed on `192.168.1.x`.
- **Root cause of the recurring drift:** `Airtel_Wednesday_2` was the **top preferred network** on
  every machine, so on any reconnect macOS re-joined `_2` first. **Fixed:** promoted
  `Airtel_Wednesday` to preferred index 0 on all 8 reachable machines (S1 + g1–g7) via
  `networksetup -removepreferredwirelessnetwork` + `-addpreferredwirelessnetworkatindex … 0 WPA2 …`.
  NOTE: `networksetup` needs **no sudo** for this (works as `admin`); g7's `networksetup` **crashes
  (SIGABRT)** — corrupt wifi prefs, needs a reboot/on-site.
- **`Airtel_Wednesday` (fast SSID) intermittently stops broadcasting** — after this reboot every node
  reported "Could not find network Airtel_Wednesday" and ran on `_2`. Reorder is dormant until it returns.
  - **Re-checked 2026-07-04:** STILL down. Guarded switch test on g5 → `Could not find network
    Airtel_Wednesday` again; g5 unharmed (stayed on `_2`, IP `.65`, reachable). `_2` WAN ~100 KB/s
    (momentary 1 B/s stalls — flaky). `Airtel_Wednesday` is preferred **index 0** on nodes, so the
    fleet AUTO-migrates the instant its AP rebroadcasts; g4's VL download is resumable so it just
    accelerates mid-stream. **On-site action needed: power-cycle the `Airtel_Wednesday` AP** — cannot
    force an AP to broadcast remotely.
- **S2 and g8 went offline** and did NOT rejoin (powered off / wifi off). Proven unreachable by
  scanning the live subnet from *inside* it (probe node) — not on `_2`, not anywhere. **Cannot be
  revived remotely** (no network path to run `networksetup` on them); needs physical/console access.
  The g8 loss killed an in-flight model download. Only ~11 live hosts on the whole `/24` (fleet + router).

## Fleet role assignment (updated 2026-07-05) — 6 GW + 2 servers

Topology is **6 GW + 2 servers** (S1 control plane + g6 aux tier). A brief 2026-07-05 detour to make
g5 a "server #3" for OpenSearch/Marquez/OpenBao was **abandoned** — those services were already running
on S1 (the `offgrid-services-a` stack), so no 3rd server is needed. **g5 was restored to the GW pool.**
The heavy backend trio lives on S1; the console reaches it over 127.0.0.1 (see the node-c note below).

| Machine | Role | State |
|---|---|---|
| S1 | server #1 (control plane + `offgrid-services-a`/`-extra`: OpenSearch, Marquez, OpenBao, OPA, Qdrant, Temporal, SeaweedFS…) | ✅ up |
| **g6** | **server #2 (aux tier — Langfuse/Unleash/Superset/Fleet/Presidio)** | ✅ provisioned 2026-07-05 (Docker 29.5.2); MAXED 15.5/16 GB |
| g5 | GW — gemma-4-e4b | ✅ serving (restored to pool 2026-07-05 after the abandoned node-c detour) |
| g1 | GW — qwythos-9b | ✅ RECLAIMED to `_2` (2026-07-05, IP .57) — qwythos routes again |
| g2 | GW — gemma-4-e4b | ✅ serving |
| g3 | **IMAGE-ONLY** — juggernaut-xl-v9 (:1234). gemma :7878 gateway booted-out+disabled (2026-07-05) | ✅ serving image |
| g4 | GW — **qwen3-vl-8b** | ✅ serving VL (2026-07-05) |
| g7 | GW — **qwen3-vl-8b** | ✅ serving VL (2026-07-05) |
| S2 | (old aux server) | ❌ offline since router reboot — unresolvable, needs on-site/network |
| g8 | (spare) | ✅ RECLAIMED to `_2` (2026-07-05, IP .64) — held as spare, POOL `enabled:false` (UI-Venus not needed) |

**GW bring-up (2026-07-04):** all 6 reachable GWs brought online with ZERO downloads by
pointing each node's `~/.offgrid/models/active-model.json` at a model already on disk and
`launchctl kickstart`-ing `co.getoffgridai.gateway`:
- g4 had a complete gemma but its active-model pointed at an absent qwythos → repointed to gemma.
- g7 had a complete qwythos present → repointed active-model to it (its UI-Venus is gibberish).
- g3 had a complete gemma → brought up on gemma (its juggernaut is an unverified Q4_K quant; the
  image role waits for a verified Q8_0).
Aggregator `POOL` (in `scripts/gateway-aggregator.mjs`, committed) updated to match: 6 chat nodes,
`g6`+`g8` set `enabled:false` (g6=server, g8=offline) so `pick()` stops 502-ing on them. Verified:
gemma round-robins g3/g4/g5, qwythos hits g1/g7, `gateway.getoffgridai.co/health`=200.
Image (g3) + VL (g4/g7) roles restore once verified quants land — flip `kind`+`model` back then.

**g6-as-server is BLOCKED remotely:** g6 has NO OrbStack installed (not even the .app),
and the aux tier (Langfuse/Unleash/Superset/Fleet/Presidio via `services-node-b.yml`) is all
Docker. Installing+initializing OrbStack needs the on-site GUI first-run + privileged-helper
approval (same wall as g4). **Fastest real recovery of the aux tier is to WAKE S2 on-site** (it
already has the whole tier installed & configured — just needs to rejoin wifi), not rebuild g6.
Until on-site: aux tier down; g6 held as the server slot (out of the GW inference pool).

**Finalized node model plan (2026-07-04, confirmed with owner):**
`2× Qwen3-VL-8B-Instruct` (g4,g7) · `2× gemma-4-e4b` (g2,g5) · `1× image juggernaut` (g3) ·
`1× qwythos-9b` (g1). No sub-9B qwythos exists (every HF release is 9B) → g1 stays 9B.
- **VL model = `Qwen/Qwen3-VL-8B-Instruct-GGUF`** → `Qwen3VL-8B-Instruct-Q4_K_M.gguf` (5.03 GB)
  + `mmproj-Qwen3VL-8B-Instruct-F16.gguf` (1.16 GB). **✅ Download COMPLETE on g4 (2026-07-04 18:53)**
  — `Qwen3VL-8B-Instruct-Q4_K_M.gguf` (4.7 GB) + `mmproj-Qwen3VL-8B-Instruct-F16.gguf` (1.1 GB) on disk,
  marker `~/vl-dl.done` set (log `~/vl-dl.log`). The one internet pull is done.
  **LAN-copy g4→g7 (2026-07-04 ~23:47):** g4↔g7 have no direct key auth, so routed **through S1**
  (S1 has passwordless SSH to both): rsync g4→S1 stage → S1→g7, resumable `--partial`. Script
  `~/vl-copy.sh` on S1 (log `~/vl-copy.log`, marker `~/vl-copy.done`, staging `~/vl-stage`).
  **✅ DONE (2026-07-05):** copy landed, g7's `active-model.json` flipped to VL + kickstarted; **both
  g4 and g7 now serve `Qwen3VL-8B-Instruct-Q4_K_M.gguf` live** ("Vision server ready", :7878=200,
  quant VERIFIED to load — answers the old "does it run" question). Aggregator POOL updated (g4,g7
  → `model:'qwen3-vl-8b'`) AND `pick()` fixed: the new tag contains "qwen", which the legacy
  `qwen→gemma` rule was catching → added a `vl` rule (text + vision-input) BEFORE it, so VL routes
  to g4/g7. Aggregator restarted (sudo kickstart). Verified: `qwen3-vl-8b` requests land on VL nodes,
  `gemma-4-e4b` still lands on gemma. **NOTE: qwythos now has ZERO live nodes** (g7 was its last
  reachable one; g1 offline) — qwythos requests will 502 until g1 returns.
- **Image model = `offgrid-ai/juggernaut-xl-v9-GGUF`** → g3 has `juggernaut-xl-v9-Q4_K.gguf` (2.8 GB).
  **✅ WIRED + WORKING (2026-07-05):** end-to-end image gen verified through the aggregator (real
  512×512 PNG returned, ~255 KB b64). Pieces:
  - **g3 launchd `co.getoffgridai.sdserver`** (gui domain, `RunAtLoad`+`KeepAlive`) runs `sd-server`
    on **`0.0.0.0:1234`** — MUST bind 0.0.0.0, not 127.0.0.1 (the aggregator on S1 connects over the
    LAN at `offgrid-g3.local:1234`; 127.0.0.1 → aggregator returns `image gateway g3 error:` empty msg).
    Plist committed at `deploy/onprem/co.getoffgridai.sdserver.plist`; load with
    `launchctl bootstrap gui/$(id -u) <plist>`. Log `~/sd-server.log`. sd-server is OpenAI-compatible
    (`POST /v1/images/generations` → `{data:[{b64_json}]}`), so it's a straight proxy, no translation.
  - **Aggregator** (`scripts/gateway-aggregator.mjs`): `IMAGE_POOL` (`[{g3, offgrid-g3.local:1234,
    juggernaut-xl-v9}]`, override via `OFFGRID_IMAGE_POOL`), a `/v1/images/*` proxy route (rrPick over
    `IMAGE_LIVE`, logs `kind:'image'`), `image_models` surfaced in `/` + `/v1/models`.
  - **g3 is DUAL-ROLE:** still serves gemma chat on :7878 AND image on :1234 (kept gemma to preserve
    chat capacity while g1/qwythos is down). To make g3 image-only later, disable its chat POOL entry.
  - Gotcha: `launchctl bootout` is async — sleep + verify it's gone before `bootstrap`, else error 5 (EIO).
- **Network:** ~230–270 KB/s — fleet stuck on slow `Airtel_Wednesday_2` SSID
(fast SSID not broadcasting); ~5GB model ≈ 6h/node until the fast AP returns.

## HA plan — repurpose 2 GWs → servers (6 GW + 2 servers)

The fleet has 8 GW nodes; dropping 2 for HA/aux (leaves 6 for inference). Decided target:
**6 GW + 2 servers** (S1 + one repurposed node as the aux/S2-replacement).
- Candidate repurpose nodes: the **image nodes g3/g4** (image-gen not yet working) are the least-critical.
- **OrbStack headless init — ✅ SOLVED (2026-07-05): a bare node CAN be provisioned fully headless.**
  The old "create_vm stalls / admin-GUI-gated" blocker is broken. Exact recipe (used to provision g6):
  1. **Copy `OrbStack.app` from a node that has it** (g4 has it; g5 does NOT) over the **LAN** via
     `tar czf - -C /Applications OrbStack.app | ssh <target> 'tar xzf - -C /Applications'` — bsdtar
     preserves the code signature (verify: `codesign -v` → "satisfies its Designated Requirement").
     Do NOT internet-download it on `_2` (~100 KB/s → hours). Do NOT `rsync -X` (macOS openrsync
     rejects `-X`).
  2. **Copy the privileged helper + its LaunchDaemon** from the same source node:
     `/Library/PrivilegedHelperTools/dev.orbstack.OrbStack.privhelper` (world-readable) and
     `/Library/LaunchDaemons/dev.orbstack.OrbStack.privhelper.plist`. Place them on the target with
     `sudo` (boxes are `admin`/**`1234`** → `echo 1234 | sudo -S ...`), `chown root:wheel`,
     `chmod 755`/`644`, then `sudo launchctl bootstrap system <plist>`. Signature validates (same
     TeamID `HUAQ24HBR6`), so it registers. State shows `not running` = fine (on-demand Mach service).
  3. **`open -a OrbStack`** (rc=0) then the engine self-inits — **docker up in ~5s** (`orbctl start`
     may print "timed out" but docker comes up anyway). docker at
     `/Applications/OrbStack.app/Contents/MacOS/xbin/docker`, `docker compose` = plugin (v5.3.0).
  So the owner was right: **once app+helper are in place, OrbStack comes up on its own headlessly.**
- **Do NOT cram the heavy aux tier onto S1** — S1 is the sole tunnel-anchored control plane; OOMing it
  loses everything. Provit (lightweight Node, no Docker) is the exception and belongs on S1.
- **2-server distribution — IN PROGRESS on g6 (2026-07-05):** S1 runs the full container stack
  (console/Keycloak/Postgres + data-sources + services-a + services-extra). **g6 is now server #2:**
  provisioned OrbStack headless (recipe above), **Docker 29.5.2 up**. `services-node-b.yml` copied to
  `~/services-node-b.yml` on g6 (self-contained — all env inline, NO external .env/secrets needed) and
  **`docker compose up -d` is PULLING the ~15 aux images** (log `~/aux-up.log`) — slow over `_2`, runs
  detached. **REMAINING once pulled:** (1) verify all aux containers healthy on g6; (2) repoint the
  console's S2→loopback Caddy proxies from S2 to **g6**: edit `deploy/Caddyfile` so 8931→
  `offgrid-g6.local:3030` (langfuse), 8932→`:4242` (unleash), 8933→`:8088` (superset), 8934→`:8070`
  (fleet), reload Caddy; Redis (`:6379`, non-HTTP) needs a TCP forward or stays in-memory fallback.
  S2 no longer required — g6 replaces it. Note: g6 was `enabled:false` in the aggregator POOL (server,
  not a GW) — keep it that way.
- **Data plane provisioned on S2 — LIVE (2026-07-08).** S2 (`192.168.1.60`, 16GB M1) rejoined the
  LAN; OrbStack + privileged helper were already installed (docker daemon up, Docker 29.4.0). On
  reboot S2 had auto-restarted its old `offgrid-services-b` aux tier — **redundant with g6** (the
  canonical copy the console points at), so it was **stopped** (`docker stop`, volumes kept; load
  fell 12→5, ~12GB freed). Then brought up the four data-plane profiles from
  `~/offgrid/console/deploy/docker-compose.yml` (orb PATH `/Applications/OrbStack.app/Contents/MacOS/xbin`):
  - `warehouse-clickhouse` `:8124/:9001` (creds warehouse/warehouse) — verified `SELECT version()`=24.8.14.39.
  - `redpanda` `:19092/:9644/:18083` — `rpk cluster health` Healthy:true.
  - `great-expectations` `:8003` — `{"status":"ok"}` (fallback stub engine).
  - 6× `airbyte-*` `:8005/:8006` — **crashloop FIXED (2026-07-08)** by aligning the hand-rolled
    0.63.15 compose to airbyte's official env matrix. Fixes (all in `deploy/docker-compose.yml`, etl
    profile): (1) added **`airbyte-bootloader`** (Flyway migrations; server/worker wait on it via
    `service_completed_successfully`); (2) **temporal** now mounts `./airbyte/temporal/dynamicconfig`
    at `/etc/temporal/config/dynamicconfig` with `DYNAMIC_CONFIG_FILE_PATH=…/development.yaml` (was the
    non-existent `development-sql.yaml`) + `DB=postgresql`; (3) shared `x-airbyte-env` anchor (top-level,
    not under `services:`) with the full DATABASE_*/CONFIG_DATABASE_*/INTERNAL_API_HOST/WORKLOAD_API_HOST/
    STORAGE_TYPE=LOCAL + STORAGE_BUCKET_* / MICRONAUT_ENVIRONMENTS=control-plane matrix; (4) **server +
    worker only** get `SECRET_PERSISTENCE=TESTING_CONFIG_DB_TABLE` **and** `JAVA_OPTS` defining the
    hyphenated `datasources.local-secrets.*` Hikari datasource (env vars can't express the hyphen —
    they bind to a broken `local` datasource); bootloader deliberately stays on the NO_OP default (it
    crashes with TESTING_CONFIG_DB_TABLE); (5) **webapp** env is `AIRBYTE_SERVER_HOST=airbyte-server:8001`
    + `CONNECTOR_BUILDER_API_HOST` + `KEYCLOAK_INTERNAL_HOST=localhost` (its nginx template interpolates
    those, NOT `INTERNAL_API_HOST`) and its **port map is `8006:8080`** (the 0.63.15 nginx listens on
    8080, not 80 — with `8006:80` the UI was unreachable / edge loopback 502'd); (6) `JDK_JAVA_OPTIONS`
    (NOT `JAVA_OPTS`) carries the local-secrets `-D` props so the JVM APPENDS them — `JAVA_OPTS` would
    REPLACE the image defaults and break the server's Flyway property resolution; (7) added
    `CONFIGS/JOBS_DATABASE_MINIMUM_FLYWAY_MIGRATION_VERSION` (0.40.23.002 / 0.40.26.001). New file:
    `deploy/airbyte/temporal/dynamicconfig/development.yaml` (canonical airbyte content).
    VERIFIED 2026-07-08: all 6 airbyte-* Up, RestartCount=0 (server/worker/webapp/temporal/builder/db),
    bootloader Exited(0); `:8005/api/v1/health`→`{"available":true}`, `:8006/`→200, S1 loopback
    `127.0.0.1:8942`→200.
  **S1 wiring:** added edge-Caddy loopbacks `127.0.0.1:8941→s2:8124`, `8942→:8006`, `8943→:9644`,
  `8944→:8003` (`deploy/Caddyfile`); restarted edge (`sudo pkill -9 -f 'caddy run'` +
  `launchctl kickstart -k system/co.getoffgridai.edge`) — loopbacks verified from S1. Set
  `OFFGRID_WAREHOUSE_URL/_USER/_PASSWORD`, `OFFGRID_AIRBYTE_URL`, `OFFGRID_REDPANDA_ADMIN_URL/_BROKERS`,
  `OFFGRID_DATAQUALITY_URL` in S1 `.env.local`. Console: the four engines registered in
  `src/lib/services-directory.ts` (warehouse/airbyte/streaming/data-quality) → Services-page health.
- **node-c (g5) plan — ABANDONED (2026-07-05), was never needed.** The premise ("OpenSearch/Marquez/
  OpenBao aren't running → provision a 3rd server") was **WRONG**: all three have been running the whole
  time in the **`offgrid-services-a` Docker stack ON S1** (up 4 days — see the S1 container list above).
  `_cat/indices` on S1:9200 showed the real `offgrid-gateway` index (760+ docs — the audit events
  behind Analytics/FinOps); Marquez :9000 answered with a `default` namespace; OpenBao :8200 was
  initialized+unsealed. The actual gap was **console WIRING** (env vars unset), not missing services.
  And because these run on S1 *localhost*, the console reaches them **directly at 127.0.0.1** — no g5,
  no OrbStack, no Caddy loopback proxy needed (Analytics already read `127.0.0.1:9200` fine).
  - **g5 restored to the GW pool** (`PATCH /api/v1/gateway/fleet/g5 {role:'gateway',enabled:true,
    model:'gemma-4-e4b'}`); its llama.cpp :7878 still serves gemma. OrbStack on g5 quit. Topology is
    back to the intended GW count. `deploy/onprem/services-node-c.yml` is kept only as a reference for a
    future standalone aux node; it is **not deployed**.
  - **Wiring applied to the console `.env.local` on S1 (2026-07-05), console restarted (launchd
    `kickstart -k gui/501/co.getoffgridai.console`):**
    `OFFGRID_OPENSEARCH_URL=http://127.0.0.1:9200`, `OFFGRID_MARQUEZ_URL=http://127.0.0.1:9000`,
    `OFFGRID_ADAPTER_LINEAGE=marquez`, `OFFGRID_ADAPTER_SECRETS=openbao`,
    `OFFGRID_OPENBAO_URL=http://127.0.0.1:8200`, `OFFGRID_OPENBAO_TOKEN=offgrid-dev-token`,
    `OFFGRID_SIEM_INDEX=offgrid-audit`. **Verified live:** Secrets page = openbao, reachable, unsealed
    (seeded 3 real secrets under `datasources/`,`gateway/` via KV v2 at mount `secret`); Lineage =
    connected to Marquez `default` ns (empty until runs emit OpenLineage); services-health shows
    opensearch/openbao/marquez/opa/temporal/qdrant/langfuse/unleash all UP.
  - **OpenBao gotcha:** the console adapter (`src/lib/adapters/secrets.ts`) expects a **KV v2 engine at
    mount `secret`** (`OFFGRID_OPENBAO_MOUNT` default `secret`) and the token `offgrid-dev-token` (the
    container's `BAO_DEV_ROOT_TOKEN_ID`, NOT `offgrid-root`). Enable once:
    `curl -H "X-Vault-Token: offgrid-dev-token" -XPOST 127.0.0.1:8200/v1/sys/mounts/secret -d '{"type":"kv","options":{"version":"2"}}'`.
  - **Secrets deep ops (2026-07):** the Secrets page now drives KV v2 versioning/rotation
    (`/api/v1/admin/secrets/versions`), seal/unseal (`/api/v1/admin/secrets/seal`, needs the operator
    unseal key SHARES — the dev container is auto-unsealed so sealing it will require re-unsealing),
    leases (`/api/v1/admin/secrets/leases`, via `sys/leases/lookup|revoke`), and dynamic DB creds
    (`/api/v1/admin/secrets/dynamic-db`). Dynamic DB creds require the **`database` secrets engine**
    enabled + a role configured against a Postgres connection; the mount defaults to `database`,
    override with **`OFFGRID_OPENBAO_DB_MOUNT`**. Until that engine is provisioned the dynamic-DB panel
    shows "no roles / not enabled" (graceful stub). The dev root token has these caps; a scoped token
    in prod needs policy for `sys/seal`, `sys/unseal`, `sys/leases/*`, `<mount>/metadata|destroy|delete`,
    and `<dbmount>/creds/*`.
  - **SIEM still empty:** the SIEM view reads `OFFGRID_SIEM_INDEX` (`offgrid-audit`) — a DIFFERENT index
    than Analytics (`offgrid-gateway`). `offgrid-audit` doesn't exist until `shipAudit()` writes to it;
    now that `OFFGRID_OPENSEARCH_URL` is set, governed activity will create+populate it. Generate a few
    governed runs to seed, or point `OFFGRID_SIEM_INDEX=offgrid-gateway` (field-sparse) as a stopgap.
  - **Presidio (Guardrails) DEFERRED:** Presidio is live on g6 (:5002/:5001) and reachable from a shell,
    but the **launchd next-server can't reach a standalone loopback forwarder** on S1 (fresh `node`
    can — an unresolved macOS launchd loopback quirk; caddy `reverse-proxy` also binds IPv6-`*` only).
    The proven next-server→g6 path is the **edge Caddy** (root, binds `127.0.0.1` explicitly — that's
    how the 8931-8934 g6 proxies work). Wire Presidio by adding `8938→g6:5002`,`8939→g6:5001` to the
    edge Caddyfile (already staged there) + `OFFGRID_ADAPTER_GUARDRAILS=presidio` +
    `OFFGRID_PRESIDIO_URL`/`_ANONYMIZER_URL` — but that needs an **edge-Caddy reload/restart**, which is
    risky (admin API is `off`, the process is unsupervised PPID 1 fronting the public tunnel). Do it
    on-site or during a maintenance window. Until then Guardrails runs the always-on regex floor.

## No-auth service exposure — hardening (Phase 4.10-A, 2026-07-05)

Presidio, Marquez, and OPA are stock images with **zero built-in auth**. Analysis + fix:

- **Public (internet) exposure: already closed, nothing to add.** The Cloudflare tunnel
  (`cloudflared-tunnel.yml`) exposes only console/gateway/auth/ssh/provit/console-status/
  -landing/gungnir/console-api; everything else is `http_status:404`. None of these three
  services has a tunnel hostname, and the one broad public vhost (`console-api`) proxies only
  to the console (:3000) and the aggregator (:8800). So they are **not reachable from outside**.
  No public Caddy `gated` vhost was added — a browser-login redirect would break the console's
  own server-to-server calls (Marquez `src/lib/marquez.ts`, OPA `src/lib/adapters/policy.ts`,
  Presidio `src/lib/adapters/pii.ts`), which is the wrong gate for a machine-to-machine path.
- **LAN exposure: the real gap, fixed by loopback-binding the Docker host ports** (they defaulted
  to `0.0.0.0`, i.e. any LAN host could hit them unauthenticated). Changed in the compose files
  (`services-node-a.yml` for S1, `docker-compose.yml` for dev):
  - OPA `8181:8181` → `127.0.0.1:8181:8181`
  - Marquez `9000:5000`/`5010:5010` → `127.0.0.1:9000:5000`/`127.0.0.1:5010:5010`
    (marquez-web still reaches marquez over the internal Docker network — unaffected)
  - Presidio (dev only, S1 uses g6) `5002/5001` → `127.0.0.1:5002/5001`
  - The same-host console keeps working: it dials `127.0.0.1:9000` / `127.0.0.1:8181`.
  - **APPLY ON SERVER:** re-create the affected containers so the new bind takes effect
    (`docker compose -f services-node-a.yml up -d opa marquez`; port re-binds require a recreate,
    not just restart). Verify from another LAN host that `curl s1:9000/api/v1/namespaces` and
    `curl s1:8181/health` now **refuse/time out**, while `curl 127.0.0.1:...` on S1 still works.
- **Presidio on g6 (LAN, prod):** S1's edge Caddy must still dial `g6:5002/5001`, so g6's ports
  cannot be loopback-bound. A stock Presidio can't verify a bearer, so the gate is a **g6 host
  firewall rule allowing S1 (127.0.0.1) only** on 5001/5002 (deny the rest of the LAN).
  **TODO on g6:** add that pf/ufw rule (record the exact rule here once applied). The S1-side
  8938/8939 Caddy proxies are `http://127.0.0.1:...` = loopback-bound, already not LAN/tunnel-reachable.

## Multi-tenancy (Phase 3 — in progress)

org_id on 18 tenant tables (default 'default'). Connectors scoped end-to-end (list filters,
create sets) — **isolation proven on the real DB**: org-a/org-b rows never cross; default unaffected.
Pattern to roll across the other scoped tables. RLS backstop pending a non-superuser DB role
(app connects as superuser `offgrid`, which bypasses RLS).

### RLS backstop — READY TO APPLY (reviewed .sql, NOT auto-run)

The DB-enforced safety net behind the app-level org filtering is delivered as a reviewed migration:
**`deploy/onprem/2026-rls-backstop.sql`** (generated from the pure `src/lib/rls-policy.ts` →
`buildRlsMigrationSql`, unit-tested in `test/rls-policy.test.ts`). It:
1. Creates a **non-superuser role `offgrid_app`** (`LOGIN NOSUPERUSER NOBYPASSRLS`) + baseline schema/
   table/sequence grants (so the non-tenant auth/session/config tables still work).
2. `ENABLE + FORCE ROW LEVEL SECURITY` on the **13 tenant-scoped tables in the code schema** (api_keys,
   connectors, masking_rules, datasets, governance_items, agent_runs, routing_rules, tools,
   chat_artifacts, studio_templates, provit_repos, provit_runs, provit_tokens) with an `org_isolation`
   policy. Every block is **guarded** (`to_regclass` + `information_schema` org_id check) so it skips a
   table that's absent or lacks org_id — re-runnable and drift-safe against tables created directly on S1.
3. Policy predicate: `org_id = current_setting('app.current_org_id', true) OR current_setting(...) IS
   NULL`. **Dormant by default:** the app doesn't set that GUC today, so the backstop is a no-op and
   the app's existing query-layer filtering governs — switching to the role does NOT change results on
   day one; it only removes the superuser bypass so the policy CAN take effect. Setting the GUC per
   request (the documented `setOrgGucSql` / `withOrg` wrapper) turns it live without any route change.

**Apply steps (on S1, during a maintenance window — the DATABASE_URL switch is the risky live step):**
```bash
# a) apply the migration as the superuser (drizzle-kit push hangs over SSH — use psql via docker):
cat deploy/onprem/2026-rls-backstop.sql | \
  /Users/admin/.orbstack/bin/docker exec -i offgrid-console-postgres-1 psql -U offgrid offgrid_console
# b) set a real password for the app role (do NOT commit it):
/Users/admin/.orbstack/bin/docker exec -i offgrid-console-postgres-1 \
  psql -U offgrid offgrid_console -c "ALTER ROLE offgrid_app WITH PASSWORD '<STRONG-PW>';"
# c) VERIFY as the app role BEFORE flipping the app (RLS enforces once the GUC is set):
#   psql "postgresql://offgrid_app:<PW>@127.0.0.1:5432/offgrid_console" \
#     -c "SET app.current_org_id='org-a'; SELECT count(*) FROM connectors;"  # only org-a rows
```
**⚠️ RISKY LIVE STEP — switching the app's DATABASE_URL to the non-superuser role.** Only after (a)-(c)
verify clean, edit the console's `.env.local` `DATABASE_URL` from the `offgrid` superuser to
`postgresql://offgrid_app:<PW>@127.0.0.1:5432/offgrid_console` and restart the console. Do this on-site
with a rollback ready (revert DATABASE_URL to the superuser DSN + restart). If any table's grants are
missing, the app will 42501-permission-error — that's why (c) verifies first. The backstop stays dormant
(GUC unset) until the app opts into setting `app.current_org_id`, so functional behaviour is unchanged;
the only change is that RLS is no longer bypassed.

## Backups (Phase 3A — done)

`deploy/onprem/backup.sh` dumps console Postgres (52 tables) + corebank (PG) + policyadmin
(MySQL) to `/Users/admin/offgrid/backups/<ts>/` (gzipped, 14-day retention). Verified working.
**Off-box DR live**: backup.sh auto-rsyncs each dump to `admin@192.168.1.66:/backups-from-s1`
(S1→.66 passwordless SSH works; no install on .66 — native rsync, NO OrbStack per decision).
Full streaming replica on .66 (native PG16, no Docker) is the next HA step — needs a one-time
sudo pw during the Homebrew/PG install.

### Nightly schedule — plist READY TO INSTALL (`deploy/onprem/co.getoffgridai.backup.plist`)

Daily 02:00 backup via a **system LaunchDaemon** (runs as root, no login required). The console's
Backups page reads its state via `launchctl list co.getoffgridai.backup` (`readScheduleStatus`) and
shows "scheduled" once loaded. **Apply on S1 (sudo):**
```bash
sudo cp deploy/onprem/co.getoffgridai.backup.plist /Library/LaunchDaemons/
sudo chown root:wheel /Library/LaunchDaemons/co.getoffgridai.backup.plist
sudo chmod 644        /Library/LaunchDaemons/co.getoffgridai.backup.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/co.getoffgridai.backup.plist
sudo launchctl list co.getoffgridai.backup            # exit 0 = loaded
sudo launchctl kickstart -k system/co.getoffgridai.backup   # run once now to validate
```
Logs to `/Users/admin/offgrid/backups/backup.log`. `RunAtLoad=false` (don't fire on every reboot;
02:00 only). Note: a root daemon has root's own ssh identity/known_hosts — the off-box rsync in
backup.sh is best-effort (`BatchMode`, never fails the backup); if the off-box copy must run as
`admin` (whose key is authorized on the peer), either add `UserName=admin` to the plist or authorize
root's key on the peer. Still TODO: MSSQL logical dump.

### Console Backups page — trigger + prune + restore-inspect (all live in the module)

The `/backups` module is a full management surface (routes under `/api/v1/admin/backups`, admin-gated):
- **Run backup now** — `POST /api/v1/admin/backups` (spawns backup.sh; 409 if one's already running).
- **Delete / Prune** — `DELETE …/[name]` and `POST …/prune` (path-safety choke-point).
- **Restore** — `GET …/[name]/restore` is a **NON-destructive inspector**: it lists the dump files in a
  chosen backup and returns the EXACT copy-pasteable restore command per dump (built by `buildRestorePlan`
  in `backups-view.ts`, mirroring backup.sh's RESTORE notes). **Deliberately NOT one-click** — restoring
  overwrites a live DB, so the UI shows a hard warning + the command to run on S1 in a maintenance window,
  rather than executing it. This is the honest, guarded surface.

## launchd services on S1 (root)

- `co.getoffgridai.edge` — Caddy (`deploy/Caddyfile`). Restart: `sudo launchctl kickstart -k system/co.getoffgridai.edge`.
- `co.getoffgridai.aggregator` — gateway aggregator (`scripts/gateway-aggregator.mjs`, holds `OFFGRID_GATEWAY_API_KEY` + upstream timeout). Restart: `sudo launchctl kickstart -k system/co.getoffgridai.aggregator`.
- `co.getoffgridai.metrics` — metrics.
- `co.getoffgridai.agent-worker` — durable agent-run worker (gui-domain LaunchAgent, `tsx scripts/temporal-worker.mts`; drains the `offgrid-agents` queue). Restart: `launchctl kickstart -k gui/$(id -u)/co.getoffgridai.agent-worker`. See § Durable agent-run worker below.
- Console + cloudflared run as backgrounded processes (not launchd) — see DEPLOY.md.

### Sandbox runner images (code-exec) — MUST be pre-pulled on S1

The Sandbox (`src/lib/adapters/sandbox.ts`, `docker` engine) runs each snippet in an ephemeral
`docker run --pull never --network none …` container, so the run image must already be present on
the host — the runner never pulls at run time (a pull folded into the run timeout is what caused the
old "Unable to find image 'python:3.11-slim' … / exit 143"). Pre-pull once (done 2026-07-06):

```bash
docker pull python:3.11-slim   # OFFGRID_SANDBOX_PY_IMAGE default
docker pull node:20-slim       # OFFGRID_SANDBOX_NODE_IMAGE default
```

Override the tags via `OFFGRID_SANDBOX_PY_IMAGE` / `OFFGRID_SANDBOX_NODE_IMAGE` (and the Firecracker
`OFFGRID_FC_*_IMAGE`); whatever tag is configured must be pulled on the host.

### Durable agent-run worker (Temporal, task queue `offgrid-agents`)

Agent runs can now execute DURABLY on Temporal (`:7233`, already up on S1) via the
`AgentRunWorkflow` + `runAgentPipeline` activity — the workflow wraps the existing `runAgent`
pipeline (policy → guardrails → retrieval → LLM → grounding → provenance → persist), so a worker
crash mid-run is retried/resumed, not lost. This is SEPARATE from the inference queue
(`offgrid-inference`): this queue is `offgrid-agents`.

- **Which routes go through the durable seam (`dispatchAgentRun`):** as of `feat/temporal-durable`,
  ALL agent-run trigger routes route through `dispatchAgentRun` (durable when enabled, else inline):
  `POST /admin/agents/runs`, `POST /admin/run` (Studio "run as app" test-run),
  `POST /admin/agent-runs/[id]/rerun`, and `POST /admin/agent-runs/workflows/[wf]/rerun`. Each
  response surfaces the mode honestly (`durable` | `sync` | `pending`); a `pending` durable submit
  returns 202 + workflowId/runId to poll. Multi-step app runs use the sibling `submitAppRun` seam
  (`offgrid-apps` queue, app-worker). No new queue/worker/launchd wiring — reuses `offgrid-agents`.

- **The worker loads its own env** (`scripts/worker-env.mts`, imported FIRST in
  `scripts/temporal-worker.mts`): `@next/env` `loadEnvConfig` against the console root, resolved
  ABSOLUTELY from the script path (not CWD). This runs as a module side effect BEFORE the activities
  import evaluates `@/db` and builds its pg Pool — ESM evaluates all static imports in source order
  before any top-level statement, so a dotenv *statement* would be too late (Pool already built
  passwordless). **Bug fixed this session:** the worker was crashing every DB query with
  `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` because `DATABASE_URL` was
  never loaded → the pg client fell back to the passwordless default. The worker now also fails fast
  with a clear message if `DATABASE_URL` / `OFFGRID_GATEWAY_URL` / `OFFGRID_GATEWAY_API_KEY` are
  missing (`missingRequiredEnv`), instead of dying deep in the pipeline.
- **launchd-managed** (durable across reboots): gui-domain LaunchAgent
  `co.getoffgridai.agent-worker` (RunAtLoad+KeepAlive), plist committed at
  `deploy/onprem/co.getoffgridai.agent-worker.plist`. Install/verify/kickstart/uninstall steps are
  in the plist header. Runs `/usr/local/bin/node <console>/node_modules/.bin/tsx
  scripts/temporal-worker.mts` with `WorkingDirectory=/Users/admin/offgrid/console`; logs to
  `/Users/admin/offgrid/console/agent-worker.log`.
- **THE FLIP — enabling durable runs (do this AFTER the worker is up + "draining"):** set
  `OFFGRID_QUEUE_ENABLED=1` (or `OFFGRID_ADAPTER_AGENTRUNTIME=temporal`) in the console's `.env.local`
  and restart the console. Without the flag OR without a reachable worker, the console gracefully
  runs agent runs synchronously in-process (unchanged, safe default). Order: bootstrap the worker →
  confirm the log shows `ready — draining agent runs` → flip `OFFGRID_QUEUE_ENABLED=1` on the console.
- Env the worker reads (from `.env.local`, plus the plist override): `OFFGRID_TEMPORAL_ADDRESS`
  (default `offgrid-s1.local:7233`; the plist pins `127.0.0.1:7233` on S1),
  `OFFGRID_TEMPORAL_NAMESPACE=default`, `OFFGRID_AGENT_TASK_QUEUE=offgrid-agents`,
  `OFFGRID_AGENT_MAX_ATTEMPTS`, `OFFGRID_AGENT_AWAIT_MS`, `OFFGRID_AGENT_MAX_CONCURRENT`.
- **Live durable run VERIFIED end-to-end on S1 (2026-07-07).** With Temporal (`:7233`) + Postgres up,
  the agent-worker was started manually (`OFFGRID_ADAPTER_AGENTRUNTIME=temporal`), reached
  `ready — draining agent runs`, and a run submitted through the real `dispatchAgentRun` executed
  DURABLY: `mode: durable`, workflow `agentrun-sop-synth-run_b453c78f` (`AgentRunWorkflow`,
  `temporalStatus: COMPLETED`, `historyLength: 11`, queue `offgrid-agents`), the run persisted to
  `agent_runs` (status `done`, 8 pipeline steps, provenance signed), and it is queryable via the
  visibility store (`describeWorkflow` / `listWorkflowExecutions`). No SASL error.
- **CURRENT PROD POSTURE (as of that check): durable dispatch is OFF.** The console `.env.*` has
  `OFFGRID_QUEUE_ENABLED=` (empty) and `OFFGRID_ADAPTER_AGENTRUNTIME=` (empty), and the
  `co.getoffgridai.agent-worker` LaunchAgent is NOT bootstrapped (`launchctl list` shows only
  `co.getoffgridai.app-worker`). So today every agent run executes SYNCHRONOUSLY in-process (the safe
  honest default). To turn durability ON: bootstrap the agent-worker plist → confirm
  `ready — draining agent runs` → flip `OFFGRID_QUEUE_ENABLED=1` (or `OFFGRID_ADAPTER_AGENTRUNTIME=temporal`)
  and restart the console. (The `app-worker` for multi-step app runs IS loaded.)

## Public file store (SeaweedFS, internet-exposed via the gateway)

The SeaweedFS S3 store on S1 (`127.0.0.1:8333`, container `offgrid-services-extra-seaweedfs-1`)
is reachable from the internet at **`gateway.getoffgridai.co/files/*`**. Routing is in the
committed `deploy/Caddyfile` (a `handle_path /files/*` block in the `gateway.*` site):
- **GET/HEAD are public** (no auth) — media is world-readable.
- **Writes (PUT/POST/DELETE/PATCH) require a Keycloak bearer** — Caddy `forward_auth` calls the
  console `/api/auth/verify-write` (route in git), which runs `requireUser` (Keycloak JWT via
  the IdentityVerifier seam). SeaweedFS itself stays bound to localhost, so the gate can't be
  bypassed; the console's own anonymous localhost writes are unaffected.
- Cloudflare caps request bodies at ~100 MB — larger uploads need S3 multipart.

### Keycloak client `offgrid-uploader` (realm `offgrid`) — created this session
Confidential client, **service accounts enabled**, standard/direct-grant flows OFF. Exists only
to mint `client_credentials` tokens for authenticated file-store writes (no admin/realm roles —
minimal scope; the file-store write gate only needs *any* valid principal). Secret lives in
Keycloak (regenerate via the admin API / admin console if leaked). Replay if the realm is rebuilt:
```bash
# admin token from offgrid-console-admin, then:
curl -X POST $KC/admin/realms/offgrid/clients -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
  -d '{"clientId":"offgrid-uploader","enabled":true,"publicClient":false,"standardFlowEnabled":false,"directAccessGrantsEnabled":false,"serviceAccountsEnabled":true}'
# then read GET /admin/realms/offgrid/clients/{id}/client-secret
```
Usage: mint at `https://auth.getoffgridai.co/realms/offgrid/protocol/openid-connect/token`
(grant_type=client_credentials), send as `Authorization: Bearer` to `gateway.getoffgridai.co/files/*`.

### Per-service service-account clients (realm `offgrid`) — Phase 4.10-A
Five confidential, service-accounts-enabled clients the service-token broker mints from:
`offgrid-gateway`, `offgrid-opensearch`, `offgrid-fleet`, `offgrid-temporal`, `offgrid-seaweedfs`.
(Phase D added a sixth, `offgrid-superset`, an interactive OIDC *login* client — see the next section.)
Each has an `oidc-audience-mapper` (aud = its own clientId) and a realm role `svc-<service>` assigned
to its service-account user, so the minted access token carries a usable `aud` + role claim. All are
declared in `deploy/keycloak/offgrid-realm.json` (roles + clients + `service-account-*` users) so a
fresh realm import creates them with dev secrets.

For an existing realm (or to rotate/sync secrets into OpenBao), run the idempotent provisioning route
instead of hand-editing: `POST /api/v1/admin/access/service-clients/provision` (admin bearer). It
find-or-creates each client + role via the console's Keycloak admin client, then writes each secret to
OpenBao at `secret/<service>/client-secret`. Body `{"rotate":true}` forces new secrets; default reuses
existing ones (no churn). `GET` the same path reports desired-state vs what exists. Does NOT touch
`offgrid-console` / `offgrid-console-admin`. Requires live Keycloak + OpenBao.

### Native-OIDC for UI services (Phase D — READY, NOT enabled)
"One identity everywhere," the literal version: the three services with their own UI can validate
Keycloak tokens **directly** (not just console-brokered). This is **config on the stock images + KC
clients** — no image patching. **All of it is delivered but NONE of it is live** — enabling is an
on-site maintenance-window step. Full config + per-service enable steps: **`deploy/onprem/oidc-services.md`**.

| Service | KC client (seeded) | Config delivered | Live? | On-site enable = |
|---|---|---|:--:|---|
| **OpenSearch** | `offgrid-opensearch` (existing) | security-plugin `config.yml` (OIDC+JWT), Dashboards yml, `roles_mapping.yml` — in oidc-services.md § 1; ready-to-uncomment mounts in `services-node-a.yml` | ❌ | remove `DISABLE_SECURITY_PLUGIN`, mount security config, run `securityadmin.sh`, **flip broker plan `opensearch: 'none'→'oidc-jwt'`** in `src/lib/service-credentials-lib.ts` (else console reads 401) |
| **FleetDM** | `offgrid-fleet` (existing) | `sso_settings` YAML + `FLEET_SSO_*` env — oidc-services.md § 2; commented in `services-node-b.yml` | ❌ | enable `standardFlow`+callback redirect on the KC client, set `FLEET_SSO_*` env, restart. **No console impact** (broker keeps `fleet: 'native-bearer'` — UI login only) |
| **Superset** | `offgrid-superset` (**NEW** — this change) | `superset_config.py` AUTH_OAUTH block — oidc-services.md § 3; commented mount + `SUPERSET_CONFIG_PATH` in `services-node-b.yml` | ❌ | mount `superset_config.py`, `superset init`, restart. **No console impact** (brokered guest-token embed unaffected) |

**New Keycloak entities this change adds (in `offgrid-realm.json`):** realm role `svc-superset`; client
`offgrid-superset` (confidential, `standardFlowEnabled` for the auth-code login, redirect
`…/oauth-authorized/keycloak`, audience mapper `aud-offgrid-superset`, dev secret
`offgrid-dev-svc-superset-secret`); service-account user `service-account-offgrid-superset` with role
`svc-superset`. A fresh realm import creates them; for an existing realm run the provisioning route
(above) — `offgrid-superset` is now in the code SSOT (`src/lib/service-clients.ts`).

**Why nothing is flipped here:** OpenSearch runs `DISABLE_SECURITY_PLUGIN=true` today and the console
reads it anonymously over loopback — turning the security plugin on without the paired broker-plan flip
would 401 every console analytics/audit read. FleetDM/Superset OIDC are login-only and safe to add, but
still need the on-site config mount + restart. The deliverable is a **one-flag enable** with the config
staged, not a live cutover.

### Keycloak: identity-provider roles for the console admin SA (2026-07-06)

Federation tab (Access → Federation) was 403 because the console's admin service-account
(`service-account-offgrid-console-admin`, realm `offgrid`, client id from `OFFGRID_KEYCLOAK_ADMIN_CLIENT_ID`)
lacked the `realm-management` IdP roles. Granted (kcadm inside `offgrid-console-keycloak-1`, bootstrap
admin `admin`/`offgrid-dev`):

```bash
docker exec offgrid-console-keycloak-1 /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master --user admin --password offgrid-dev
docker exec offgrid-console-keycloak-1 /opt/keycloak/bin/kcadm.sh add-roles -r offgrid \
  --uusername service-account-offgrid-console-admin --cclientid realm-management \
  --rolename view-identity-providers --rolename manage-identity-providers
```

Takes effect immediately (no restart). Covers list + Add/Delete OIDC provider.

### Durable app-runs (offgrid-apps queue) — ENABLED (2026-07-06)

Multi-step apps with a human step now run durably (Temporal) so HITL review can resume mid-workflow.
- **Worker:** `scripts/app-worker.mts` (`npm run worker:apps`) drains the **`offgrid-apps`** queue. Started
  backgrounded on S1 (mirrors the agent-runs `temporal-worker.mts` process). Uses the same
  `worker-env.mts` bootstrap (loads `.env.local` before `@/db` builds its Pool).
  ⚠️ **Not yet a launchd job** — won't survive reboot; add a plist (like `co.getoffgridai.agent-worker`)
  to make it durable across restarts. Restart for now: `pkill -f app-worker.mts` then relaunch.
- **Console env** (`.env.local`): `OFFGRID_ADAPTER_APPRUNTIME=temporal` + `OFFGRID_TEMPORAL_ADDRESS=127.0.0.1:7233`.
  App-only flag — deliberately NOT the global `OFFGRID_QUEUE_ENABLED`, so agent-runs dispatch is unchanged.
- **Verified:** the seeded "Reimbursement Approval" app (`app_bdd24eab`) POST /run → `mode: durable`,
  workflow executed the connector-query + agent steps and advances toward the human pause. `submitAppRun`
  degrades to inline if Temporal/worker is unreachable (graceful).

### Self-creating table: compliance_adoption (2026-07-06)
Regulatory framework adoption + per-control status (ISO42001/NIST-AI-RMF/EU-AI-Act). CREATE TABLE IF NOT EXISTS in `ensureComplianceSchema()` (like guardrails_rules) — no migration step. Cols: org_id, framework_id, control_id, status(new|in-progress|met), updated_at; PK (org_id, control_id).

### app-worker now a launchd job (2026-07-06)
The `offgrid-apps` worker is now a gui-domain LaunchAgent `co.getoffgridai.app-worker` (plist: `deploy/onprem/co.getoffgridai.app-worker.plist`) — RunAtLoad + KeepAlive, survives reboot. Bootstrapped on S1; log `/Users/admin/offgrid/console/app-worker.log`; restart `launchctl kickstart -k gui/$(id -u)/co.getoffgridai.app-worker`. Supersedes the earlier "not yet a launchd job" note.

## 2026-07-08 — tenant subdomains fixed (cloudflared stale replica) + per-tenant gateway URL plan

- **Tenant console subdomains (`<slug>-onprem-console.getoffgridai.co`) were intermittently 404ing.**
  Root cause: TWO `cloudflared tunnel run` replicas for tunnel `70f8a607…`; replica PID 10168 (started
  Jul 3) ran a STALE config without the `*.getoffgridai.co` wildcard ingress, while PID 83567 (Jul 7)
  had it. Cloudflare round-robins replicas → tenant (wildcard-only) hosts 404'd ~50% of the time.
  **FIX:** killed the stale replica (`kill 10168`); one replica (83567, current config) remains and
  keeps the tunnel up (no downtime). Verified `bharatunion-onprem-console` 15/15 → 200.
- DNS already has wildcard `*.getoffgridai.co` (proxied CNAME → tunnel) + `*.onprem-console.*` +
  explicit `bharatunion-onprem-console` — all → the tunnel. Live ingress already had `*.getoffgridai.co
  → :3000`. Canonical `cloudflared-tunnel.yml` re-synced to live (was stale).
- **Per-tenant GATEWAY URLs (planned, not yet live):** provisioned tenant gateway host =
  `<slug[:5]><rand5>-gateway.getoffgridai.co` (mirrors `gateway.getoffgridai.co`). Needs: a
  more-specific `*-gateway.getoffgridai.co → :8800` ingress rule ABOVE the wildcard (verify cloudflared
  supports the pattern) + the aggregator resolving tenant from Host. Deferred (supervised tunnel edit).

## 2026-07-08 — durable execution turned ON (was shipped-but-off)

Founder directive "everything shipped and on." Flipped durable agent+app runs from off→on:
- **`OFFGRID_QUEUE_ENABLED=1`** appended to `/Users/admin/offgrid/console/.env.local` (fleet-wide durable
  toggle — `shouldRunDurably`/`dispatchAgentRun` now dispatch to Temporal, not inline).
- **`co.getoffgridai.agent-worker`** installed: `cp deploy/onprem/co.getoffgridai.agent-worker.plist
  ~/Library/LaunchAgents/` + `launchctl bootstrap gui/$(id -u) …`. Runs `tsx scripts/temporal-worker.mts`
  draining `offgrid-agents`; RunAtLoad+KeepAlive. Started clean ("ready — draining agent runs", state
  RUNNING; no DATABASE_URL/SASL crash). Log: `agent-worker.log`.
- `co.getoffgridai.app-worker` (offgrid-apps) + `co.getoffgridai.queue` (offgrid-inference) were already
  running. Console (launchd `co.getoffgridai.console`) kickstarted to load the flag.
- **Verified:** agent run `run_9ecfcfa4` dispatched durably (workflowId `agentrun-sop-synth-run_9ecfcfa4`),
  completed `done`, 8 steps, provenance signed.
- Presidio already ON (`OFFGRID_ADAPTER_GUARDRAILS=presidio` + URLs) — /status shows presidio `up`; the
  old regex-floor gap (#2) is effectively resolved.
- Restart worker: `launchctl kickstart -k gui/$(id -u)/co.getoffgridai.agent-worker`.

## 2026-07-08 — S2 (second server) online + fleet topology corrected

**Fleet is 10 machines total** (earlier notes wrongly implied g9/g10): **S1 + S2 + g1–g8.** There is NO
g9/g10. Correcting the stale "g6 = aux server #2" note — the real second server is `offgrid-s2`.

- **S1** `127.0.0.1` — main control-plane server (console :3000, aggregator :8800, Caddy edge,
  cloudflared, OrbStack datastores).
- **S2 = `offgrid-s2`** `192.168.1.60` — SECOND server, powered on 2026-07-08 (was briefly on the wrong
  SSID `airtel_Wednesday`; moved to `airtel_wednesday_2` → reachable). Health: M1 MacBookPro17,1, 8-core,
  16GB, 189GB free, node v22.23.1, SSH `admin/1234`. Has `co.getoffgridai.console.plist` installed (NOT
  started). **No Docker/Colima installed** → can run the Node console but not the containerized stack
  until Colima+containers are set up. ROLE NOT YET ASSIGNED (founder: "confirm healthy, decide later").
- **Gateway model nodes (8):** g1 `.57` qwythos-9b · g2 `.58` gemma-4-e4b · g3 `.32` image(juggernaut,:1234)
  · g4 `.63` qwen3-vl-8b · g5 `.65` gemma-4-e4b · g6 `.66` · g7 `.67` qwen3-vl-8b · g8 `.64` qwythos-9b.
  Aggregator chat pool = g1,g2,g4,g5,g7,g8 (6); g3 in IMAGE_POOL; hostnames are the fleet-membership
  signal (mDNS `offgrid-gN.local`), NOT open :7878 (stray OGA-Desktop laptops also serve :7878 — e.g. a
  dev laptop appeared at .27; correctly NOT in the curated pool).

## Triggers + output sinks env (W5b, 2026-07-08) — set on S1 .env.local for actual delivery
- **Email-in trigger:** `OFFGRID_EMAIL_IMAP_URL`, `OFFGRID_EMAIL_IMAP_USER`, `OFFGRID_EMAIL_IMAP_PASS` (opt `OFFGRID_EMAIL_IMAP_MAILBOX`) + a launchd/cron job POSTing `/api/v1/admin/triggers/email/poll` on an interval. Unset → poll route reports not-configured (no fake runs).
- **Email output sink:** `OFFGRID_SMTP_URL`, `OFFGRID_SMTP_FROM` (opt `OFFGRID_SMTP_USER`/`OFFGRID_SMTP_PASS`). Unset → sink returns a "NOT CONFIGURED" verdict (run stays done, nothing sent — never a fake success).
- **Schedule trigger:** needs `OFFGRID_QUEUE_ENABLED=1` (already set) / `OFFGRID_ADAPTER_APPRUNTIME=temporal`; schedule registration is a no-op reporting not_configured until the durable runtime is on.
- **Auto-rollback on drift (W3):** `OFFGRID_AUTO_ROLLBACK_ON_DRIFT=1` to enable auto-revert of published pipelines to last-good on a drift breach (opt-in — high-impact; off by default).
- **Durable chat (W1):** the chat worker (`npm run worker:chat`, drains `offgrid-chat`) must run alongside app/agent workers for chat runs to go durable; inline fallback when off.

## Schema migration applied directly (W5a, 2026-07-08)
- `ALTER TABLE connectors ADD COLUMN IF NOT EXISTS secret_ref text;` — applied via pg client on S1
  (`offgrid_console` DB). The code's lazy `ensureConnectorSecretRefColumn()` did NOT fire on the
  connectors GET path → deployed code 500'd selecting a missing column. Fix: apply the ALTER directly
  (drizzle-kit push hangs over SSH — DEPLOY.md § Database migrations). Verified: column PRESENT,
  `/api/v1/admin/connectors` → 200. LESSON: additive columns must be applied directly at deploy, not
  trusted to a lazy path that may not be on the first route hit.

## insurer use-case demo substrate (2026-07-08) — source data + data-domains for org_bharat
Seeded the source data + bindings so the 5 demo-priority insurer use cases (docs/USE_CASES_PLAN.md §13)
can be AUTHORED in plain English against real governed tools. Reproducible; idempotent; deterministic.
- **Warehouse (ClickHouse `bharatunion`, S2 :8124):** new analytics tables via
  `node deploy/onprem/seed-insurer-usecases.mjs` — `employees` (500), `pricing_rfq` (120),
  `pricing_rate_card` (20), `helpdesk_cases` (300), `job_requisitions` (12), `candidates` (177),
  `competitor_products` (80), `claim_documents` (400). TRUNCATE+reload, seeded mulberry32.
- **Container DBs (runtime tool source — connector-exec queries these):** same generated rows loaded
  into the on-prem data-source containers so a compiled connector-query tool resolves LIVE:
  - `offgrid-ds-corebank` (Postgres :5433) → `pricing_rfq`, `pricing_rate_card`, `helpdesk_cases`,
    `competitor_products`, `claim_documents`.
  - `offgrid-ds-policyadmin` (MySQL :3307) → `job_requisitions`, `candidates` (alongside the existing
    `employees` / `employee_quota` that back use case #1). All `public`/default schema.
  - Reason: connector-exec speaks postgres/mysql/mssql/rest — NOT ClickHouse — so the tool source must
    live in a container DB. The `.mjs` seeds BOTH (SEED_SOURCES=0 to load warehouse only).
- **Data-domains (console DB `data_domains`, org_bharat):** 7 new rows via
  `node deploy/onprem/seed-insurer-domains.mjs | psql` — ids `bhdom_ey_*`: `pricing rfq`,
  `pricing rate card`, `helpdesk cases`, `job requisitions`, `candidates`, `competitor intel`,
  `claim documents`. Deterministic ids + ON CONFLICT DO UPDATE → idempotent. Bound only to existing
  `bhcon_corebank` / `bhcon_policyadmin`. Use case #1 already covered by `bhdom_quota`.
  Definitions live in `src/lib/data-domains-insurer-seed.ts` (pure planner + tests).

## Schema migration applied directly (prompt_partials, 2026-07-09)
- `CREATE TABLE IF NOT EXISTS prompt_partials (id, name, title, content, owner, visibility, created_at, updated_at)` — applied via pg client on S1 (`offgrid_console`) over the cloudflared tunnel; lazy ensure not trusted on first route hit (same lesson as connectors.secret_ref/etl_jobs). Verified `/api/v1/prompts/partials` → 200.
- Deploys now via the **cloudflared tunnel** (`SERVER=offgrid-tunnel ./deploy/push.sh`) when off the office LAN — tunnel drops mid-rsync intermittently, retry succeeds. `rm -rf coverage .nyc_output` before deploy (c8 output races rsync).

## Kestra ETL/orchestration engine — LIVE on S2 (2026-07-09)
- Provisioned via the `kestra` compose profile on S2 (OrbStack): `offgrid-console-kestra-1` (Up, HTTP :8090 → 307 UI) + `offgrid-console-kestra-postgres-1` (healthy). JVM capped `-Xmx1200m` for the 16GB box; docker.sock mounted for custom-code Docker-task nodes; postgres repo/queue, local storage.
- Provisioned off-office-wifi via the **Mac→S1(cloudflared tunnel)→S2(LAN, key-auth) hop** (S1→S2 SSH is key-based, no password; S1 lacks sshpass). Bringup script `~/kestra-up.sh` on S2. GOTCHA hit: first bringup used S1's STALE compose (no kestra profile → "no service selected") — must push the CURRENT compose Mac→S1→S2 before `--profile kestra up`.
- REMAINING (lands with the console integration deploy): edge-Caddy loopback `127.0.0.1:8945 → offgrid-s2.local:8090` + `OFFGRID_KESTRA_URL=http://127.0.0.1:8945` in S1 `.env.local`, so the console (which can't egress to the LAN) reaches it. Then the Data-tab ETL surface drives Kestra flows.

## Batch deploy 2026-07-09 — Kestra ETL + rate limits + G-F1/G-F2 + user-activity (LIVE)
- Deployed over the cloudflared tunnel. Verified live: signin 200, connectors 200 (rate-limit Edge middleware OK), /api/v1/admin/etl/jobs 200, **Kestra reachable via edge loopback 8945→S2:8090 (307)**, **PAN redaction live** (`ABCDE1234F` → `<IN_PAN>`, engine presidio — G-F2 fixed).
- Env: `OFFGRID_KESTRA_URL=http://127.0.0.1:8945` added to S1 `.env.local`. Edge Caddy reloaded (Caddyfile 8945 block: `127.0.0.1:8945 → offgrid-s2.local:8090`). Workers (agent/app/chat) restarted for the web_search-egress agentrun change.
- Rate-limit columns present (self-migrated + verified): `api_keys.rate_limit`, `api_keys.token_hash` (+ idx), `org_settings.default_rate_limit`.
- G-F1 (bearer/service tenant scoping) + user-activity view + prompt observability also deployed.

## Webhook trigger ingress (STAGED — 2026-07-09)

The universal inbound trigger primitive: `POST /api/v1/triggers/<token>` fires a GOVERNED durable run
of the app/agent a token is bound to. Auth is a per-trigger HMAC signature (`X-Offgrid-Signature:
sha256=…` over `${X-Offgrid-Timestamp}.${rawBody}`), ±300s window, single-use per signature (nonce),
tenant-scoped (the fired run executes under the trigger's org). Secret is vaulted in OpenBao (only a
`secret_ref` in the row).

- **DB (self-migrating, `ensureWebhookTriggerSchema`)**: `webhook_triggers` (id, token, org_id,
  target_kind app|agent, target_id, secret_ref, enabled, created_at, last_fired_at) + `webhook_nonces`
  (nonce PK, seen_at; opportunistically pruned). No manual migration — created on first use.
- **Admin CRUD**: `GET/POST /api/v1/admin/triggers/webhooks`, `PATCH/DELETE …/[id]` (enable/disable/
  rotate/delete). Create returns the public URL + secret ONCE.
- **STAGED exposure — needs a supervised apply (NOT live yet):**
  1. `deploy/onprem/cloudflared-tunnel.yml` — added `hooks.getoffgridai.co → :80`. Apply to the live
     `~/.cloudflared/config.yml` on S1 + restart cloudflared.
  2. `deploy/Caddyfile` — added the `hooks.getoffgridai.co` vhost (edge WAF + rate-limit; proxies ONLY
     `/api/v1/triggers/*` → :3000). Reload Caddy on S1.
  3. `deploy/onprem/dns-records.sh` — added `hooks` to NAMES. Run to create the CNAME.
  - Until applied, the route still works behind `onprem-console.getoffgridai.co/api/v1/triggers/<token>`.
- **Env (optional)**: `OFFGRID_WEBHOOK_BASE_URL=https://hooks.getoffgridai.co` so the admin create
  response returns an absolute public URL (else it returns a path to prefix with the console host).
- Cloudflare **Email Routing** on the demo domain can forward inbound mail → a webhook trigger URL, so
  email-in rides on this same primitive (no IMAP mailbox needed).

## OpenBao persistence migration — STAGED, supervised apply (2026-07-09, prod-readiness P0 R1)

**Problem:** OpenBao ran in **dev mode** (in-memory, hardcoded root token `offgrid-dev-token`) — every container restart **wipes all secrets** (connector creds, webhook-trigger secrets, the Resend API key, gateway keys). The consumption layer (webhooks + Resend) stores secrets in the vault, so this must be fixed before it's real.

**Staged fix (in git, NOT yet applied):** `deploy/docker-compose.yml` now has two profiles — `openbao-dev` (dev/local convenience, profile `secrets-dev`) and `openbao` (prod, profiles `secrets`/`all`) running `server -config=/openbao/config/config.hcl` with **file storage** on the `openbao-data` volume (added to backups). Config: `deploy/openbao/config.hcl`.

**Supervised apply procedure (founder holds unseal-key custody):**
1. `make down` the old dev openbao (note: this discards its in-memory secrets — re-seed after; today prod has few/no critical vaulted secrets since connectors still use legacy plaintext endpoints, so loss is minimal — verify first).
2. Bring up the persistent service (rsync compose + config to S1, `docker compose --profile secrets up -d openbao`). It comes up **SEALED**.
3. `bao operator init` → **record the unseal keys + root token securely** (founder custody; NOT in git). Unseal with the threshold of keys.
4. Enable the KV v2 mount the console expects (`bao secrets enable -path=secret kv-v2` — confirm the path against `src/lib/adapters/secrets.ts`).
5. Create a **scoped token** (policy limited to the console's secret path), set `OFFGRID_OPENBAO_TOKEN=<scoped>` in the server `.env.local` (remove reliance on the dev root; also fixes the fail-open fallback in `adapters/secrets.ts:39`).
6. Re-vault any secrets that were in the old dev vault (connector secret_refs, etc.).
7. Confirm `/openbao/data` is in the nightly backup set.

Until applied, the vault remains ephemeral — acceptable only while no restart-critical secrets live there. Related P0s (fail-open token/signing fallbacks) tracked in `docs/PRODUCTION_READINESS.md`.

## Consumption + BFSI wave deployed (2026-07-09, main @ d5d3010)
Deployed over tunnel: HITL review inbox+decision screen (`/build/review`), BFSI Trust & Security Center (`/governance/trust` + `/api/v1/admin/trust/export`), governed Resend email sink + self-serve sending-domain verify + forward-to-address inbound (`/operations/messaging`), on top of the earlier per-app RBAC/ABAC access policy + webhook ingress. **`RESEND_API_KEY` added to server `.env.local`** (36-char `re_…`, from `mobile/.env.keygen`; NOT in git) + console restarted. Env-only for now — the fuller design vaults it as a per-org `resend_api_key` secret_ref once OpenBao persistence is applied.

## Consumption/BFSI wave 2 deployed (2026-07-09, main @ cdece1d)
Deployed over tunnel: app SHARING (creator grants to Keycloak users + upward-hierarchy inheritance, wired at all 7 access entry points), SHADOW MODE + BLAST-RADIUS controls (per-app kill-switch/runs-per-day/spend-cap + shadow-default; side-effecting sinks no-op+record wouldPerform in shadow), and SURFACED ROI (per-app card + Insights›ROI dept/org rollup). Applied `app_run_controls` table via pg client (self-migrates too). `roi_settings` + `app_access_policies.grants` self-migrate on first use. Signin 200 post-deploy.

### OpenBao unseal decision (2026-07-09, founder): AUTO-UNSEAL on-prem
No cloud KMS on the air-gapped box, so auto-unseal = a boot-time unseal SERVICE: root-owned key file (mode 600) on S1 + a launchd job that feeds the Shamir keys to the freshly-started (sealed) vault on every boot → reboots self-unseal, secrets persist (file storage), no manual key entry. Staged: `deploy/openbao/auto-unseal.sh` + `deploy/openbao/co.getoffgridai.openbao-unseal.plist`. One-time supervised setup (founder present to receive + store keys offline): `bao operator init -key-shares=5 -key-threshold=3` → store all keys+root token offline → write 3 keys to `/Users/admin/offgrid/secrets/openbao-unseal.keys` (600) → install the launchd plist → enable KV mount + set the console's scoped `OFFGRID_OPENBAO_TOKEN`. Founder holds the offline recovery copy; the box holds the operational unseal material (acceptable on owned hardware).

## Consumption/BFSI wave 3 deployed (2026-07-09, main @ 9516780)
Deployed: PDF reports now embed a Unicode font (₹/→ render — was WinAnsi-crashing every rupee report; verified #13 competitive-intel produces a real PDF, run status=done), and the EMAIL-INVITE onboarding flow (admin/creator invites by email → Resend accept link → Keycloak user provisioned → app grants applied; `user_invites` self-migrates). **push.sh FIXED:** it now actually runs `npm install` on the server before build — the prior deploy failed because a new dep (`@pdf-lib/fontkit`) was rsync'd in package.json but never installed server-side (opaque webpack error). One-time manual fix applied to the running server (installed fontkit + rebuilt) before the push.sh fix; future deploys self-install. Keycloak user-provisioning in the invite accept flow is built on the existing keycloak-admin client but NOT yet smoke-tested against a live realm — flagged.

## OpenBao persistence — APPLIED (2026-07-09, throwaway-instance simplification)
DONE, autonomously (founder: "throwaway instance, never real prod data — just solve it"). The live vault (`offgrid-services-a` stack, `services-node-a.yml`) was switched from BAO_DEV in-memory to **file storage** on the `openbaodata` volume (config `deploy/onprem/openbao-config.hcl`, `command:['server']` — do NOT add `-config=` too, the entrypoint auto-loads /openbao/config and a second load double-binds :8200). Volume needed `chown openbao:openbao /openbao/data` once. Initialized with **1 share / 1 threshold** (throwaway — not the 5/3 the generic runbook describes). Unseal key + root token in root-only files `/Users/admin/offgrid/secrets/openbao-{unseal.keys,root.token}` (600). KV v2 mounted at `secret`. Console points at it via `OFFGRID_OPENBAO_TOKEN=<root>` in `.env.local`. **Boot auto-unseal launchd** `co.getoffgridai.openbao-unseal` loaded (runs `deploy/openbao/auto-unseal.sh` → feeds the key on every boot → reboots self-unseal, secrets persist). Verified: read/write through the API works; **prod smoke 12/12** (gateway/PII/sandbox/MDM unaffected — the old 6 service-cred namespaces weren't re-seeded and nothing broke; they fall back to env/native tokens). Remaining (code, low-pri): `adapters/secrets.ts:39` still falls back to the dev token if env unset — remove for correctness (now a real token is set).
