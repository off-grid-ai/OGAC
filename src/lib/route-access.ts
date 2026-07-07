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
  '/api/v1/status', // public service status (uptime monitors)
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
