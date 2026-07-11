// Client-safe tenant subdomain helpers — PURE (no db/server code), so both the browser
// (AddTenantButton, admin table) and the server (store, middleware) can use them. Each tenant gets
// its own subdomain: <slug>.onprem-console.getoffgridai.co.
import { randomToken } from '@/lib/rand';

// The apex zone + the console host suffix. Each tenant gets a FIRST-LEVEL host
// "<slug>-onprem-console.getoffgridai.co" — first-level so the zone's universal *.getoffgridai.co
// TLS cert already covers it (a dotted <slug>.onprem-console.* would need a paid 2nd-level cert).
export const TENANT_APEX = process.env.NEXT_PUBLIC_TENANT_APEX ?? 'getoffgridai.co';
export const TENANT_HOST_SUFFIX = 'onprem-console'; // the console's own subdomain label
// Shown in the provision form as "…on getoffgridai.co".
export const TENANT_BASE_DOMAIN = TENANT_APEX;

// Derive a URL-safe subdomain handle: lowercase, alphanumerics only, capped. The UI suggests this
// and lets the operator edit it (e.g. "Wednesday Solutions" → "wednesdaysolutions", shortenable to
// "wednesdaysol"). Empty string if nothing usable remains.
export function slugifyTenant(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
}

// The host label shown in the UI (no scheme), e.g. "wednesdaysol-onprem-console.getoffgridai.co".
export function tenantHost(slug: string): string {
  return `${slug}-${TENANT_HOST_SUFFIX}.${TENANT_APEX}`;
}

// The tenant's full workspace URL from its slug.
export function tenantUrl(slug: string): string {
  return `https://${tenantHost(slug)}`;
}

// ─── Per-tenant GATEWAY hosts (PA-15) ─────────────────────────────────────────────────────────────
// The shared aggregator is "gateway.getoffgridai.co". A per-tenant provisioned gateway gets its OWN
// unguessable host: first 5 chars of the tenant slug + 5 random chars + "-gateway.<apex>", e.g.
// "bharak7x2p-gateway.getoffgridai.co". The tenant prefix keeps it recognisable; the random suffix
// makes it unguessable (so the endpoint isn't enumerable from the slug alone). PURE: the caller
// supplies the random part (see randomGatewaySuffix), so this is deterministic + unit-testable.
export const GATEWAY_HOST_SUFFIX = 'gateway'; // mirrors the shared gateway.<apex>

export function tenantGatewayHost(slug: string, randomSuffix: string): string {
  const prefix = slugifyTenant(slug).slice(0, 5);
  const rand = randomSuffix.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 5);
  return `${prefix}${rand}-${GATEWAY_HOST_SUFFIX}.${TENANT_APEX}`;
}

// Generate the 5-char random suffix for a tenant gateway host (lowercase alphanumerics). Impure
// (randomness) — kept separate from tenantGatewayHost so the host builder stays testable.
export function randomGatewaySuffix(): string {
  return randomToken(5, 'abcdefghijklmnopqrstuvwxyz0123456789');
}
