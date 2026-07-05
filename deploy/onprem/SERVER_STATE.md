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
| `OFFGRID_GATEWAY_API_KEY` | *(matches aggregator plist)* | `/v1/*` auth — see `co.getoffgridai.aggregator` plist |
| `OFFGRID_ADMIN_EMAILS` | `mac@wednesday.is` | Founder admin override (Keycloak role is chicken-and-egg) |
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
**`fleet_nodes`** (2026-07-05 — the gateway SSOT; seeded with the 9 live nodes).
DDL for each is in `src/db/schema.ts`; the create statements used are in git history / DEPLOY.md.

### Gateway fleet SSOT (2026-07-05) — how it's wired
`fleet_nodes` is the single source of truth for the on-prem fleet. Flow + gotchas:
- **Console** `GET /api/v1/gateway/pool` derives the aggregator POOL/IMAGE_POOL from the table;
  `PATCH /api/v1/gateway/fleet/[name]` edits a node (validated) + pushes model/ctx to the node.
  Editor UI: AI Gateway → **Control** tab (`GatewayFleetConfig`).
- **Aggregator** (`scripts/gateway-aggregator.mjs`) fetches `/pool` on startup + every 30s with a
  **hardcoded fallback** (routing can't drop if console/DB is down). `OFFGRID_POOL` env still pins.
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

**PENDING (Phase 5 — unified API gateway):** `console-api.getoffgridai.co` is staged in
`cloudflared-tunnel.yml` (→ Caddy :80) + a Caddy vhost (`/v1/*`→:8800, `/specs/*`→console proxy,
else→console:3000) in `deploy/Caddyfile`, but NOT yet live. To activate: (1) add the CNAME
`console-api` → the tunnel (extend `dns-records.sh`), (2) copy the updated tunnel config to
`~/.cloudflared/config.yml` on S1 + restart cloudflared, (3) copy the Caddyfile + reload Caddy.
The console-side code is done + live: CORS on `/api/v1/*` (bearer-only) and the in-app spec proxy
`/api/v1/specs/<id>`.

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

## Fleet role assignment (decided 2026-07-04) — 6 GW + 2 servers

Target topology **6 GW + 2 servers**, with this inference model mix on the GWs:
**2 gemma-4-e4b · 1 qwythos-9b · 1 image (juggernaut) · 2 VL (grounding)**.

| Machine | Role | State |
|---|---|---|
| S1 | server #1 (control plane) | ✅ up |
| **g6** | **server #2 (aux tier — S2 replacement)** | **designated 2026-07-04; NOT yet provisioned** |
| g1 | GW — qwythos-9b | ✅ RECLAIMED to `_2` (2026-07-05, IP .57) — qwythos routes again |
| g2 | GW — gemma-4-e4b | ✅ serving |
| g5 | GW — gemma-4-e4b | ✅ serving |
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

## Multi-tenancy (Phase 3 — in progress)

org_id on 18 tenant tables (default 'default'). Connectors scoped end-to-end (list filters,
create sets) — **isolation proven on the real DB**: org-a/org-b rows never cross; default unaffected.
Pattern to roll across the other scoped tables. RLS backstop pending a non-superuser DB role
(app connects as superuser `offgrid`, which bypasses RLS).

## Backups (Phase 3A — done)

`deploy/onprem/backup.sh` dumps console Postgres (52 tables) + corebank (PG) + policyadmin
(MySQL) to `/Users/admin/offgrid/backups/<ts>/` (gzipped, 14-day retention). Verified working.
**Off-box DR live**: backup.sh auto-rsyncs each dump to `admin@192.168.1.66:/backups-from-s1`
(S1→.66 passwordless SSH works; no install on .66 — native rsync, NO OrbStack per decision).
TODO: schedule via launchd `co.getoffgridai.backup` (daily 02:00); MSSQL logical dump.
Full streaming replica on .66 (native PG16, no Docker) is the next HA step — needs a one-time
sudo pw during the Homebrew/PG install.

## launchd services on S1 (root)

- `co.getoffgridai.edge` — Caddy (`deploy/Caddyfile`). Restart: `sudo launchctl kickstart -k system/co.getoffgridai.edge`.
- `co.getoffgridai.aggregator` — gateway aggregator (`scripts/gateway-aggregator.mjs`, holds `OFFGRID_GATEWAY_API_KEY` + upstream timeout). Restart: `sudo launchctl kickstart -k system/co.getoffgridai.aggregator`.
- `co.getoffgridai.metrics` — metrics.
- Console + cloudflared run as backgrounded processes (not launchd) — see DEPLOY.md.

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
