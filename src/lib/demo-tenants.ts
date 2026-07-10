// The two PUBLIC read-only demo tenants and the links that point a visitor at them. PURE (zero I/O)
// so the "which slug, what URL, is this href safe" rules are one source of truth, unit-testable, and
// shared (DRY) between the landing "See it live" CTA and any other surface that deep-links a demo.
//
// Each demo tenant is a real provisioned tenant on its own subdomain (see tenant-domain.ts):
//   bank    → bharatunion  → https://bharatunion-onprem-console.getoffgridai.co
//   insurer → suraksha     → https://suraksha-onprem-console.getoffgridai.co
// The "See it live" CTA must DEEP-LINK the console overview, not the bare host, so the visitor lands
// inside the console (the tenant root itself redirects to /overview via middleware, but linking the
// full path is explicit and survives if that redirect ever changes).

import { tenantUrl } from '@/lib/tenant-domain';

/** A public read-only demo tenant. `kind` labels it for the landing copy (bank vs insurer). */
export interface DemoTenant {
  slug: string;
  /** Display name for the CTA/label. */
  name: string;
  /** The industry framing shown to a visitor. */
  kind: 'bank' | 'insurer';
}

// The canonical list. Order is the display order on the landing.
export const DEMO_TENANTS: readonly DemoTenant[] = [
  { slug: 'bharatunion', name: 'Bharat Union Bank', kind: 'bank' },
  { slug: 'suraksha', name: 'Suraksha Life', kind: 'insurer' },
] as const;

/** True when the slug is one of the public demo tenants. */
export function isDemoTenantSlug(slug: string | null | undefined): boolean {
  return typeof slug === 'string' && DEMO_TENANTS.some((t) => t.slug === slug);
}

/**
 * The console URL a "See it live" CTA points at: the tenant's own host, DEEP-LINKED to /overview so
 * the visitor arrives inside the console (not on a bare host that momentarily 302s). Built from the
 * shared tenantUrl host helper (DRY) with no trailing slash before the path.
 */
export function consoleUrl(slug: string): string {
  return `${tenantUrl(slug)}/overview`;
}

/**
 * Resolve a SAFE href for a demo tenant's "See it live" CTA. Returns the /overview deep-link only for
 * a known demo slug whose derived URL is a well-formed https URL on the tenant apex; anything else
 * returns null so a caller never emits a link to an unknown or malformed host. Pure + defensive: this
 * is what the landing renders into an anchor, so it must never produce an off-suite or broken URL.
 */
export function demoTenantHref(slug: string | null | undefined): string | null {
  if (!isDemoTenantSlug(slug)) return null;
  const href = consoleUrl(slug as string);
  try {
    const u = new URL(href);
    const okHost = u.hostname === 'getoffgridai.co' || u.hostname.endsWith('.getoffgridai.co');
    if (u.protocol === 'https:' && okHost && u.pathname === '/overview') return href;
  } catch {
    /* not a URL — fall through to null */
  }
  return null;
}
