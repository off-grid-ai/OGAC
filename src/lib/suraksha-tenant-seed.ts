// ─── Suraksha Life demo-tenant seed (fictional Indian LIFE INSURER, org_suraksha) ────────────────
//
// THE GOAL: give the insurer use cases (#207) a tenant whose IDENTITY reads as a life insurer, not a
// bank. The existing demo tenant `bharatunion` (org_bharat) reads like a union bank; Suraksha is a life
// insurer, so the 15 use cases (FNOL/death claims, policy lapse/reinstatement, underwriting,
// persistency, KYC, pricing) belong in an insurer. This declares the SECOND demo tenant — "Suraksha
// Life" (org_suraksha) — its life-insurer connectors, and its data-domains, framed as an insurer's
// book (policies, premiums, claims, advisors, KYC) plus the insurer use-case domains.
//
// SOLID: PURE DATA + PURE PLANNERS (zero I/O, zero store imports). A seed script / POST route injects
// the current tenant/connector/domain rows and drives the planners idempotently. Mirrors
// data-domains-insurer-seed.ts EXACTLY (deterministic ids, LABEL-based idempotency, "never bind to a
// missing connector"). Indian BFSI values (INR, PAN, IFSC, Indian names) live in the SOURCE data the
// connectors point at (seeded on the live data plane — see deploy/onprem, WAREHOUSE_DB=suraksha).

// ─── Tenant identity ─────────────────────────────────────────────────────────────────────────────
export interface TenantSpec {
  id: string;
  name: string;
  slug: string;
  plan: string;
  enabledModules: string[];
}

// A tenant's id IS its org_id (see tenancy-policy.ts). Deterministic (not the random org_<hex> that
// createTenant mints) so the seed is idempotent and the connectors/domains below can reference it.
export const SURAKSHA_TENANT: TenantSpec = {
  id: 'org_suraksha',
  name: 'Suraksha Life',
  slug: 'suraksha',
  plan: 'enterprise',
  // Mirror the modules a full BFSI demo tenant needs (same set bharatunion runs).
  enabledModules: [
    'gateway',
    'pipelines',
    'studio',
    'brain',
    'data',
    'governance',
    'insights',
    'access',
    'regulatory',
    'finops',
  ],
};

// ─── Connectors (the life-insurer source systems this tenant governs) ─────────────────────────────
// Deterministic ids (`surcon_*`), scoped to org_suraksha. Insurer-framed display names — the console
// UI shows these, so they carry the insurer identity. They point at the demo containers/warehouse the
// connector-query tool executes against at run time (postgres/mysql), mirroring the bharatunion
// `bhcon_*` connectors. Endpoints are the demo containers' (same convention as the existing seed).
export interface ConnectorSpec {
  id: string;
  name: string;
  type: 'postgres' | 'mysql' | 's3' | 'rest';
  endpoint: string;
  auth: string;
  description: string;
  status: string;
}

export const SUR_COREINS = 'surcon_coreins'; // Core Insurance (policies/premiums/claims) — Postgres
export const SUR_POLICYADMIN = 'surcon_policyadmin'; // Policy Admin & HR (advisors/candidates) — MySQL
export const SUR_WAREHOUSE = 'surcon_warehouse'; // Analytics warehouse (object store)

export const SURAKSHA_CONNECTORS: ConnectorSpec[] = [
  {
    id: SUR_COREINS,
    name: 'Core Insurance (Postgres)',
    type: 'postgres',
    // Isolated per-tenant database `suraksha` on the SHARED Postgres server (same box as bharatunion's
    // corebank, separate DB) — so the insurer's book never collides with the bank tenant's rows.
    // Seeded by deploy/onprem/seed-suraksha-dataplane.mjs.
    endpoint: 'postgres://corebank@127.0.0.1:5433/suraksha',
    auth: 'password',
    description: 'Policy administration OLTP — policies, premiums, claims, KYC, pricing.',
    status: 'connected',
  },
  {
    id: SUR_POLICYADMIN,
    name: 'Advisor & HR Admin (MySQL)',
    type: 'mysql',
    // Isolated per-tenant schema `suraksha` on the SHARED MySQL server (same box as bharatunion's
    // policyadmin, separate schema). Seeded by deploy/onprem/seed-suraksha-dataplane.mjs.
    endpoint: 'mysql://policyadmin@127.0.0.1:3307/suraksha',
    auth: 'password',
    description: 'Advisor/agency force + HR — advisors, requisitions, candidates, reimbursement quota.',
    status: 'connected',
  },
  {
    id: SUR_WAREHOUSE,
    name: 'Data Warehouse',
    type: 's3',
    endpoint: 'http://127.0.0.1:9010',
    auth: 'none',
    description: 'Analytics warehouse for the Suraksha Life book.',
    status: 'connected',
  },
];

