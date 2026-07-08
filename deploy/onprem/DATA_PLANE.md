# Off Grid — Data Plane runbook (S2)

The **data engine** — the second substrate alongside the model engine (the llama.cpp gateway
fleet). It is the warehouse + streaming + connectors/CDC + data-quality stack: **ClickHouse +
Redpanda + Airbyte + dbt + Great Expectations**. Platform vision: `../../docs/platform/PLATFORM.md`.

> STATUS: **LIVE on S2 (2026-07-08).** warehouse-clickhouse, redpanda, the 6 airbyte-* containers
> and great-expectations run under **OrbStack** on offgrid-s2, fronted on S1's edge Caddy at
> `127.0.0.1:8941–8944` (verified reachable from S1). The console **adapters** that consume these
> are the remaining wiring task; the env block below is the contract they read.

## Where it runs — resolved

The data plane runs on **offgrid-s2** (`192.168.1.60`, 16GB M1) under **OrbStack** — the fleet's
Docker runtime everywhere, NOT Colima — kept OFF S1 so it never contends with the control plane.
It is heavy — Airbyte alone is 6 containers.

> **Reconciliation (2026-07-08):** S2 was marked *retired* after a router reboot (aux tier moved to
> **g6** `192.168.1.66`). S2 has since rejoined the LAN and — on reboot — auto-started its old
> `offgrid-services-b` aux-tier stack, now **redundant with g6** (g6 is the canonical copy the
> console points at). That stack was **stopped on S2** (`docker stop`, volumes kept) to free the
> 16GB box for the data plane. SERVICE_MAP.md § Nodes updated to un-retire S2 as the data-plane host.

## Runtime — OrbStack (already installed on S2)

The fleet uses **OrbStack** for Docker, not Colima/Docker-Desktop. S2 already has OrbStack.app + the
privileged helper installed and the docker daemon running (provisioned via the headless recipe in
`SERVER_STATE.md`). The docker CLI is at `/Applications/OrbStack.app/Contents/MacOS/xbin/docker`
(also symlinked `~/.orbstack/bin/docker`); `docker compose` is the bundled plugin. Non-interactive
SSH has a minimal PATH — prefix it:

```bash
export PATH=/Applications/OrbStack.app/Contents/MacOS/xbin:$HOME/.orbstack/bin:$PATH
# OrbStack allocates memory dynamically (no fixed VM sizing like Colima). If Airbyte syncs push the
# 16GB host into heavy swap, stop the least-critical profile (usually etl) instead of resizing a VM.
```

## Bringup (the one command sequence)

Rsync this repo's `deploy/` to S2 first (git is dead on the fleet Macs — see `../DEPLOY.md`), then:

```bash
cd deploy

# 1) Pull images ahead of time (Airbyte is large; avoids a slow first `up`):
docker compose -f docker-compose.yml \
  --profile warehouse --profile streaming --profile etl --profile dataquality pull

# 2) Bring up the data plane (the exact sequence):
docker compose -f docker-compose.yml \
  --profile warehouse --profile streaming --profile etl --profile dataquality up -d

# 3) Build the dataquality sidecar image (first run only — it's a local build, not a pull):
#    (the `up` above builds it automatically; use --build to force a rebuild after edits)
docker compose -f docker-compose.yml --profile dataquality up -d --build great-expectations

# 4) Watch it settle (Airbyte takes a few min to migrate its DB + Temporal schema):
docker compose -f docker-compose.yml \
  --profile warehouse --profile streaming --profile etl --profile dataquality ps
```

`--profile all` composes these cleanly with every other plane; on 16GB S2 run only the four
data-plane profiles above (running `all` would try to co-locate the whole control plane too).

Tear down (keeps volumes): `docker compose -f docker-compose.yml --profile warehouse --profile
streaming --profile etl --profile dataquality down`. Add `-v` to also drop the data volumes.

## Services, ports, profiles

