// Client-safe tenant subdomain helpers — PURE, zero imports (no db/server code), so both the browser
// (AddTenantButton, admin table) and the server (store, middleware) can use them. Each tenant gets
// its own subdomain: <slug>.onprem-console.getoffgridai.co.

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
