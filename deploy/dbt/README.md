# dbt — transforms on the warehouse (job/CLI, NOT a long-running container)

dbt is **not** a service. It runs as a short-lived job (CLI or one-shot container) against
`warehouse-clickhouse`, applies the SQL transforms in `models/`, then exits. So there is **no dbt
entry in `docker-compose.yml`** by design — adding a long-running dbt container would be wrong.

This directory is the starter scaffold: `dbt_project.yml` (project config) + `profiles.example.yml`
(connection template) + a `models/` placeholder. It is data-plane (S2) scaffolding — no app code.

## Run it (S2, once the `warehouse` profile is up)

dbt talks to ClickHouse via the community `dbt-clickhouse` adapter. Two ways to run:

### A) One-shot container (no local Python)

```bash
# from deploy/dbt on S2 (or anywhere that can reach warehouse-clickhouse):
docker run --rm \
  -v "$PWD":/usr/app -v "$PWD":/root/.dbt \
  -e DBT_CH_HOST=127.0.0.1 -e DBT_CH_PORT=8124 \
  -e DBT_CH_USER=warehouse -e DBT_CH_PASSWORD=warehouse \
  ghcr.io/dbt-labs/dbt-clickhouse:1.8.4 \
  run --profiles-dir /root/.dbt
```

### B) Local CLI

```bash
pip install dbt-clickhouse==1.8.4
cp profiles.example.yml ~/.dbt/profiles.yml   # then edit creds
dbt debug      # verify the warehouse-clickhouse connection
dbt run        # build the models
dbt test       # run schema/data tests
```

## Connection (matches the compose warehouse-clickhouse service)

| Setting  | Value (dev)          | Source |
|----------|----------------------|--------|
| host     | `127.0.0.1` (S2)     | compose `warehouse-clickhouse` |
| port     | `8124` (HTTP)        | compose port map `8124:8123` |
| user     | `warehouse`          | dev cred — NOT for production |
| password | `warehouse`          | dev cred — NOT for production |
| schema   | `offgrid_warehouse`  | compose `CLICKHOUSE_DB` |

Dev creds are placeholders. In production, source them from OpenBao / env — never commit real ones.

## How the console will point at it

dbt is a build step, not a runtime dependency of the console. The console reads the *result* tables
from the warehouse via `OFFGRID_WAREHOUSE_URL` (see `onprem/DATA_PLANE.md`). Scheduling a dbt run
(cron / Airbyte post-sync hook / a console-triggered job) is a later wiring task.