| Service | Profile | Host port(s) | Purpose | License |
|---------|---------|--------------|---------|---------|
| `warehouse-clickhouse` | `warehouse` | **8124** (HTTP SQL), **9001** (native TCP) | Columnar analytics warehouse — what BI/PowerBI + dbt read. **Distinct** from `langfuse-clickhouse` (own name/volume/ports). | Apache-2.0 |
| `redpanda` | `streaming` | **19092** (Kafka API), **9644** (admin), **18083** (schema registry) | Kafka-API broker, single container, lighter than Kafka. | BSL / permissive single-node |
| `airbyte-db` | `etl` | — (internal) | Airbyte's own Postgres (config + jobs). | PostgreSQL |
| `airbyte-temporal` | `etl` | — (internal) | Airbyte's own Temporal (sync workflows) — separate from the `agents` Temporal. | MIT |
| `airbyte-server` | `etl` | **8005** (API) | Airbyte core API. | ELv2 |
| `airbyte-worker` | `etl` | — (internal; mounts host docker.sock) | Runs connector containers + CDC. | ELv2 |
| `airbyte-webapp` | `etl` | **8006** (UI) | Airbyte console → `OFFGRID_AIRBYTE_URL`. | ELv2 |
| `airbyte-connector-builder-server` | `etl` | — (internal) | Low-code connector builder backend. | ELv2 |
| `great-expectations` | `dataquality` | **8003** | Data-quality checkpoint sidecar (mirrors evidently/ragas). | Apache-2.0 |

**Lake landing zone:** the existing **SeaweedFS** S3 (`:8333`, `data` profile) — no new object store.
Airbyte's S3 destination targets bucket `offgrid-lake` (endpoint `http://<host>:8333`, path-style).

**dbt:** not a container — a job/CLI against `warehouse-clickhouse`. See `../dbt/README.md`.

### Port-collision check (why these ports)

Data-plane ports are deliberately shifted off defaults so nothing clashes with the existing stack:
`warehouse-clickhouse` uses **8124/9001** (not 8123/9000, which langfuse-clickhouse/Marquez-adjacent
ranges touch), Redpanda's Kafka API is on **19092**, Airbyte API/UI on **8005/8006** (not 8001,
which the evidently sidecar-adjacent range uses; Superset is 8088, FleetDM 8070), GE on **8003**
(drift 8001, ragas 8002 — the sidecar series continues cleanly).

## How the console will point at it (env — DO NOT set live yet)