// ─── Data-domains (the life-insurer book + the insurer use-case tools) ─────────────────────────────────
// LABEL/ALIAS chosen to match how a non-technical author phrases each tool in plain English. Each
// binds to a connector + the resource table connector-exec queries at run time.
export interface DomainSpec {
  label: string;
  aliases: string[];
  connectorId: string;
  resource: string;
  useCase: string;
  opHints?: Record<string, unknown>;
}

export const SURAKSHA_DOMAINS: DomainSpec[] = [
  // ── The insurer's core book ──
  {
    label: 'policies',
    aliases: ['policy', 'life policies', 'in-force policies', 'policy records', 'the policy'],
    connectorId: SUR_COREINS,
    resource: 'policies',
    useCase: 'Core book — policy admin',
    opHints: { limit: 25 },
  },
  {
    label: 'premiums',
    aliases: ['premium', 'premium payments', 'premium ledger', 'premium history'],
    connectorId: SUR_COREINS,
    resource: 'premiums',
    useCase: 'Core book — persistency/collections',
    opHints: { limit: 25 },
  },
  {
    label: 'claims',
    aliases: ['claim', 'death claims', 'claim register', 'fnol', 'first notice of loss'],
    connectorId: SUR_COREINS,
    resource: 'claims',
    useCase: 'Core book — claims/FNOL',
    opHints: { limit: 25 },
  },
  {
    label: 'advisors',
    aliases: ['advisor', 'agents', 'agency force', 'distributors', 'the advisor'],
    connectorId: SUR_POLICYADMIN,
    resource: 'advisors',
    useCase: 'Core book — distribution',
    opHints: { limit: 25 },
  },
  {
    label: 'kyc documents',
    aliases: ['kyc', 'kyc docs', 'know your customer', 'identity documents', 'kyc document'],
    connectorId: SUR_COREINS,
    resource: 'kyc_documents',
    useCase: 'Core book — onboarding/KYC',
    opHints: { limit: 20 },
  },
  // ── insurer use-case tools (reframed for the insurer) ──
  {
    label: 'reimbursement quota',
    aliases: ['reimbursement limit', 'expense quota', 'employee quota', 'reimbursement entitlement', 'my quota'],
    connectorId: SUR_POLICYADMIN,
    resource: 'employee_quota',
    useCase: '#1 Reimbursement approval',
    opHints: { limit: 20 },
  },
  {
    label: 'pricing rfq',
    aliases: ['quote request', 'pricing quote request', 'rfq', 'group pricing request', 'quote requests'],
    connectorId: SUR_COREINS,
    resource: 'pricing_rfq',
    useCase: '#2 Actuarial OYRT pricing',
    opHints: { limit: 20 },
  },
  {
    label: 'pricing rate card',
    aliases: ['rate card', 'pricing checklist', 'premium rates', 'pricing model rates'],
    connectorId: SUR_COREINS,
    resource: 'pricing_rate_card',
    useCase: '#2 Actuarial OYRT pricing',
    opHints: { limit: 40 },
  },
  {
    label: 'helpdesk cases',
    aliases: ['ps helpdesk', 'helpdesk mailbox', 'support cases', 'service requests', 'helpdesk case'],
    connectorId: SUR_COREINS,
    resource: 'helpdesk_cases',
    useCase: '#3 Central Ops helpdesk',
    opHints: { limit: 20 },
  },
  {
    label: 'job requisitions',
    aliases: ['open roles', 'job openings', 'requisitions', 'vacancies', 'job requisition'],
    connectorId: SUR_POLICYADMIN,
    resource: 'job_requisitions',
    useCase: '#7 HR CV screening',
    opHints: { limit: 20 },
  },
  {
    label: 'candidates',
    aliases: ['cvs', 'resumes', 'applicants', 'candidate resumes', 'candidate'],
    connectorId: SUR_POLICYADMIN,
    resource: 'candidates',
    useCase: '#7 HR CV screening',
    opHints: { limit: 30 },
  },
  {
    label: 'competitor intel',
    aliases: ['competitor products', 'competitive intelligence', 'competitor data', 'market intel', 'competitor insight'],
    connectorId: SUR_COREINS,
    resource: 'competitor_products',
    useCase: '#13 Product competitive-intel',
    opHints: { limit: 20 },
  },
  {
    label: 'claim documents',
    aliases: ['claim docs', 'claim paperwork', 'claim files', 'claim document'],
    connectorId: SUR_COREINS,
    resource: 'claim_documents',
    useCase: '#4 Claims doc assessment',
    opHints: { limit: 20 },
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// IDEMPOTENT SEED PLANNERS (pure). Given the current rows, decide what to create — safe to re-run.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Tenant: create iff no tenant already has this org id OR slug (a tenant's id is its org_id). */
export function planSurakshaTenant(
  existingTenants: readonly { id: string; slug?: string | null }[],
): { create: TenantSpec | null; present: boolean } {
  const idTaken = existingTenants.some((t) => t.id === SURAKSHA_TENANT.id);
  const slugTaken = existingTenants.some(
    (t) => (t.slug ?? '').trim().toLowerCase() === SURAKSHA_TENANT.slug,
  );
  if (idTaken || slugTaken) return { create: null, present: true };
  return { create: SURAKSHA_TENANT, present: false };
}

/** Connectors: create the ones whose deterministic id isn't already present for the org. */
export function planSurakshaConnectors(
  existingConnectors: readonly { id: string }[],
): { toCreate: ConnectorSpec[]; present: ConnectorSpec[] } {
  const have = new Set(existingConnectors.map((c) => c.id));
  const toCreate: ConnectorSpec[] = [];
  const present: ConnectorSpec[] = [];
  for (const c of SURAKSHA_CONNECTORS) (have.has(c.id) ? present : toCreate).push(c);
  return { toCreate, present };
}

export interface DomainPlan {
  toCreate: Array<{ label: string; aliases: string[]; connectorId: string; resource: string; opHints?: Record<string, unknown> }>;
  present: DomainSpec[]; // same LABEL already exists — left as-is (label idempotency)
  unbacked: DomainSpec[]; // backing connector not present for the org — skipped, never fabricated
}

/**
 * Domains: mirror planEyDomains — (1) match by LABEL (case-insensitive) so a re-run creates nothing
 * new; (2) create a domain ONLY if its backing connector exists (existing rows + the connectors this
 * same seed is creating this run), else skip as 'unbacked' — never bind to a fabricated connector.
 */
export function planSurakshaDomains(
  existingDomains: readonly { label: string }[],
  existingConnectors: readonly { id: string }[],
  domains: readonly DomainSpec[] = SURAKSHA_DOMAINS,
): DomainPlan {
  const haveLabels = new Set(existingDomains.map((d) => d.label.trim().toLowerCase()));
  // A domain is "backed" if its connector already exists OR is being created by this same seed run.
  const connectorIds = new Set<string>([
    ...existingConnectors.map((c) => c.id),
    ...SURAKSHA_CONNECTORS.map((c) => c.id),
  ]);
  const plan: DomainPlan = { toCreate: [], present: [], unbacked: [] };
  for (const d of domains) {
    if (haveLabels.has(d.label.toLowerCase())) {
      plan.present.push(d);
      continue;
    }
    if (!connectorIds.has(d.connectorId)) {
      plan.unbacked.push(d);
      continue;
    }
    plan.toCreate.push({
      label: d.label,
      aliases: d.aliases,
      connectorId: d.connectorId,
      resource: d.resource,
      opHints: d.opHints,
    });
  }
  return plan;
}
