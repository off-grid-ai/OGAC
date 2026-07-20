// ─── Demo data-domain + sample-app seed (Builder Epic task #106 — flagship reimbursement path) ───
//
// THE GOAL: make the founder's canonical use case CLICKABLE end-to-end. A non-technical operator
// opens the builder, describes "reimbursement approval — read the invoice, check the employee's
// quota, decide eligibility, approve/reject", and it compiles to a GOVERNED multi-step app whose
// connector-query steps bind to REAL declared data-domains — then runs (pausing at the human gate).
//
// For that to work the org must have DECLARED where its data lives. This module declares sensible
// data-domains bound ONLY to connectors that actually exist in the on-prem fleet
// (`deploy/onprem/data-sources.yml` + the seed SQL). It NEVER invents a connector: every domain
// here points at one of the real seeded containers:
//
//   corebank    Postgres  :5433  customers, policies, claims, transactions
//   policyadmin MySQL     :3307  branches, agents, commissions   (+ employee_quota for the demo)
//   erp         MSSQL     :1433  GL, invoices
//   crm         REST      :8090  accounts, opportunities, contacts   (json-server)
//   minio       S3        :9010  warehouse / invoice archive object store
//
// SOLID: this module is PURE DATA + PURE BUILDERS (zero I/O, zero imports of the store). The seed
// entry points (`scripts/seed-data-domains.mts`, `POST /api/v1/admin/data-domains/seed`) inject the
// real store functions and drive these definitions idempotently. That keeps the "what to seed"
// (unit-testable here) separate from the "how to persist it" (thin I/O at the edges).
//
// HONESTY SEAM (why domains bind by LABEL, not id):
//   The NL→AppSpec compiler emits connector-query steps with `domain = <the resolved domain id>`.
//   The RUNTIME executor (app-run.ts) re-resolves `step.domain` through `resolveDomain`, which
//   matches on LABEL/ALIAS — NOT on id. So a spec whose step.domain is a raw id would MISS at run
//   time. The seeded SAMPLE app therefore stores the domain LABEL in `step.domain` (which resolves
//   both in the compiler's binder and the runtime resolver). The reimbursement-e2e test asserts
//   this end-to-end, and the ID-vs-label mismatch on the *compiled* path is logged as a gap
//   (docs/GAPS_BACKLOG.md #106-a) rather than hidden.

import type { AppSpec, AppStep, AppEdge } from '@/lib/app-model';
import { findEnterpriseSource } from '@/lib/enterprise-source-registry';

// ─── Connector shape the seed declares (subset of store.ts Connector) ────────────────────────────
// The store mints connector ids itself (con_<random>), so the seed matches an existing connector by
// NAME (stable, operator-visible), not by a fixed id. `key` is a local join key used only to bind a
// SEED_DOMAIN to its SEED_CONNECTOR within this module.
export interface SeedConnectorSpec {
  /** Local join key (NOT a DB id) — links a SEED_DOMAIN to this connector within the seed. */
  key: string;
  /** Stable, operator-visible name — the idempotency key against existing connectors. */
  name: string;
  /** Rule-engine dialect keyword (see connector-exec.detectDialect): postgres|mysql|mssql|rest. */
  type: string;
  /** Live endpoint on the on-prem LAN. Matches the ports in data-sources.yml. */
  endpoint: string;
  description: string;
}