Add to the console's `.env.local` on S1 **only when the data plane is live and reachable**. Since
S2/the data host is on the LAN (which the SSH-launched `next-server` on S1 can't reach directly due
to macOS Local-Network privacy — see SERVICE_MAP.md), front each on the **edge Caddy** at a
`127.0.0.1:894x` loopback (same pattern as g6's Langfuse/Unleash/Superset) and point the env at the
loopback. Suggested loopback map (stage in the Caddyfile, then reload): 8941 warehouse · 8942
Airbyte · 8943 Redpanda-admin · 8944 great-expectations.

```bash
# Placeholders — do NOT commit real values; set on the server .env.local when live.
OFFGRID_WAREHOUSE_URL=http://127.0.0.1:8941      # → S2 warehouse-clickhouse :8124 (HTTP SQL)
OFFGRID_WAREHOUSE_USER=warehouse                 # dev cred — rotate for prod
OFFGRID_WAREHOUSE_PASSWORD=warehouse             # dev cred — rotate for prod
OFFGRID_AIRBYTE_URL=http://127.0.0.1:8942        # → S2 airbyte-webapp :8006 (API/UI)
OFFGRID_REDPANDA_ADMIN_URL=http://127.0.0.1:8943 # → S2 redpanda :9644 (admin/metrics)
OFFGRID_REDPANDA_BROKERS=192.168.1.60:19092      # Kafka API (broker; direct if reachable)
OFFGRID_DATAQUALITY_URL=http://127.0.0.1:8944    # → S2 great-expectations :8003
```

## First-run setup (after bringup)

- **Airbyte:** open `http://<host>:8006`, complete the first-run workspace setup, then add a source
  (e.g. a seeded BFSI Postgres data-source container) + the SeaweedFS S3 / warehouse-clickhouse
  destination. CDC uses Debezium under the Postgres source connector.
- **warehouse-clickhouse:** create the analytics schema/tables dbt will populate — `dbt run` from
  `../dbt` handles this once `profiles.yml` points at `:8124`.
- **great-expectations:** health `curl http://<host>:8003/` → `{"status":"ok"}`. It runs the
  dependency-free fallback validator until the console's data-quality adapter wires the GE engine.
- **Redpanda:** `docker compose exec redpanda rpk cluster health` should report `Healthy: true`.

## Guardrails carried from the control plane

Same peripheries govern data-movement as model-access (per PLATFORM.md): data-allowlist ceiling,
OPA policy, PII redaction on the sync path, data-quality evals (Great Expectations), lineage
(Marquez), audit. Those live in the console + S1 control plane; this runbook only stands up the
engines they drive.

## Seed data (BFSI demo)

A large, realistic **Indian BFSI** demo dataset lives in the ClickHouse warehouse under the
`bfsi` database. It exists so the platform has genuine enterprise data to be intelligent about
(analytics, governance/redaction, evals). All PANs / account numbers are synthetic but
format-valid — treat them as sensitive.

**Load / reload it:**

```bash
node deploy/onprem/seed-warehouse.mjs
```

Targets ClickHouse HTTP via env (defaults shown): `WAREHOUSE_URL=http://192.168.1.60:8124`,
`WAREHOUSE_USER=warehouse`, `WAREHOUSE_PASS=warehouse`. Point `WAREHOUSE_URL` at
`http://127.0.0.1:8124` to run it from the S1 loopback. No external deps — Node stdlib + global
`fetch` only.

**Idempotent + deterministic:** it `CREATE TABLE IF NOT EXISTS`es the star schema (MergeTree),
`TRUNCATE`s each table before loading, and generates rows from a **seeded PRNG** — so every run
produces the exact same data. Bulk-loads via `INSERT ... FORMAT JSONEachRow` in 5k-row batches,
then verifies `count()` per table and exits non-zero on any mismatch.

**Schema + row counts (`bfsi.*`):**

| table              | rows    | notes                                                                    |
|--------------------|---------|--------------------------------------------------------------------------|
| `dim_customer`     | 20,000  | PAN, name, gender, dob (`Date32`), city/state, segment, kyc_status       |
| `dim_branch`       | 600     | IFSC, real bank names (HDFC/ICICI/SBI/Axis/Kotak/PNB/…)                   |
| `dim_product`      | 33      | savings/current/credit_card/loans/term_deposit/life+health insurance     |
| `fact_account`     | 50,000  | account_no, balance_inr, status, → customer/product/branch               |
| `fact_transaction` | 600,000 | ts over last ~18 months, amount_inr, channel (UPI/NEFT/…), ~0.5% flagged |
| `fact_loan`        | 15,000  | principal/roi/emi, dpd, status (active/closed/npa)                       |
| `fact_claim`       | 8,000   | claim_amount_inr, status, reason                                         |
| `fact_kyc_event`   | 30,000  | event_type (onboard/re_kyc/…), outcome (pass/fail/manual)                |

Realism: currency INR; PAN `[A-Z]{5}[0-9]{4}[A-Z]`; IFSC `[A-Z]{4}0[A-Z0-9]{6}`; Indian
names/cities/states; log-normal amount/balance distributions; realistic status/DPD/claim mixes.

---

## Live pipeline (corebank → warehouse) — Airbyte, verified 2026-07-08

**Real, working Airbyte 0.63.15 ELT pipeline** pulling BFSI OLTP data from the corebank Postgres
source into the ClickHouse warehouse — Glue/DMS-style movement, end-to-end, with real rows landed.

### What exists (Airbyte config API at `http://192.168.1.60:8005`, workspace `d98a7b4c-ef87-4c5a-872a-47c8e027f127`)

| object       | id                                     | detail                                                     |
|--------------|----------------------------------------|------------------------------------------------------------|
| Source       | `a6491583-c787-4c08-bc21-d5a683dfdaba` | Postgres 3.6.13 → corebank (see host note below)           |
| Destination  | `220b7042-834c-45cb-84cd-162b36d75296` | ClickHouse 1.0.0 → db `bfsi_raw`, warehouse/warehouse      |
| Connection   | `39895f80-ce6f-4cc0-8c2e-be2a4ffd3034` | corebank → warehouse (BFSI raw), manual schedule           |

Both `check_connection` calls **succeeded**. Streams synced: **customers, accounts, transactions**.

### Sync mode: Incremental | cursor (append_dedup), cursor+PK = `id`

**NOT CDC.** corebank Postgres has `wal_level = replica`, so logical replication / Debezium is
impossible. Fallback = Standard replication + **Incremental cursor** on the `id` primary key
(`destinationSyncMode: append_dedup`). To enable CDC later: set `wal_level=logical` on corebank
and recreate the source with `replication_method.method = CDC`.

### Sync result (job id 1) — VERIFIED

Terminal status **succeeded**, attempt 0, **76,573 records committed** — matching source exactly.
Rows physically in ClickHouse (query `http://192.168.1.60:8124/?user=warehouse&password=warehouse`):

| ClickHouse table                                    | rows   |
|-----------------------------------------------------|--------|
| `airbyte_internal.bfsi_raw_raw__stream_customers`   | 7,400  |
| `airbyte_internal.bfsi_raw_raw__stream_accounts`    | 9,973  |
| `airbyte_internal.bfsi_raw_raw__stream_transactions`| 59,200 |

Real Indian BFSI payloads land in `_airbyte_data` (PAN, masked Aadhaar, IFSC, UPI, RTGS/NEFT, INR).
NOTE: the v1.0.0 ClickHouse connector landed the **raw** layer (`airbyte_internal.*`) but did NOT
materialize typed/final tables under `bfsi_raw.*` (typing-and-deduping limitation of that connector
version). The raw JSON is complete and queryable; parse with `JSONExtract(_airbyte_data, ...)` or
upgrade the connector for typed tables.

### Infra fixes required to make Airbyte functional on S2 (all applied, persistent)

These were broken before this run — Airbyte could not launch a single connector. Fixed in
`/Users/admin/offgrid/console/deploy/docker-compose.yml` on S2 (backup: `docker-compose.yml.bak.airbytefix`):

1. **Connector images missing** — pulled `airbyte/source-postgres:3.6.13` and
   `airbyte/destination-clickhouse:1.0.0` on S2 (`docker pull`).
2. **Worker had no Docker socket permission** — worker ran as uid 1000 but the mounted
   `/var/run/docker.sock` is `root:root 660` → every connector launch failed "Could not find
   image". Fix: added `user: root` to the `airbyte-worker` service.
3. **Wrong workspace volume name** — `WORKSPACE_DOCKER_MOUNT: airbyteworkspace` was unprefixed;
   compose actually creates `offgrid-console_airbyteworkspace`, so connectors mounted an empty
   volume → `NoSuchFileException: source_config.json`. Fix: set
   `WORKSPACE_DOCKER_MOUNT: offgrid-console_airbyteworkspace`.
   After 2+3: `docker compose --profile all up -d --no-deps airbyte-worker`.

4. **OrbStack containers can't reach the physical LAN** — Airbyte connectors run with
   `--network host`, and neither host- nor bridge-network OrbStack containers on S2 can reach
   `127.0.0.1:5433` (corebank on S1). Fix: a **TCP relay on the S2 host** forwards
   `0.0.0.0:15433 → 127.0.0.1:5433`; containers reach it via `host.docker.internal`.
   - Relay script: `deploy/onprem/corebank-relay.py` (on S2 at same path).
   - launchd service: `~/Library/LaunchAgents/local.offgrid.corebank-relay.plist`
     (`RunAtLoad`+`KeepAlive`, log `/tmp/corebank-relay.log`), loaded via `launchctl load`.
   - Hence the **Source host = `host.docker.internal`, port `15433`** (NOT 127.0.0.1:5433).
   - The ClickHouse **Destination** host is likewise `host.docker.internal:8124` (the S2
     host-mapped HTTP port), NOT the docker-network name `warehouse-clickhouse:8123`, for the same
     host-network reachability reason.

### Re-trigger a sync

```bash
# fire a sync
curl -s -X POST http://192.168.1.60:8005/api/v1/connections/sync \
  -H 'Content-Type: application/json' \
  -d '{"connectionId":"39895f80-ce6f-4cc0-8c2e-be2a4ffd3034"}'
# poll (use the returned job id)
curl -s -X POST http://192.168.1.60:8005/api/v1/jobs/get \
  -H 'Content-Type: application/json' -d '{"id":<JOB_ID>}'
# verify landed rows
curl -s "http://192.168.1.60:8124/?user=warehouse&password=warehouse" \
  --data-binary "SELECT count() FROM airbyte_internal.bfsi_raw_raw__stream_customers"
```

Prereq for any sync: the corebank relay launchd job must be running on S2
(`launchctl list | grep corebank-relay`; log at `/tmp/corebank-relay.log`).
