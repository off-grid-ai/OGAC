# Fleet reorganisation runbook — 4 service nodes, s1 as control plane only

**Written 2026-08-05, measured live. Not yet executed.** Downtime is acceptable (founder's call);
**data loss is not** — several volumes hold demo data curated the same day.

## Why

All 54 service containers ran on TWO machines while three sat empty:

| node | containers | pressure |
|---|---|---|
| s1 | 26 | 10 MB free, 1.70 GB compressed — **and it is the control plane**; builds OOM here and took the investor-facing console down twice |
| g6 | 28 | 5.31 GB OrbStack at **58% CPU**, 1.91 GB compressed — busiest machine in the fleet |
| g1 / g3 / g5 | 0 | idle |

Every node is 16 GB / 8 cores. **CPU is comfortable everywhere (load 1.1–2.3 of 8); RAM is the binding
constraint.** So this is a placement problem, not a capacity problem.

Already done: g5 reclaimed (~6 GB) by unloading `co.getoffgridai.gateway` +
`co.getoffgridai.g5-model-bridge` and killing the desktop app's `llama-server`, which had 4.95→6.11 GB
resident for a model nothing routed to. g1 recovered by the founder.

## Target

**s1 = control plane ONLY**: console (`next start`), its Postgres, Redis cache, the workers, the two
aggregators. Nothing else. It is the only machine that must stay responsive for the console itself.

**Four service nodes:**

| node | stack | notes |
|---|---|---|
| g5 | `services-node-c.yml` — OpenSearch, Marquez (+db, +web), OpenBao, +2 | **The file already exists in the fleet repo and was written for g5.** Never executed. Moved FROM s1. |
| g3 | new `services-node-d.yml` — Airbyte ×5 (+db), Kestra (+postgres), Great Expectations | Moved FROM g6, the most loaded node |
| g1 | new `services-node-e.yml` — the 6 demo datasources, Evidently, LLM Guard, Ragas, classifiers | Moved FROM s1 / g6 |
| g6 | keep `services-node-b.yml` minus what moves — Langfuse ×6, ClickHouse warehouse, Redpanda, Presidio ×3, Superset, Unleash | Heaviest stateful stays put; nothing gained by moving Langfuse's 6-container stack |

## The two things that make this dangerous

**1. Named volumes do not travel with a container.** A `docker compose down` on the source and `up` on
the target gives you an EMPTY service. Volumes that must migrate:

- `offgrid-services-a_openbaodata` → **holds the connector credentials vaulted on 2026-08-05.** Move it
  without the volume and every connector on both tenants breaks.
- `offgrid-services-a_marquezdb` → the lineage the audit called genuinely strong (54 jobs / 100 datasets
  / 160 edges). Re-seeding is not equivalent.
- `offgrid-services-a_opensearch` → the audit index the SIEM/audit-search surfaces read.
- `offgrid-data-sources_{corebank,crm,erp,kafka,minio,policyadmin}` → the demo data the apps query.
- `offgrid-console_pgdata` → **the whole console database. DO NOT MOVE IT.** It stays on s1 with the
  console; moving it buys nothing and risks everything.

Per-volume procedure, in this order — never stop the source before the target is verified:

```
# on the SOURCE node
docker compose -f <stack>.yml stop <service>
docker run --rm -v <volume>:/from -v "$PWD":/to alpine tar czf /to/<volume>.tgz -C /from .
scp <volume>.tgz admin@offgrid-<target>.local:~/
# on the TARGET node
docker volume create <volume>
docker run --rm -v <volume>:/to -v "$HOME":/from alpine tar xzf /from/<volume>.tgz -C /to
docker compose -f <stack>.yml up -d <service>
# VERIFY the service answers with its data present, THEN remove the source
```

**2. The console cannot reach LAN peers directly.** macOS Local Network privacy blocks it, which is why
g6's services are only reachable through `co.getoffgridai.g6-datastore-bridge` (`g6-datastore-bridge.rb`
in the fleet repo) port-forwarding from s1. **Each new service node needs its own bridge** — g5, g3 and
g1 do not have one. Copy the g6 bridge plist + rb, change the host and port list, `launchctl bootstrap`.
Without this, moving a service to g3 makes it invisible to the console even though the container is
healthy.

## Also required after the moves

- **Connector endpoints.** The demo datasources are addressed as `postgres://…@127.0.0.1:5433/…`
  (loopback on s1). Moving them to g1 means updating `connectors.endpoint` to the new host, or every
  connector fails. The credential is already vaulted, so only the host/port changes.
- **Console env** (`.env.local` on s1) — `OFFGRID_OPENSEARCH_URL`, `OFFGRID_MARQUEZ_URL`,
  `OFFGRID_OPENBAO_*` etc. must point at the new bridge ports.
- **`fleet_nodes`** — g1/g3/g5 were set to `role='server'` with an empty model on 2026-08-05, which is
  correct for service hosts; leave them that way.
- **Re-verify after each stage**: connectors test green, lineage graph populated, audit search returns
  rows, a governed app run completes. A green container is not a working service.

## Order of execution (lowest risk first)

1. **g3 ← Airbyte + Kestra + GX from g6.** Relieves the 58%-CPU node. Only two small DBs to migrate.
2. **g5 ← OpenSearch + Marquez + OpenBao from s1** using the existing `services-node-c.yml`. Do OpenBao
   LAST and verify a connector test immediately after.
3. **g1 ← demo datasources + stateless sidecars from s1.** Update connector endpoints in the same stage.
4. Confirm s1 holds only console + Postgres + Redis + workers + aggregators, and re-measure all five.
