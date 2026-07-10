// The demo seed's PURE safety + tenant-identity logic — zero I/O, unit-testable, imported by the
// runner (scripts/seed-demo-tenants.mts). Isolated here so the load-bearing SAFETY rule (never write
// to `default`/`wednesdaysol`) and the bank/insurer identity mapping are tested WITHOUT running the
// I/O runner (which connects to the DB + process.exit on import).
import { type TenantProfile } from '@/lib/tour-demo-seed';
import { SEED_CONNECTORS, SEED_DOMAINS } from '@/lib/data-domains-demo-seed';
import { SURAKSHA_CONNECTORS, SURAKSHA_DOMAINS } from '@/lib/suraksha-tenant-seed';

/** The ONLY orgs the demo seed is ever allowed to write to. */
export const ALLOWED_ORGS: ReadonlySet<string> = new Set(['org_bharat', 'org_suraksha']);

/** Throws unless orgId is one of the two demo tenants — the seed must never touch default/wednesdaysol. */
export function assertAllowed(orgId: string): void {
  if (!ALLOWED_ORGS.has(orgId)) {
    throw new Error(`refusing to write to org "${orgId}" — only org_bharat/org_suraksha are permitted`);
  }
}

/** Modules every demo tenant runs (mirrors suraksha-tenant-seed's TenantSpec). */
export const MODULES: readonly string[] = [
  'gateway', 'pipelines', 'studio', 'brain', 'data', 'governance', 'insights', 'access', 'regulatory', 'finops',
];

export interface TenantConnector {
  id: string;
  name: string;
  type: string;
  endpoint: string;
  description: string;
}
export interface TenantIdentity {
  name: string;
  connectors: TenantConnector[];
}

/** Tenant display name + source connectors per flavour. Bank reuses the BFSI demo connectors; insurer
 *  the suraksha ones. PURE — the profile carries no name/modules, so this is the mapping. */
export function identity(profile: TenantProfile): TenantIdentity {
  if (profile.flavour === 'bank') {
    return {
      name: 'Bharat Union',
      connectors: SEED_CONNECTORS.map((c) => ({ id: c.key, name: c.name, type: c.type, endpoint: c.endpoint, description: c.description })),
    };
  }
  return {
    name: 'Suraksha Life',
    connectors: SURAKSHA_CONNECTORS.map((c) => ({ id: c.id, name: c.name, type: c.type, endpoint: c.endpoint, description: c.description })),
  };
}

export interface TenantDomain {
  label: string;
  aliases: string[];
  /** The connector KEY/id this domain binds to (resolved to a real connector id at write time). */
  connectorId: string;
  resource: string;
  opHints?: Record<string, unknown>;
}

/** The data-domains per flavour, keyed to the tenant's connectors. PURE. */
export function domainsFor(profile: TenantProfile): TenantDomain[] {
  return profile.flavour === 'bank'
    ? SEED_DOMAINS.map((d) => ({ label: d.label, aliases: d.aliases, connectorId: d.connectorKey, resource: d.resource, opHints: d.opHints }))
    : SURAKSHA_DOMAINS.map((d) => ({ label: d.label, aliases: d.aliases, connectorId: d.connectorId, resource: d.resource, opHints: d.opHints }));
}
