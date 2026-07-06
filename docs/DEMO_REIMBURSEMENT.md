# Demo — Reimbursement Approval (the flagship use case)

The canonical Off Grid Console demo: a non-technical operator describes a real business process in
plain language and gets a **governed, runnable, multi-step app** — one that reads real enterprise
data through declared connectors, reasons over it, and pauses for a human to approve or reject.

> "Reimbursement approval — read the invoice, check the employee's quota, check if they've exceeded
> and are eligible, then approve or reject."

That description compiles to:

```
[connector-query: invoices] → [connector-query: reimbursement quota]
  → [agent: decide eligibility] → [human: approve / reject] → [output: record decision]
```

## Why the seed exists

For the compiler to bind those two data reads to real systems (and not fabricate a connector), the
org must have **declared where its data lives** — the connector rule engine's data-domains. The seed
declares those domains against the **real** on-prem data sources and drops a ready-made sample app so
the demo is clickable out of the box.

## The connectors (real — from `deploy/onprem/data-sources.yml`)

| Connector name                        | Dialect  | Endpoint (LAN, S1 = 127.0.0.1) | Backs                                   |
| ------------------------------------- | -------- | --------------------------------- | --------------------------------------- |
| Core Banking (Postgres)               | postgres | `127.0.0.1:5433`               | customers, policies, claims, transactions |
| Policy Admin (MySQL)                  | mysql    | `127.0.0.1:3307`               | branches, agents, commissions, **employee_quota** |
| Finance ERP (MSSQL)                   | mssql    | `127.0.0.1:1433`               | GL, **invoices**                        |
| CRM (REST)                            | rest     | `127.0.0.1:8090`               | accounts, opportunities, contacts       |
| Warehouse Object Store (S3/MinIO)     | s3       | `127.0.0.1:9010`               | warehouse / invoice archive             |

The seed never invents a connector: every one above is a real container in `data-sources.yml`.

## The data-domains the seed declares

Each domain is what a connector-query step binds to. Label → connector → resource:

| Domain label          | Aliases                                                   | Connector             | Resource         |
| --------------------- | -------------------------------------------------------- | --------------------- | ---------------- |
| `invoices`            | invoice, billing documents, invoice archive              | Finance ERP (MSSQL)   | `invoices`       |
| `reimbursement quota` | employee quota, expense limit, quota, employee reimbursement quota | Policy Admin (MySQL) | `employee_quota` |
| `transactions`        | payments, ledger, transaction history                    | Core Banking (Postgres) | `transactions` |
| `customer data`       | customers, accounts, contacts, crm                       | CRM (REST)            | `accounts`       |
| `claims`              | claim, insurance claims                                  | Core Banking (Postgres) | `claims`       |

The two the flagship needs are **`invoices`** and **`reimbursement quota`**. The description's
phrases ("the invoice", "the employee's quota") resolve to those domains deterministically via the
connector rule engine (`src/lib/data-domains.ts`) — no guessing.

> **On `employee_quota`:** the seed-corebank/policyadmin SQL does not yet create an `employee_quota`
> table; the demo reads it as a declared resource. Add it to `seed-policyadmin.sql` (or a follow-up
> seed) if you want live rows — until then the connector-query returns "no rows" honestly (it never
> fabricates a row). The governance/compile/run path is fully exercised regardless.

## Run the seed

### On the server (recommended for the live demo)

Deploy the source (rsync — git is dead on the server; see `deploy/DEPLOY.md`), then from the console
dir with the server's `.env.local` / `.env.production` loaded:

```bash
npm run seed:domains                          # default org, incl. the sample app
OFFGRID_SEED_ORG=<orgId> npm run seed:domains # a specific tenant
OFFGRID_SEED_SAMPLE_APP=0 npm run seed:domains # domains only, skip the sample app
```

The script is **idempotent** — connectors matched by name, domains by label, the sample app by
title. A second run creates only what's missing and prints what it skipped.

### Via the admin API (from a logged-in console / a service token)

```bash
curl -sX POST https://<console-host>/api/v1/admin/data-domains/seed \
  -H "authorization: Bearer $OFFGRID_ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"sampleApp": true}'
```

Response reports `{ connectors, domains, sampleApp }` including any `domains.unbacked` — domains
skipped because their backing connector wasn't found (never bound to a fake connector).

## The click-path (build → input → run → review → report)

1. **Build.** Open the builder, paste the reimbursement description, and compile. The connector-query
   steps bind to `invoices` + `reimbursement quota` (green, no gaps). Save the app — or just open the
   seeded **"Reimbursement Approval"** app.
2. **Input.** Trigger a run (on-demand) with an invoice reference / employee id.
3. **Run.** The executor reads the invoice, reads the quota, then the eligibility agent reasons over
   both (grounded), and the run **pauses** at the human step (`awaiting_human`).
4. **Review.** An approver sees the decision + the trace (which systems were read, the eligibility
   recommendation) and approves or rejects. The durable workflow resumes.
5. **Report.** The output step records the decision; the run trace is visible under app-runs / Reports.

## What's proven (and how)

`test/reimbursement-e2e.test.ts` exercises the whole path with the real seed and injected fakes (no
live DB/gateway):

- the reimbursement description **compiles** to a governed multi-step spec whose connector-query
  steps bind to the seeded `invoices` + `reimbursement quota` domains (not gaps);
- the seeded sample app **runs** step-by-step in order and **pauses** at the human gate;
- the seed planners are **idempotent** and **honest** — a domain whose connector is absent is
  skipped, never bound to a fabricated connector.

## Known seam (logged, not hidden)

The NL→AppSpec compiler emits connector-query steps with `domain = <domain id>`, but the runtime
executor re-resolves `step.domain` through the **label/alias** resolver — so a *compiled* spec's
steps would miss at run time unless the id equals a label. The seeded sample app sidesteps this by
storing the domain **label** in `step.domain` (resolves in both the compiler's binder and the
runtime). The compiled-path id/label mismatch is tracked in `docs/GAPS_BACKLOG.md` (#106-a).
