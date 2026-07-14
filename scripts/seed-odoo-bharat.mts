// ─── Odoo ERP demo seed for the Bharat Union bank tenant (org_bharat / bharatunion) ───────────────
//
// Declares a REAL Odoo connector ("Bharat Union ERP (Odoo)", type `odoo`) plus the Indian-BFSI data
// domains that bind to its models, so the bank tenant's builder can ground answers — cross-sell
// holdings, KYC contacts, a customer's ledger — in live ERP records via the JSON-RPC dialect wired in
// connector-exec.ts. If the Odoo box is unreachable the exec layer returns null and callers record an
// HONEST miss (never a fabricated row) — this seed only DECLARES the source + bindings.
//
// WHY .mts (not .mjs) + DB-direct: this seed must write under a SPECIFIC org (org_bharat). The admin
// HTTP routes resolve the org from the caller's session/token (currentOrgId), so they can't be aimed
// at an arbitrary tenant. The canonical multi-tenant seeds (seed-demo-tenants.mts, seed-data-
// domains.mts) therefore go DB-direct with an explicit orgId — this mirrors them exactly. Type-
// stripped .mts lets it import the TS store; a .mjs file could not, and would silently target the
// wrong org. Idempotent: connectors matched by NAME, domains by LABEL — a re-run creates nothing new.
//
// HOW TO RUN (from the console dir, with .env.local / .env.production loaded):
//   npm run seed:odoo-bharat
//   OFFGRID_ODOO_ENDPOINT='odoo://svc_reader:PW@erp.internal:8069/bharatprod' npm run seed:odoo-bharat
//
// ON THE SERVER (git is dead there — rsync the source, then per DEPLOY.md call node by absolute path):
//   /usr/local/bin/node --experimental-strip-types scripts/seed-odoo-bharat.mts   (or `npm run seed:odoo-bharat`)
//
// IMPORT ORDER IS LOAD-BEARING: worker-env.mts MUST be first so .env.* is loaded before @/db builds
// its pg Pool (see scripts/app-worker.mts for the rationale).

import './worker-env.mts';
import { createConnector, listConnectors } from '../src/lib/store.ts';
import { createDomain, listDomains } from '../src/lib/data-domains-store.ts';

const log = (...a: unknown[]) => console.log('[seed:odoo-bharat]', ...a);

// The bank tenant. org_bharat is the Bharat Union bank org (slug bharatunion). Overridable for reuse.
const ORG_ID = process.env.OFFGRID_ODOO_ORG || 'org_bharat';

// The Odoo connector this seed declares. The endpoint is the operator-facing odoo:// URI (login in
// userinfo; the PASSWORD is the vaulted secret, resolved at query time — the DSN carries no live
// password here). Overridable via env for a real instance; the default is an on-prem LAN placeholder.
const ODOO_CONNECTOR = {
  name: 'Bharat Union ERP (Odoo)',
  type: 'odoo',
  endpoint: process.env.OFFGRID_ODOO_ENDPOINT || 'odoo://svc_reader@127.0.0.1:8069/bharatprod',
  description:
    '[live-query] Bharat Union ERP on Odoo — system of record for customer contacts, CRM leads and ' +
    'accounting entries. Bound to data domains for cross-sell, KYC and ledger grounding. Amounts in ₹.',
};

// The Indian-BFSI data domains, each bound to a real Odoo model. Labels/aliases are chosen so the
// bank's plain-language descriptions resolve cleanly. The EXACT label `cross-sell-holdings` maps to
// res.partner (the customer/contact master — where holdings and relationships live in Odoo).
const ODOO_DOMAINS = [
  {
    label: 'cross-sell-holdings',
    aliases: ['cross sell', 'existing holdings', 'customer holdings', 'product holdings', 'relationship'],
    resource: 'res.partner',
    opHints: { limit: 25 },
  },
  {
    label: 'kyc-contacts',
    aliases: ['kyc', 'customer contacts', 'contact details', 'onboarding contact', 'partner'],
    resource: 'res.partner',
    opHints: { limit: 25 },
  },
  {
    label: 'sales-pipeline',
    aliases: ['crm leads', 'opportunities', 'leads', 'pipeline', 'prospects'],
    resource: 'crm.lead',
    opHints: { limit: 25 },
  },
  {
    label: 'customer-ledger',
    aliases: ['ledger', 'journal entries', 'accounting entries', 'account moves', 'statements'],
    resource: 'account.move',
    opHints: { limit: 25 },
  },
];

const norm = (s: string) => s.trim().toLowerCase();

async function main(): Promise<void> {
  log(`org=${ORG_ID} endpoint=${ODOO_CONNECTOR.endpoint}`);

  // 1. Connector (idempotent by NAME — the store mints ids, name is the stable key).
  const existingConnectors = await listConnectors(ORG_ID);
  let connector = existingConnectors.find((c) => norm(c.name) === norm(ODOO_CONNECTOR.name));
  if (!connector) {
    connector = await createConnector({
      name: ODOO_CONNECTOR.name,
      type: ODOO_CONNECTOR.type,
      endpoint: ODOO_CONNECTOR.endpoint,
      description: ODOO_CONNECTOR.description,
      orgId: ORG_ID,
      custom: true,
    });
    log(`+ connector "${connector.name}" (${connector.type}) → ${connector.id}`);
  } else {
    log(`= connector "${connector.name}" present → ${connector.id}`);
  }

  // 2. Domains (idempotent by LABEL — a duplicate label makes the resolver ambiguous). Every domain
  //    binds to the REAL connector id above; we never fabricate a binding.
  const existingDomains = await listDomains(ORG_ID);
  const haveLabels = new Set(existingDomains.map((d) => norm(d.label)));
  for (const d of ODOO_DOMAINS) {
    if (haveLabels.has(norm(d.label))) {
      log(`= domain "${d.label}" present`);
      continue;
    }
    const created = await createDomain(
      { label: d.label, connectorId: connector.id, resource: d.resource, aliases: d.aliases, opHints: d.opHints },
      ORG_ID,
    );
    log(`+ domain "${created.label}" → ${connector.id}:${d.resource}`);
  }

  log('done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed:odoo-bharat] FAILED:', err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  });
