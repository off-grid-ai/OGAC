# Off Grid AI — Data plane: AWS-parity through open source

> **The thesis:** the entire AWS data stack, matched feature-for-feature by best-of-breed open
> source, unified under one governed control plane, running on the enterprise's own infrastructure.
> No lock-in, no data leaving the perimeter — every connector, query, sync, and CDC stream governed
> by the same policy / redaction / audit / lineage spine as model access. Enterprises keep the
> systems they already run; we work with them as-is.

Runtime + bringup: [`../../deploy/onprem/DATA_PLANE.md`](../../deploy/onprem/DATA_PLANE.md).
Platform model: [`PLATFORM.md`](./PLATFORM.md).

## The parity map

| AWS service | What it does | Off Grid engine (OSS, governed) | Status (2026-07-08) |
|---|---|---|---|
| **Glue** | Managed ETL + 300+ connectors + visual jobs | **Airbyte** (connectors + low-code builder) + **dbt** (transforms) | ✅ live on S2 |
| **Glue Data Catalog / Crawler** | Discover + catalog table schemas | ClickHouse `system.tables` + console data catalog (M4) | ✅ live |
| **Athena** | Serverless SQL over the lake | **ClickHouse** read-only SQL (+ `s3()`/`file()` over the lake) | ✅ query API live; lake-Parquet next |
| **DMS** | Database migration + CDC replication | **Debezium** (via Airbyte source connectors) | ✅ engine live; live corebank→warehouse pipeline being wired |
| **Redshift** | Cloud data warehouse | **ClickHouse** (columnar MPP) | ✅ live, 600k-row BFSI dataset seeded |
| **Kinesis / MSK** | Streaming / event bus | **Redpanda** (Kafka API) | ✅ live |
| **S3** | Object store / data lake | **SeaweedFS** (S3-compatible) | ✅ live (`data` profile) |
| **Parquet** | Columnar lake file format | ClickHouse native Parquet r/w + SeaweedFS lake | ⏳ warehouse adapter extension |
| **DataBrew** | Data quality / profiling | **Great Expectations** | ✅ live on S2 |
| **Glue Studio (visual)** | Drag-drop / plain-language pipeline authoring | Console builder — describe in English, wire the governed pipeline | ⏳ empowerment epic (#199) |

## Why one control plane over OSS beats the cloud stack
- **Sovereign:** every engine runs on the enterprise's own hardware (on-prem fleet); data never leaves the perimeter.
- **Governed uniformly:** a data sync is a *pipeline* — same peripheries as a model call (data-allowlist ceiling, OPA/ABAC policy, PII redaction on the sync path, data-quality evals, lineage, audit, replay). No separate, ungoverned ETL tool.
- **No lock-in:** permissive OSS; the moat is ownership + air-gap + the governance spine, not proprietary formats.
- **Works with existing systems as-is:** Airbyte's connector breadth + CDC means we pull from the databases, warehouses, and SaaS an enterprise already runs — they change nothing.

## Data governance ON the movement path (redaction, masking, quality)
A sync is a pipeline, so data movement carries the **same peripheries as model access** — governance
is applied *as data moves*, before it lands in the warehouse:
- **PII redaction on the sync path** — the **same Presidio engine** that redacts model I/O detects +
  redacts/masks PII (PAN, Aadhaar, account numbers, names, emails, phones) in rows during transfer.
  Nothing sensitive reaches the warehouse un-redacted unless policy explicitly allows it.
- **Classification-driven column masking** — the M4 data-classification / masking-rules engine drives
  which columns are masked, hashed, tokenized, or dropped per their sensitivity label.
- **Data-allowlist ceiling** — a hard cap on which sources/tables/columns a pipeline may move at all.
- **Data-quality gate** — Great Expectations validates rows against expectations on the sync path; a
  failing batch can be blocked/quarantined rather than silently landing bad data.
- **Audit + lineage** — every sync emits into the spine (Marquez lineage, OpenSearch audit): what
  moved, from where, what was redacted, under which policy — replayable.

## The console surface (product language — OSS names never shown to end users)
The data engine is consumed by the console via ports-and-adapters (`src/lib/adapters/`), each reading
an `OFFGRID_*_URL` env and degrading gracefully when the engine is down:

| Adapter | Engine | Admin API routes |
|---|---|---|
| `warehouse.ts` | ClickHouse | `GET /api/v1/admin/warehouse` (catalog), `GET /warehouse/[table]` (detail), `POST /warehouse/query` (read-only SQL = "Query"/Athena) |
| `airbyte.ts` | Airbyte | `GET /api/v1/admin/etl` (connections/jobs), `POST /etl/sync` (trigger = "Data movement"/Glue/DMS) |
| `data-quality.ts` | Great Expectations | `GET /api/v1/admin/data-quality`, `POST /data-quality/run` (checkpoint = "Data quality") |

End-user labels: **Warehouse · Query · Data movement · Data quality · Streaming · Change capture** —
never "ClickHouse / Airbyte / Great Expectations / AWS". The AWS/OSS names here are the internal
parity target only.

## Seeded reference data
`deploy/onprem/seed-warehouse.mjs` loads a deterministic, idempotent Indian-BFSI star schema into
the `bfsi` database on ClickHouse (dim_customer 20k, dim_branch 600, dim_product 33, fact_account
50k, fact_transaction 600k, fact_loan 15k, fact_claim 8k, fact_kyc_event 30k) — valid PAN/IFSC,
Indian names/cities, INR amounts. This is the substance the console's Query/Catalog surfaces read.

_Last updated: 2026-07-08._
