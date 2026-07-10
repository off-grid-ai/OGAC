import { isViewer } from '@/lib/viewer-policy';

// Pure decision for the read-only-demo hellobar. ZERO IO — the reader below supplies env; the layout
// renders the returned model. Kept pure so the "when do we show it / what does it say" rule is
// unit-testable without React or a request.
//
// The banner surfaces the public read-only demo credentials so a visitor knows how to sign in, and a
// one-line note that this account can view everything but change nothing. Credentials come from env
// (never hardcoded) — an operator who does not set them gets a banner with no creds, which still
// explains the read-only mode.

export interface DemoBannerInput {
  role: string | null | undefined; // the resolved session role
  email: string | null | undefined; // OFFGRID_DEMO_VIEWER_EMAIL
  password: string | null | undefined; // OFFGRID_DEMO_VIEWER_PASSWORD
}

export interface DemoBannerModel {
  show: boolean; // render the hellobar at all (only for a viewer session)
  email: string | null; // the demo email to display, or null when unset
  password: string | null; // the demo password to display, or null when unset
  note: string; // the read-only explanation (brand voice: no em-dash/exclamation/curly quotes)
}

const clean = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length > 0 ? t : null;
};

// The read-only note. Single source of truth so the copy is asserted once.
export const DEMO_READONLY_NOTE =
  'Read-only demo. This account can view everything, including admin, but cannot make changes.';

/**
 * Decide the hellobar model. Shows ONLY for a viewer session (so an admin never sees it). Credentials
 * are passed through when present, else null. Pure — role + env in, model out.
 */
export function buildDemoBanner(input: DemoBannerInput): DemoBannerModel {
  const show = isViewer(input.role);
  return {
    show,
    email: clean(input.email),
    password: clean(input.password),
    note: DEMO_READONLY_NOTE,
  };
}

/**
 * The impure reader: resolve the hellobar model for a session role from process env. Thin — reads
 * the two env vars and delegates the decision to the pure builder.
 */
export function readDemoBanner(role: string | null | undefined): DemoBannerModel {
  return buildDemoBanner({
    role,
    email: process.env.OFFGRID_DEMO_VIEWER_EMAIL,
    password: process.env.OFFGRID_DEMO_VIEWER_PASSWORD,
  });
}

// ─── Signin-context variant ────────────────────────────────────────────────────────────────────────
// The authed console hellobar (above) is role-gated: it shows only for a VIEWER session. But the
// signin page is where a logged-OUT visitor needs the read-only credentials to sign in at all — there
// is no session yet, so role gating cannot apply. Instead the signin banner shows when the host is a
// demo tenant subdomain (so the creds only surface on the public demo, not a real tenant's signin) and
// the creds are configured in env. When the host is a demo tenant but the creds are unset, it still
// shows the read-only note (never crashing, just without creds). Same DemoBannerModel shape so the
// note copy is shared (DRY) with the authed hellobar.

export interface SigninDemoBannerInput {
  isTenantHost: boolean; // the request host is a demo tenant subdomain (from tenantSlugFromHost)
  email: string | null | undefined; // OFFGRID_DEMO_VIEWER_EMAIL
  password: string | null | undefined; // OFFGRID_DEMO_VIEWER_PASSWORD
}

/**
 * Decide the signin-page demo banner. Shows on a demo tenant host regardless of session (the visitor
 * is logged out). Credentials pass through when set, else null (note still shown). Pure.
 */
export function buildSigninDemoBanner(input: SigninDemoBannerInput): DemoBannerModel {
  return {
    show: input.isTenantHost,
    email: clean(input.email),
    password: clean(input.password),
    note: DEMO_READONLY_NOTE,
  };
}

/**
 * The impure reader for the signin banner: resolve the model from process env given whether the
 * request host is a demo tenant. Thin — reads the two env vars, delegates to the pure builder.
 */
export function readSigninDemoBanner(isTenantHost: boolean): DemoBannerModel {
  return buildSigninDemoBanner({
    isTenantHost,
    email: process.env.OFFGRID_DEMO_VIEWER_EMAIL,
    password: process.env.OFFGRID_DEMO_VIEWER_PASSWORD,
  });
}
