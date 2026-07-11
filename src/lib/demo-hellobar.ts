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
export function readDemoBanner(
  role: string | null | undefined,
  slug?: string | null | undefined,
): DemoBannerModel {
  // Resolve creds for THIS tenant (per-slug override → generic fallback) via the same resolver the
  // signin banner uses, so each tenant's in-app hellobar shows ITS OWN viewer login. (Previously this
  // read only the generic OFFGRID_DEMO_VIEWER_EMAIL, so every tenant showed whichever the generic pair
  // was set to — e.g. the bank's demo-bank@ on the insurer.)
  const creds = resolveDemoCreds(slug, process.env);
  return buildDemoBanner({
    role,
    email: creds?.email ?? process.env.OFFGRID_DEMO_VIEWER_EMAIL,
    password: creds?.password ?? process.env.OFFGRID_DEMO_VIEWER_PASSWORD,
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

// There are TWO demo tenants (bharatunion, suraksha), each with its OWN read-only viewer login, so
// the signin banner must surface the RIGHT tenant's creds for the host the visitor arrived on. The
// resolver reads a per-slug override first and falls back to the generic pair — so a single-tenant
// deploy still works with just the generic vars, and a multi-tenant deploy overrides per tenant.

export interface DemoCreds {
  email: string;
  password: string;
}

// The subset of process.env the resolver reads. Passed in (not read here) so the rule is PURE and
// unit-testable without touching the real environment.
export interface DemoCredsEnv {
  [key: string]: string | undefined;
}

// The per-slug env var key for a tenant's viewer email/password, e.g. bharatunion →
// OFFGRID_DEMO_VIEWER_BHARATUNION_EMAIL. Uppercased; only [A-Z0-9_] survive so a slug can never
// smuggle a foreign env key.
function slugEnvKey(slug: string, field: 'EMAIL' | 'PASSWORD'): string {
  const safe = slug.toUpperCase().replace(/[^A-Z0-9_]/g, '');
  return `OFFGRID_DEMO_VIEWER_${safe}_${field}`;
}

const pick = (v: string | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length > 0 ? t : null;
};

/**
 * Resolve the viewer creds to show for a demo tenant. Precedence, per field, first non-empty wins:
 *   1. the per-slug override — OFFGRID_DEMO_VIEWER_<SLUG>_EMAIL / _PASSWORD,
 *   2. the generic fallback — OFFGRID_DEMO_VIEWER_EMAIL / _PASSWORD.
 * Returns null when the slug is absent, or when NEITHER a full email+password pair resolves (so the
 * banner still renders the read-only note but shows no half-set creds). Pure — slug + env in, out.
 */
export function resolveDemoCreds(slug: string | null | undefined, env: DemoCredsEnv): DemoCreds | null {
  if (!slug) return null;
  const email = pick(env[slugEnvKey(slug, 'EMAIL')]) ?? pick(env.OFFGRID_DEMO_VIEWER_EMAIL);
  const password = pick(env[slugEnvKey(slug, 'PASSWORD')]) ?? pick(env.OFFGRID_DEMO_VIEWER_PASSWORD);
  if (!email || !password) return null;
  return { email, password };
}

export interface SigninDemoBannerInput {
  slug: string | null | undefined; // the demo tenant slug (from tenantSlugFromHost), or null off-host
  creds: DemoCreds | null; // the resolved per-tenant creds, or null when unset/not a demo host
}

/**
 * Decide the signin-page demo banner. Shows on a demo tenant host (slug present) regardless of
 * session (the visitor is logged out). The resolved per-tenant creds pass through when set, else null
 * (note still shown). Pure.
 */
export function buildSigninDemoBanner(input: SigninDemoBannerInput): DemoBannerModel {
  return {
    show: Boolean(input.slug),
    email: clean(input.creds?.email),
    password: clean(input.creds?.password),
    note: DEMO_READONLY_NOTE,
  };
}

/**
 * The impure reader for the signin banner: resolve the model from process env given the demo tenant
 * slug for this host. Thin — resolves the per-tenant creds and delegates to the pure builder.
 */
export function readSigninDemoBanner(slug: string | null | undefined): DemoBannerModel {
  return buildSigninDemoBanner({ slug, creds: resolveDemoCreds(slug, process.env) });
}
