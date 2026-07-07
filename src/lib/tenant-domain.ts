// Client-safe tenant subdomain helpers — PURE, zero imports (no db/server code), so both the browser
// (AddTenantButton, admin table) and the server (store, middleware) can use them. Each tenant gets
// its own subdomain: <slug>.onprem-console.getoffgridai.co.

// The apex the console is served under. Override per-deploy via NEXT_PUBLIC_TENANT_BASE_DOMAIN.
export const TENANT_BASE_DOMAIN =
  process.env.NEXT_PUBLIC_TENANT_BASE_DOMAIN ?? 'onprem-console.getoffgridai.co';

// Derive a URL-safe subdomain handle: lowercase, alphanumerics only, capped. The UI suggests this
// and lets the operator edit it (e.g. "Wednesday Solutions" → "wednesdaysolutions", shortenable to
// "wednesdaysol"). Empty string if nothing usable remains.
export function slugifyTenant(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
}

// The tenant's full workspace URL from its slug.
export function tenantUrl(slug: string): string {
  return `https://${slug}.${TENANT_BASE_DOMAIN}`;
}

// The host label shown in the UI (no scheme), e.g. "wednesdaysol.onprem-console.getoffgridai.co".
export function tenantHost(slug: string): string {
  return `${slug}.${TENANT_BASE_DOMAIN}`;
}
