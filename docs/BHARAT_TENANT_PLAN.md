# Bharat Union Bank tenant — seed + fix-everything plan

**Goal:** stand up a second tenant (fictional Indian bank **Bharat Union Bank + NBFC**, slug
`bharatunion`) loaded with as much realistic **Indian BFSI** data as possible, and use it as the
honest end-to-end proof that every console surface actually works. Fix every functionality +
usability gap AND the big unbuilt integrations, verifying each against this tenant.

**Decided (2026-07-07):** scope = *everything incl. Temporal durable runs + cloud-provider routing*;
tenant = Bharat Union Bank + NBFC (retail banking + NBFC lending + general insurance); access =
tenant-admin user **and** membership-checked subdomain host→org scoping (fixes gap S2).

## Two data layers (both must be seeded)
1. **Source systems** (real bank records) — the on-prem data-source containers: corebank (Postgres
   :5433), policyadmin (MySQL :3307), erp (MSSQL :1433), CRM (REST :8090). Volume, Indian BFSI:
   ~5k customers (Indian names, PAN, masked Aadhaar, IFSC, UPI), ~12k accounts, ~8k loans, ~3k
   motor/health claims, ~50k transactions in ₹, branches, employees, KYC records.
2. **Console entities scoped to the new org** — connectors→those sources, data-domains, governed
   apps, agents, knowledge collections+docs, prompts, evals+golden cases, app/agent runs, audit,
   FinOps usage, fleet devices. All carry `org_id = <bharatunion org id>`.

## Phases
- **A — Tenant + access (prereq).** Create org+slug `bharatunion`; seed a tenant-admin user whose
  session org = that org; wire middleware host→org scoping with a **membership check** (gap S2).
- **B — Seed (volume).** Idempotent scripts: source-system bank data, then the tenant's console
  entities. Verify counts.
- **C — Fix functionality gaps** (parallel worktree agents, disjoint files): Brain ingest 500 (S1),
  Guardrails→Presidio (V1/#2), SIEM index (V2/#6), storage share-expiry + nested-key, policy
  decision read-back, Fleet MDM adapter, vector-inspector label, DSAR erasure propagation.
- **D — Big integrations:** Temporal durable agent runs (#12); cloud-provider model routing (#26).
- **E — Usability:** no-modals conversion (#10), uniform loaders, device-enroll docs (#88), backups
  run/restore (#20), Superset dashboard (#9).
- **F — Verify end-to-end** as the tenant; flip `VERIFICATION_GAPS.md` rows to 🟢 with evidence.

## Execution model
Worktree-isolated agents ~3–5 at a time on DISJOINT file-sets. Each lands → merge gate (typecheck +
tests + **local prod build**) → deploy to fleet → verify live against the tenant → next. Seeding runs
alongside (DB only, no code conflict). Honest gate: nothing "done" until verified live.

## Ledgers
Findings + status: `docs/VERIFICATION_GAPS.md` (S1–S3, V1–V4) and `docs/GAPS_BACKLOG.md`.

## Data plane seeded + wired (2026-07) — VERIFIED LIVE

The bharatunion tenant now has a real BFSI warehouse + governed catalog, verified against live infra.

**Warehouse (ClickHouse `192.168.1.60:8124`), DB `bharatunion`** — seeded by the parameterized
`deploy/onprem/seed-warehouse.mjs` (`WAREHOUSE_DB=bharatunion node deploy/onprem/seed-warehouse.mjs`;
default `WAREHOUSE_DB=bfsi` leaves the generic seed intact). Deterministic + idempotent. Counts:
dim_customer 20000, dim_branch 600, dim_product 33, fact_account 50000, fact_transaction 600000,
fact_loan 15000, fact_claim 8000, fact_kyc_event 30000. Appears automatically in /data/warehouse +
Query console (the ClickHouse adapter lists all non-system DBs).

**Governed catalog (console Postgres `data_assets` + `data_classifications`, org_id=`org_bharat`)** —
seeded by `deploy/onprem/seed-bharat-catalog.mjs` (emits idempotent SQL: deletes existing
warehouse-source org_bharat assets, re-inserts with deterministic da_/dc_ ids). 8 assets (one per
warehouse table, source='warehouse', connector_id='bhcon_warehouse') + 19 classifications. Sensitivity:
dim_customer restricted (PAN/PERSON/DOB/LOCATION), fact_account restricted (account_no), fact_claim
confidential (MEDICAL reason), fact_transaction/fact_loan internal, dim_product/dim_branch public.

**Connector**: reused the existing `bhcon_warehouse` (type s3, "Warehouse Object Store") — org_bharat
already had 5 connectors + 6 pipelines; nothing duplicated.

**Live tenant analytics proof** (FROM bharatunion.*):
- Flagged txns by channel: UPI 1326, POS 398, ATM 339, NEFT 324, IMPS 320, branch 203, cheque 89.
- NPA loans by product: auto_loan 378 (₹51.44 Cr), home_loan 354 (₹265.03 Cr), personal_loan 348 (₹38.96 Cr).

Re-run safe: re-running either seed produces identical rows; `bfsi` (600k txns) untouched.
Code left uncommitted for review: `seed-warehouse.mjs` (parameterization), `seed-bharat-catalog.mjs` (new).