// ─── Data-domain shape the seed declares (matches data-domains-store.CreateDomainInput) ───────────
export interface SeedDomainSpec {
  label: string;
  aliases: string[];
  /** Local join key of the SEED_CONNECTOR that backs this domain (resolved to a real id at seed time). */
  connectorKey: string;
  /** The table / bucket / path the domain reads. */
  resource: string;
  opHints?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// REAL seeded connectors — mirror deploy/onprem/data-sources.yml. Endpoints target the on-prem LAN
// host (S1 at 127.0.0.1) where the data-source containers run. NEVER add a connector here that
// isn't a real container in data-sources.yml.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const SEED_SOURCE_KEYS = ['corebank', 'policyadmin', 'erp', 'crm', 'minio'] as const;

const SEED_SOURCE_NAMES: Readonly<Record<(typeof SEED_SOURCE_KEYS)[number], string>> = {
  corebank: 'Core Banking (Postgres)',
  policyadmin: 'Policy Admin (MySQL)',
  erp: 'Finance ERP (MSSQL)',
  crm: 'CRM (REST)',
  minio: 'Warehouse Object Store (S3/MinIO)',
};

export const SEED_CONNECTORS: SeedConnectorSpec[] = SEED_SOURCE_KEYS.map((key) => {
  const source = findEnterpriseSource(key);
  return {
    key,
    name: SEED_SOURCE_NAMES[key],
    type: source.connectorType,
    endpoint: source.seedEndpoint,
    description: source.description,
  };
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DEMO data-domains — the org's declarations, each bound to a real connector above. These are what
// the compiler's connector-query steps bind against. Labels/aliases are chosen so the reimbursement
// description resolves cleanly (invoice → invoices; employee quota → reimbursement quota).
//
// NOTE on the ERP↔invoices binding: invoices live in the ERP (MSSQL GL) in this fleet; the S3/MinIO
// store is the *archive*. We bind "invoices" to the ERP (the system of record the demo reads) and
// keep MinIO available as a separate archive domain. Both are REAL connectors.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const SEED_DOMAINS: SeedDomainSpec[] = [
  {
    label: 'invoices',
    aliases: ['invoice', 'billing documents', 'invoice archive'],
    connectorKey: 'erp',
    resource: 'invoices',
    opHints: { limit: 20 },
  },
  {
    label: 'reimbursement quota',
    aliases: ['employee quota', 'expense limit', 'quota', 'employee reimbursement quota'],
    connectorKey: 'policyadmin',
    resource: 'employee_quota',
    opHints: { limit: 20 },
  },
  {
    label: 'transactions',
    aliases: ['payments', 'ledger', 'transaction history'],
    connectorKey: 'corebank',
    resource: 'transactions',
    opHints: { limit: 20 },
  },
  {
    label: 'customer data',
    aliases: ['customers', 'accounts', 'contacts', 'crm'],
    connectorKey: 'crm',
    resource: 'accounts',
    opHints: { limit: 20 },
  },
  {
    label: 'claims',
    aliases: ['claim', 'insurance claims'],
    connectorKey: 'corebank',
    resource: 'claims',
    opHints: { limit: 20 },
  },
  {
    label: 'loan accounts',
    aliases: ['loans', 'loan book', 'borrower accounts', 'delinquent accounts'],
    connectorKey: 'corebank',
    resource: 'accounts',
    opHints: { limit: 20 },
  },
  {
    label: 'repayment history',
    aliases: ['repayments', 'payment history', 'loan payments', 'dpd history'],
    connectorKey: 'corebank',
    resource: 'transactions',
    opHints: { limit: 20 },
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The canonical DEMO description + the ready-made sample AppSpec.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const REIMBURSEMENT_DESCRIPTION =
  "Reimbursement approval — read the invoice, check the employee's quota, " +
  'check if they have exceeded and are eligible, then approve or reject.';

// A ready-made "Reimbursement Approval" AppSpec so the demo has something clickable in the builder
// even before compiling. Its connector-query steps store the domain LABEL in `step.domain` (see the
// HONESTY SEAM note above) so they RESOLVE at run time via the label-matching resolver.
//
// orgId/ownerId are filled in by the seed entry point (the store mints the real id + slug).
export function buildReimbursementAppSpec(orgId: string, ownerId: string): AppSpec {
  const steps: AppStep[] = [
    {
      id: 's1',
      label: 'Read the invoice',
      kind: 'connector-query',
      domain: 'invoices', // LABEL — resolves at runtime
      op: 'read',
    },
    {
      id: 's2',
      label: "Check the employee's reimbursement quota",
      kind: 'connector-query',
      domain: 'reimbursement quota', // LABEL — resolves at runtime
      op: 'read',
    },
    {
      id: 's3',
      label: 'Decide eligibility',
      kind: 'agent',
      inlineAgent: {
        systemPrompt:
          'Given the invoice amount and the employee reimbursement quota, decide whether the ' +
          'employee is within quota and eligible for reimbursement. State the remaining quota and a ' +
          'clear eligible / not-eligible recommendation with reasoning.',
        grounded: true,
      },
    },
    { id: 's4', label: 'Approve or reject', kind: 'human' },
    { id: 's5', label: 'Record decision', kind: 'output', sink: 'console' },
  ];
  const edges: AppEdge[] = steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id }));

  return {
    id: '', // minted by the store
    orgId,
    ownerId,
    title: 'Reimbursement Approval',
    summary: REIMBURSEMENT_DESCRIPTION,
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps,
    edges,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// IDEMPOTENT SEED PLANNERS (pure) — given what ALREADY exists, decide what to create/update.
// The entry points inject the current rows; these deciders never touch I/O.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ExistingConnector {
  id: string;
  name: string;
}
export interface ExistingDomain {
  id: string;
  label: string;
}

export interface ConnectorPlan {
  toCreate: SeedConnectorSpec[];
  present: SeedConnectorSpec[]; // already exist (by name) — left as-is
}

// Decide which seed connectors are missing. Match by NAME (the store mints ids, so name is the
// stable idempotency key) — a connector already present is left untouched (we never clobber
// operator edits). Idempotent: a second run creates nothing.
export function planConnectors(existing: ExistingConnector[]): ConnectorPlan {
  const haveNames = new Set(existing.map((c) => c.name.trim().toLowerCase()));
  const toCreate: SeedConnectorSpec[] = [];
  const present: SeedConnectorSpec[] = [];
  for (const c of SEED_CONNECTORS) (haveNames.has(c.name.toLowerCase()) ? present : toCreate).push(c);
  return { toCreate, present };
}

export interface DomainPlan {
  /** Domains to create, each already resolved to a real connector id. */
  toCreate: Array<{ label: string; aliases: string[]; connectorId: string; resource: string; opHints?: Record<string, unknown> }>;
  present: SeedDomainSpec[]; // a domain with the same LABEL already declared — left as-is
  /** Domains skipped because their backing connector was not found (never bound to a missing/fake connector). */
  unbacked: SeedDomainSpec[];
}

// Decide which seed domains to create. Two honesty rules:
//   1. Match by LABEL (case-insensitive) — declaring "invoices" twice makes the resolver ambiguous
//      (returns null on a tie), so we never duplicate a label. Idempotent.
//   2. A domain is created ONLY if its backing connector actually exists (by name → real id). If the
//      connector is missing, the domain is 'unbacked' and SKIPPED — never bound to a fabricated id.
// `connectorsByName` maps a lower-cased connector name → its real DB id (built from what exists after
// connectors are seeded).
export function planDomains(
  existing: ExistingDomain[],
  connectorsByName: Map<string, string>,
): DomainPlan {
  const haveLabels = new Set(existing.map((d) => d.label.trim().toLowerCase()));
  const connKeyName = new Map(SEED_CONNECTORS.map((c) => [c.key, c.name.toLowerCase()]));
  const plan: DomainPlan = { toCreate: [], present: [], unbacked: [] };

  for (const d of SEED_DOMAINS) {
    if (haveLabels.has(d.label.toLowerCase())) {
      plan.present.push(d);
      continue;
    }
    const connName = connKeyName.get(d.connectorKey);
    const connectorId = connName ? connectorsByName.get(connName) : undefined;
    if (!connectorId) {
      plan.unbacked.push(d); // backing connector absent — skip, never fabricate a binding
      continue;
    }
    plan.toCreate.push({
      label: d.label,
      aliases: d.aliases,
      connectorId,
      resource: d.resource,
      opHints: d.opHints,
    });
  }
  return plan;
}

// Decide whether to create the sample app: only if no app with this exact title exists in the org.
export function shouldSeedSampleApp(existingTitles: string[], title = 'Reimbursement Approval'): boolean {
  const t = title.trim().toLowerCase();
  return !existingTitles.some((x) => x.trim().toLowerCase() === t);
}
