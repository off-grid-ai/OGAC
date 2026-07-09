#!/usr/bin/env node
// Emit idempotent SQL that declares the "Suraksha Life" demo tenant (a fictional Indian LIFE INSURER,
// org_id = org_suraksha) in the console Postgres: the tenant row, its life-insurer connectors, and its
// data-domains. This is the CONSOLE-DB foundation for the insurer use cases (#207) — it gives the 15 cases a
// tenant whose identity reads as an insurer, not the bank-flavoured `bharatunion`.
//
// Usage (on S1, git is broken → apply via the pg client, per deploy/DEPLOY.md § Database migrations):
//   node deploy/onprem/seed-suraksha-console.mjs | \
//     docker exec -i <pg> psql -U offgrid -d offgrid_console
//   (or pipe into the `pg` one-liner in DEPLOY.md)
//
// MUST stay in sync with src/lib/suraksha-tenant-seed.ts (SURAKSHA_TENANT / SURAKSHA_CONNECTORS /
// SURAKSHA_DOMAINS). Idempotent: deterministic ids + ON CONFLICT upserts, safe to re-run.
//
// SOURCE DATA (the rows the connector-query tools resolve against at run time) is a separate
// live-data-plane step: reuse deploy/onprem/seed-insurer-usecases.mjs with WAREHOUSE_DB=suraksha and the
// coreins/policyadmin container endpoints — the tables (policies/premiums/claims/pricing_rfq/…) are
// already the Suraksha use-case tables. This script only seeds the console DB.

const ORG = 'org_suraksha';

const TENANT = {
  id: ORG,
  name: 'Suraksha Life',
  slug: 'suraksha',
  plan: 'enterprise',
  enabledModules: [
    'gateway', 'pipelines', 'studio', 'brain', 'data',
    'governance', 'insights', 'access', 'regulatory', 'finops',
  ],
};

const CONNECTORS = [
  { id: 'surcon_coreins', name: 'Core Insurance (Postgres)', type: 'postgres', endpoint: 'postgres://corebank:corebank@127.0.0.1:5433/suraksha', auth: 'password', description: 'Policy administration OLTP — policies, premiums, claims, KYC, pricing.', status: 'connected' },
  { id: 'surcon_policyadmin', name: 'Advisor & HR Admin (MySQL)', type: 'mysql', endpoint: 'mysql://policyadmin:policyadmin@127.0.0.1:3307/suraksha', auth: 'password', description: 'Advisor/agency force + HR — advisors, requisitions, candidates, reimbursement quota.', status: 'connected' },
  { id: 'surcon_warehouse', name: 'Data Warehouse', type: 's3', endpoint: 'http://127.0.0.1:9010', auth: 'none', description: 'Analytics warehouse for the Suraksha Life book.', status: 'connected' },
];

