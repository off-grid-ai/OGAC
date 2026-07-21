// PURE route-access rules (zero imports, zero I/O → unit-testable with real inputs, no mocks).
// The middleware (edge runtime, imports NextAuth) composes these; keeping the rules here means the
// authorization logic is testable without standing up the edge runtime. SOLID: pure policy here,
// the impure request handling stays in middleware.ts. DRY: these are the single source of truth for
// which paths are public — middleware imports them, tests import them.

// Node/device endpoints authenticate with device/enrollment tokens (not user SSO) → public here.
export const NODE_API = /^\/api\/v1\/devices\/(enroll|[^/]+\/(policy|audit|commands))$/;

// Unauthenticated GET of a single stored file. The key can be NESTED (object-store keys have
// slashes, e.g. media/2026/report.png), so match any non-empty tail. The catch-all [...id] handler
// still enforces public-vs-private per file — this only decides which GETs reach that gate.
export const FILE_GET = /^\/api\/v1\/files\/.+$/;

// Marketing, docs, and auth surfaces that never require an SSO session.
export const PUBLIC_EXACT = ['/', '/docs', '/openapi.json', '/scalar.standalone.js'];
export const PUBLIC_PREFIX = [
  '/architecture',
  '/journey',
  '/features',
  '/fleet-control',
  '/handbook',
  '/docs', // the product documentation site — /docs, /docs/*, /docs/api
  '/signin',
  '/api/auth',
  '/api/waitlist', // public request-access capture from the signin page
  '/app/', // deployed Studio apps — public shareable surfaces
  '/api/v1/app/', // their public run endpoint
  '/api/v1/triggers/', // public webhook ingress — authed by its own per-trigger HMAC signature, not a session
  '/api/v1/status', // public service status (uptime monitors)
  '/invite/accept', // an invitee accepts BEFORE they have a session — the page is public
  '/api/v1/invites/accept', // the public accept endpoint (validates the single-use token itself)
];

/** A path that never requires an SSO session (marketing/docs/auth/node-device). */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname)) return true;
  if (PUBLIC_PREFIX.some((p) => pathname.startsWith(p))) return true;
  return NODE_API.test(pathname);
}

/** An unauthenticated GET of a (possibly nested-key) stored file is allowed to reach the handler. */
export function isPublicFileGet(method: string, pathname: string): boolean {
  return method === 'GET' && FILE_GET.test(pathname);
}

// A tenant's own subdomain is "<slug>-onprem-console.<apex>". Extract the slug from a trusted host,
// or null when the host isn't a tenant subdomain. First-level hyphenated so the zone's universal
// cert covers TLS. Kept here (pure) so both the middleware and its tests share one definition.
const TENANT_HOST_RE = /^([a-z0-9]+)-onprem-console\./;
export function tenantSlugFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const m = TENANT_HOST_RE.exec(host.toLowerCase());
  return m ? m[1] : null;
}

// The public demo tenants render their SIGNIN page (not the marketing landing) at the root: visiting
// a tenant subdomain's "/" should feel like arriving AT that tenant's console, not on a second
// marketing page. So on a tenant host, "/" redirects to the console overview; the auth guard then
// sends a logged-out visitor to /signin (making signin the effective tenant home) and, after login,
// they land on /overview. The APEX host (no tenant slug, e.g. onprem-console.getoffgridai.co) keeps
// rendering the landing at "/", so this returns false there. PURE (host + path in, boolean out) so
// the corner cases are unit-testable without the edge runtime.
export function isTenantRootRedirect(host: string | null | undefined, pathname: string): boolean {
  return pathname === '/' && tenantSlugFromHost(host) !== null;
}

// A per-tenant PROVISIONED gateway host is "<slug5><rand5>-gateway.<apex>" (see tenantGatewayHost in
// tenant-domain.ts): a 10-char label = 5 chars of the tenant slug + a 5-char unguessable random
// suffix, then the fixed "-gateway" group. This is the mirror of tenantSlugFromHost for the GATEWAY
// edge: given an inbound Host, extract the label parts so a call to a tenant gateway host can be
// ATTRIBUTED/routed to that tenant's gateway. PURE (no I/O) — the aggregator/proxy that owns the
// tenant→gateway lookup calls this first, then resolves the row by the returned `label`.
//
//   • `label`  — the full first-level label WITHOUT the "-gateway" group ("<slug5><rand5>"), the
//                stable key stored on the gateway row's hostname. It is what a lookup keys off.
//   • `slugPrefix` — the first 5 chars (the tenant-slug prefix); a hint for display/attribution.
//   • `randSuffix` — the last 5 chars (the unguessable part).
// The shared gateway ("gateway.<apex>") and any non-matching host return null — only a provisioned
// per-tenant gateway host matches. The label MUST be exactly 10 alphanumerics before "-gateway".
const GATEWAY_HOST_RE = /^([a-z0-9]{5})([a-z0-9]{5})-gateway\./;
export interface GatewayHostParts {
  /** The full "<slug5><rand5>" label (no "-gateway") — the key stored on gateways.hostname. */
  label: string;
  /** First 5 chars: the tenant-slug prefix (attribution hint). */
  slugPrefix: string;
  /** Last 5 chars: the unguessable random suffix. */
  randSuffix: string;
}
export function gatewayFromHost(host: string | null | undefined): GatewayHostParts | null {
  if (!host) return null;
  const m = GATEWAY_HOST_RE.exec(host.toLowerCase());
  if (!m) return null;
  return { label: m[1] + m[2], slugPrefix: m[1], randSuffix: m[2] };
}
