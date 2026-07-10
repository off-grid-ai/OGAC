// The public, read-only demo tenants a visitor can tour live from the landing page. This is the
// SINGLE SOURCE OF TRUTH for the "See it live" call-to-action: one entry per industry, the label a
// visitor recognises ("a bank" / "an insurer") and the verified public console URL. Both the hero
// CTA and the closing CTA read from here, so the copy and the destinations can never drift apart.
//
// Zero IO — pure data + a pure href validator, unit-testable. The URLs derive from the tenant slug
// (the same slug used across tour-demo-seed and the on-prem console hostnames), so a new demo tenant
// is one entry, not a hand-typed URL that can rot.
import { BHARAT_PROFILE, SURAKSHA_PROFILE, type TenantProfile } from '@/lib/tour-demo-seed';

/** The host suffix every on-prem demo console is published under. */
export const DEMO_HOST_SUFFIX = 'onprem-console.getoffgridai.co';

export interface DemoTenant {
  /** Stable id (the tenant slug) — used as a React key and a URL discriminator. */
  slug: string;
  /** Industry flavour, drives which prompt a visitor recognises. */
  flavour: 'bank' | 'insurer';
  /** The article-led noun for the CTA, e.g. "a bank". */
  industryLabel: string;
  /** The full CTA question, e.g. "Are you a bank?". */
  prompt: string;
  /** The tenant's display name, shown as the destination. */
  name: string;
  /** The verified public console URL (https, *.getoffgridai.co). */
  href: string;
}

// The public console URL for a demo tenant. Derived from the slug so it stays in lockstep with the
// on-prem hostnames (bharatunion-onprem-console…, suraksha-onprem-console…).
function consoleUrl(slug: string): string {
  return `https://${slug}-${DEMO_HOST_SUFFIX}/`;
}

function toDemoTenant(profile: TenantProfile, industryLabel: string, name: string): DemoTenant {
  return {
    slug: profile.slug,
    flavour: profile.flavour,
    industryLabel,
    prompt: `Are you ${industryLabel}?`,
    name,
    href: consoleUrl(profile.slug),
  };
}

// Bank first, insurer second — the paired CTA reads in that order on the page.
export const DEMO_TENANTS: readonly DemoTenant[] = [
  toDemoTenant(BHARAT_PROFILE, 'a bank', 'Bharat Union'),
  toDemoTenant(SURAKSHA_PROFILE, 'an insurer', 'Suraksha Life'),
];

/**
 * Guards a demo href before it is rendered as a link: it must be an absolute https URL on the
 * getoffgridai.co domain. A malformed or foreign URL returns null (the caller renders nothing)
 * rather than shipping a broken or off-domain link.
 */
export function demoTenantHref(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== 'getoffgridai.co' && !url.hostname.endsWith('.getoffgridai.co')) return null;
  return url.toString();
}
