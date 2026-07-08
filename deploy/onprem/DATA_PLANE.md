# Off Grid — Data Plane runbook (S2)

The **data engine** — the second substrate alongside the model engine (the llama.cpp gateway
fleet). It is the warehouse + streaming + connectors/CDC + data-quality stack: **ClickHouse +
Redpanda + Airbyte + dbt + Great Expectations**. Platform vision: `../../docs/platform/PLATFORM.md`.

> STATUS: **STAGED, NOT LIVE.** The compose services + profiles + this runbook exist so the S2
> bringup is one command later. Nothing here is running yet; no console env var below is set live.
> The console adapters that consume these are a later wiring task.

## Where it runs — and a reconciliation note

The data plane is intended for **offgrid-s2** (`192.168.1.60`, 16GB M1) under Colima, kept OFF S1
so it never contends with the control plane. It is heavy — Airbyte alone is ~8 containers.

> ⚠️ **Reconcile before bringup:** `SERVICE_MAP.md` currently records S2 as *retired* (offline since
> a router reboot; the aux tier moved to **g6** `192.168.1.66`). This runbook assumes S2 is brought
> back for the data plane. **When you actually bring it up, first confirm which host is live** — if
> S2 stays retired, land the data plane on whatever 16GB+ node is designated and substitute its IP
> everywhere below. Update SERVICE_MAP.md § Nodes in the same commit that provisions it.

## Colima sizing (S2 is 16GB — memory-bounded)

Docker Desktop is not used on the fleet Macs; Colima provides the Docker runtime. Give it a bounded
slice of the 16GB so the host stays responsive (Airbyte + ClickHouse + Redpanda are hungry):

```bash
# On S2, once (persists across restarts):
colima start --cpu 4 --memory 10 --disk 60 --vm-type vz
# 10GB VM ceiling on a 16GB host: Airbyte working set (~4–6GB) + ClickHouse + Redpanda (capped 1G)
# fit; ~6GB left for macOS. If Airbyte syncs OOM, raise --memory to 12 and re-`colima start`.
docker context use colima   # ensure the docker CLI targets the Colima VM
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
