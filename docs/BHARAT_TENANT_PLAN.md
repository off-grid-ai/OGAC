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
