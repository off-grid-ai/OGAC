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
