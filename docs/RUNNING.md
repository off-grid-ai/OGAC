# Running the full 5-layer stack

One canonical compose runs **every layer at once**, so a single command stands up the whole
agentic control plane locally. Profiles let you run a subset; `--profile all` runs everything.

## Prerequisites

- Docker (OrbStack / Docker Desktop) running.
- The **Off Grid AI Gateway** on `127.0.0.1:7878` (first-party — runs separately, not in compose).
- Node 20+ and Postgres reachable (the compose includes Postgres, or use your own).

## One command — the whole stack

```bash
cd deploy
make full        # = docker compose --profile all up -d   (24 services, all 5 layers)
make smoke       # health-check every service
make ps          # status
make down        # stop (keeps volumes)
```

Then point the console at it — copy `deploy/.env.example` → `../.env.local`, and run the console
(`npm run dev`). **Admin → Integrations · adapters** shows every capability's live health.

## What comes up, by layer

| Plane                 | Services (profile)                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------- |
| **Data**              | Postgres + pgvector, SeaweedFS (`data`) · Qdrant (`ai`)                                  |
| **Control**           | OPA (`policy`), Keycloak (`identity`), OpenBao (`secrets`), Unleash (`flags`)            |
| **AI**                | (gateway external) · Presidio (`guardrails`) · Langfuse (`llmops`) · Temporal (`agents`) |
| **Regulatory**        | OpenLineage + Marquez (`lineage`) · OpenSearch SIEM (`siem`)                             |
| **Consumption / Ops** | OTel + VictoriaMetrics/Logs (`observability`) · Redis cache (`caching`)                  |

## Run a subset (variants derive from this one file)

```bash
make data secrets observability     # lean: state + secrets + telemetry
make policy identity                # just the control-plane governance tools
docker compose --profile guardrails --profile lineage up -d   # any combination
```

Each profile maps 1:1 to a capability, so you bring up exactly what a deployment licensed. The
**same file** is the source for every variant (lean / enterprise / air-gapped) — never hand-roll
a second compose.

## Wiring the console to it

Each `OFFGRID_ADAPTER_<CAPABILITY>` env var flips a capability from its first-party default to the
OSS backend (`.env.example` lists them all). The console works with **zero** OSS up — every
capability has a first-party default; the stack just adds scale/depth.

## Ports

| Service                 | Host port   |     | Service                  | Host port   |
| ----------------------- | ----------- | --- | ------------------------ | ----------- |
| Postgres                | 5432        |     | OPA                      | 8181        |
| OpenBao                 | 8200        |     | Keycloak                 | 8080        |
| VictoriaMetrics         | 8428        |     | Presidio (analyzer/anon) | 5002 / 5001 |
| VictoriaLogs            | 9428        |     | Qdrant                   | 6333        |
| OTel Collector          | 4317 / 4318 |     | SeaweedFS (S3)           | 8333        |
| Marquez (api / web)     | 9000 / 3001 |     | Langfuse                 | 3030        |
| Temporal (server / ui)  | 7233 / 8081 |     | Redis                    | 6379        |
| OpenSearch (api / dash) | 9200 / 5601 |     | Unleash                  | 4242        |
| Jaeger (trace UI)       | 16686       |     |                          |             |

All images permissive-licensed — see `LICENSES.md`. Production hardening (TLS, real secrets, pinned
tags, backups) is in `OPERATIONS.md §9`.