// slug → domain (label/aliases/connector/resource/opHints). Mirrors SURAKSHA_DOMAINS.
const DOMAINS = [
  { slug: 'policies', label: 'policies', aliases: ['policy', 'life policies', 'in-force policies', 'policy records', 'the policy'], connectorId: 'surcon_coreins', resource: 'policies', opHints: { limit: 25 } },
  { slug: 'premiums', label: 'premiums', aliases: ['premium', 'premium payments', 'premium ledger', 'premium history'], connectorId: 'surcon_coreins', resource: 'premiums', opHints: { limit: 25 } },
  { slug: 'claims', label: 'claims', aliases: ['claim', 'death claims', 'claim register', 'fnol', 'first notice of loss'], connectorId: 'surcon_coreins', resource: 'claims', opHints: { limit: 25 } },
  { slug: 'advisors', label: 'advisors', aliases: ['advisor', 'agents', 'agency force', 'distributors', 'the advisor'], connectorId: 'surcon_policyadmin', resource: 'advisors', opHints: { limit: 25 } },
  { slug: 'kyc_documents', label: 'kyc documents', aliases: ['kyc', 'kyc docs', 'know your customer', 'identity documents', 'kyc document'], connectorId: 'surcon_coreins', resource: 'kyc_documents', opHints: { limit: 20 } },
  { slug: 'reimbursement_quota', label: 'reimbursement quota', aliases: ['reimbursement limit', 'expense quota', 'employee quota', 'reimbursement entitlement', 'my quota'], connectorId: 'surcon_policyadmin', resource: 'employee_quota', opHints: { limit: 20 } },
  { slug: 'pricing_rfq', label: 'pricing rfq', aliases: ['quote request', 'pricing quote request', 'rfq', 'group pricing request', 'quote requests'], connectorId: 'surcon_coreins', resource: 'pricing_rfq', opHints: { limit: 20 } },
  { slug: 'pricing_rate_card', label: 'pricing rate card', aliases: ['rate card', 'pricing checklist', 'premium rates', 'pricing model rates'], connectorId: 'surcon_coreins', resource: 'pricing_rate_card', opHints: { limit: 40 } },
  { slug: 'helpdesk_cases', label: 'helpdesk cases', aliases: ['ps helpdesk', 'helpdesk mailbox', 'support cases', 'service requests', 'helpdesk case'], connectorId: 'surcon_coreins', resource: 'helpdesk_cases', opHints: { limit: 20 } },
  { slug: 'job_requisitions', label: 'job requisitions', aliases: ['open roles', 'job openings', 'requisitions', 'vacancies', 'job requisition'], connectorId: 'surcon_policyadmin', resource: 'job_requisitions', opHints: { limit: 20 } },
  { slug: 'candidates', label: 'candidates', aliases: ['cvs', 'resumes', 'applicants', 'candidate resumes', 'candidate'], connectorId: 'surcon_policyadmin', resource: 'candidates', opHints: { limit: 30 } },
  { slug: 'competitor_intel', label: 'competitor intel', aliases: ['competitor products', 'competitive intelligence', 'competitor data', 'market intel', 'competitor insight'], connectorId: 'surcon_coreins', resource: 'competitor_products', opHints: { limit: 20 } },
  { slug: 'claim_documents', label: 'claim documents', aliases: ['claim docs', 'claim paperwork', 'claim files', 'claim document'], connectorId: 'surcon_coreins', resource: 'claim_documents', opHints: { limit: 20 } },
];

function q(s) { return `'${String(s).replace(/'/g, "''")}'`; }
function jb(o) { return `${q(JSON.stringify(o))}::jsonb`; }

const lines = [];
lines.push('BEGIN;');
lines.push('-- Suraksha Life demo tenant (org_suraksha) — idempotent, deterministic ids.');
lines.push(
  `INSERT INTO tenants (id, name, slug, plan, enabled_modules, created_at) VALUES (` +
    `${q(TENANT.id)}, ${q(TENANT.name)}, ${q(TENANT.slug)}, ${q(TENANT.plan)}, ${jb(TENANT.enabledModules)}, now()) ` +
    `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, plan = EXCLUDED.plan, ` +
    `enabled_modules = EXCLUDED.enabled_modules;`,
);
lines.push('-- Life-insurer connectors for org_suraksha.');
for (const c of CONNECTORS) {
  lines.push(
    `INSERT INTO connectors (id, org_id, name, type, endpoint, auth, description, custom, status) VALUES (` +
      `${q(c.id)}, ${q(ORG)}, ${q(c.name)}, ${q(c.type)}, ${q(c.endpoint)}, ${q(c.auth)}, ${q(c.description)}, false, ${q(c.status)}) ` +
      `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, endpoint = EXCLUDED.endpoint, ` +
      `auth = EXCLUDED.auth, description = EXCLUDED.description, status = EXCLUDED.status;`,
  );
}
lines.push('-- Data-domains (life-insurer book + insurer use-case tools) for org_suraksha.');
for (const d of DOMAINS) {
  const id = `surdom_${d.slug}`;
  lines.push(
    `INSERT INTO data_domains (id, org_id, label, aliases, connector_id, resource, op_hints, created_at, updated_at) VALUES (` +
      `${q(id)}, ${q(ORG)}, ${q(d.label)}, ${jb(d.aliases)}, ${q(d.connectorId)}, ${q(d.resource)}, ${jb(d.opHints)}, now(), now()) ` +
      `ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, aliases = EXCLUDED.aliases, ` +
      `connector_id = EXCLUDED.connector_id, resource = EXCLUDED.resource, op_hints = EXCLUDED.op_hints, updated_at = now();`,
  );
}
lines.push('COMMIT;');
process.stdout.write(lines.join('\n') + '\n');
