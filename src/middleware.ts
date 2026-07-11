import { NextResponse } from 'next/server';
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';
import {
  checkRateLimit as decideRateLimit,
  resolveRateLimit,
  GLOBAL_RATE_LIMIT,
  RATE_WINDOW_MS,
  type Counter,
  type RateLimitConfig,
} from '@/lib/rate-limit';
import {
  isPublicFileGet,
  isPublicPath,
  isTenantRootRedirect,
  tenantSlugFromHost,
} from '@/lib/route-access';
import { isViewerWriteAttempt, VIEWER_FORBIDDEN_BODY } from '@/lib/viewer-policy';

// The internal resolver route the edge uses to look up a key's configured limit (Node runtime → DB).
// The edge short-circuits it so it isn't itself gated or rate-limited.
const RL_RESOLVE_PATH = '/api/internal/rate-limit';

// Two sliding-window counter maps, both driven by the SAME pure decision (@/lib/rate-limit):
//   - ipCounters:  the global floor, keyed per client IP — applies to EVERY /api/* request.
//   - keyCounters: the operator-configured per-key limit, keyed per API key — applied ADDITIONALLY
//                  when a request carries an API key/bearer.
const ipCounters = new Map<string, Counter>();
const keyCounters = new Map<string, Counter>();

// Per-key limit resolutions are cached (short TTL) so we don't call the resolver route on every
// request — one lookup per key per KEY_TTL_MS, then served from memory.
const KEY_TTL_MS = 30_000;
const keyLimitCache = new Map<string, { config: RateLimitConfig; expires: number }>();

const FLOOR: RateLimitConfig = { limit: GLOBAL_RATE_LIMIT, windowMs: RATE_WINDOW_MS };

function clientIp(req: { headers: Headers }): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    'unknown'
  );
}

// The per-IP global floor: EVERY /api/* request is subject to it. Returns the retry-after seconds on
// breach, or null when allowed.
function checkIpFloor(req: { headers: Headers; nextUrl: { pathname: string } }): number | null {
  if (!req.nextUrl.pathname.startsWith('/api/')) return null;
  const r = decideRateLimit(clientIp(req), FLOOR, Date.now(), ipCounters);
  return r.allow ? null : r.retryAfterSec;
}

// Extract the presented API secret: `Authorization: Bearer <token>` or `X-Api-Key: <token>`.
function presentedKey(req: { headers: Headers }): string | null {
  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim() || null;
  const xk = req.headers.get('x-api-key');
  return xk?.trim() || null;
}

// SHA-256 of a token, hex — matches hashToken() in rate-limit-store.ts. Web Crypto is available in
// the Edge runtime (node:crypto is not), so the edge fingerprints the secret itself and only sends
// the hash to the resolver — the cleartext secret never leaves the edge.
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Resolve (cached) the configured limit for a key hash by asking the Node resolver route. Any failure
// (resolver down, unknown key) falls back to the global floor so a resolver hiccup never opens the
// gate wider than the floor and never hard-fails a request.
async function resolveKeyConfig(origin: string, hash: string): Promise<RateLimitConfig> {
  const cached = keyLimitCache.get(hash);
  if (cached && cached.expires > Date.now()) return cached.config;
  let config = FLOOR;
  try {
    const res = await fetch(`${origin}${RL_RESOLVE_PATH}?h=${hash}`, {
      // Shared-secret so only the edge (which knows AUTH_SECRET) can drive the resolver — it isn't a
      // key-existence oracle for outside callers. AUTH_SECRET is always set (NextAuth requires it).
      headers: { 'x-rl-internal': process.env.AUTH_SECRET ?? '' },
    });
    if (res.ok) {
      const body = (await res.json()) as { rateLimit?: number | null; orgDefault?: number | null };
      config = resolveRateLimit(body.rateLimit, body.orgDefault, GLOBAL_RATE_LIMIT, RATE_WINDOW_MS);
    }
  } catch {
    config = FLOOR;
  }
  keyLimitCache.set(hash, { config, expires: Date.now() + KEY_TTL_MS });
  return config;
}

// The per-KEY configured limit, enforced ON TOP of the per-IP floor. Returns retry-after seconds on
// breach, or null when allowed / no key present.
async function checkKeyLimit(req: {
  headers: Headers;
  nextUrl: { pathname: string; origin: string };
}): Promise<number | null> {
  if (!req.nextUrl.pathname.startsWith('/api/')) return null;
  const secret = presentedKey(req);
  if (!secret) return null;
  const hash = await sha256Hex(secret);
  const config = await resolveKeyConfig(req.nextUrl.origin, hash);
  const r = decideRateLimit(`key:${hash}`, config, Date.now(), keyCounters);
  return r.allow ? null : r.retryAfterSec;
}

function tooManyRequests(retryAfterSec: number, pathname: string): NextResponse {
  return withCors(
    NextResponse.json(
      { error: 'too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    ),
    pathname,
  );
}

const { auth } = NextAuth(authConfig);

// The public-path / file-GET / tenant-slug rules are PURE and live in lib/route-access.ts so they're
// unit-testable without the edge runtime, and shared (DRY) between here and the tests.

// Machine key flow: any /api/* request carrying `Authorization: Bearer <token>` is let
// through here and AUTHENTICATED IN THE HANDLER via the IdentityVerifier seam (authz.ts).
// The middleware runs in the Edge runtime where node:crypto (JWKS verification) isn't
// available, so it can't verify the JWT itself — it only distinguishes "browser needing
// a login redirect" from "API client presenting a key". Every /api handler still gates
// with requireUser/requireAdmin, so an unverifiable token yields a 401 downstream.
function isApiBearer(req: { headers: Headers; nextUrl: { pathname: string } }): boolean {
  if (!req.nextUrl.pathname.startsWith('/api/')) return false;
  return (req.headers.get('authorization') ?? '').startsWith('Bearer ');
}

// User/admin surface (console UI + admin/audit APIs) requires an SSO session (or a service token).
// CORS for the public API surface (Phase 5). Scoped to /api/v1/* so the platform is callable
// cross-origin (SDKs, browser apps). ACAO:* with NO Allow-Credentials on purpose: browsers won't
// attach cookies to a wildcard-origin request, so session-cookie routes are never exposed
// cross-site — only bearer-token calls (the machine-client flow) work cross-origin, which is what
// a public API wants.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Api-Key',
  'Access-Control-Max-Age': '86400',
};
const isPublicApi = (pathname: string): boolean => pathname.startsWith('/api/v1/');
function withCors(res: NextResponse, pathname: string): NextResponse {
  if (isPublicApi(pathname)) {
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  }
  return res;
}

// A tenant's own subdomain is "<slug>-onprem-console.<apex>". Parse the slug from the TRUSTED Host
// (set by Cloudflare) and forward it downstream as x-offgrid-tenant-slug so currentOrgId() can
// hard-bind the request to that tenant's org. We ALWAYS strip any client-supplied value first, then
// set it only from the host — so the header can't be spoofed to reach another tenant's data.
function tenantScopedHeaders(req: { headers: Headers; nextUrl: { hostname: string } }): Headers {
  const h = new Headers(req.headers);
  h.delete('x-offgrid-tenant-slug');
  const slug = tenantSlugFromHost(req.headers.get('host') ?? req.nextUrl.hostname);
  if (slug) h.set('x-offgrid-tenant-slug', slug);
  return h;
}

export default auth(async (req) => {
  const { pathname } = req.nextUrl;

  // The edge's own limit-resolver route: let it through untouched (no auth gate, no rate limit) so
  // the middleware isn't recursively rate-limiting the very lookup it depends on. It self-guards with
  // the x-rl-internal header + a same-origin fetch.
  if (pathname === RL_RESOLVE_PATH) {
    return NextResponse.next();
  }

  // Downstream requests carry the (spoof-proof) tenant slug parsed from the host.
  const reqHeaders = tenantScopedHeaders(req);
  const pass = () => NextResponse.next({ request: { headers: reqHeaders } });

  // CORS preflight — answer before auth/rate-limit so a browser can probe the public API.
  if (req.method === 'OPTIONS' && isPublicApi(pathname)) {
    return withCors(new NextResponse(null, { status: 204 }), pathname);
  }
  // (1) Global per-IP floor — every /api/* request.
  const ipBreach = checkIpFloor(req);
  if (ipBreach !== null) return tooManyRequests(ipBreach, pathname);
  // (2) Per-key configured limit — enforced ON TOP of the floor when a key/bearer is present.
  const keyBreach = await checkKeyLimit(req);
  if (keyBreach !== null) return tooManyRequests(keyBreach, pathname);
  // A DEMO TENANT subdomain at "/" is its console, not the marketing landing: redirect the root to
  // /overview so a visitor arrives AT that tenant's console. A logged-out visitor is then sent by the
  // auth guard below to /signin?callbackUrl=/overview, so signin IS the tenant home. The apex host
  // (no tenant slug) is unaffected and keeps rendering the landing. Runs BEFORE isPublicPath so the
  // public "/" rule doesn't short-circuit it. Only "/" is redirected — every other tenant path (incl.
  // /overview and /docs) falls through untouched.
  // Behind the Cloudflare tunnel, req.nextUrl.origin resolves to the APEX host, which would strip the
  // tenant subdomain on a redirect (bharatunion-… -> apex). Rebuild the origin from the TRUSTED Host
  // header (+ forwarded proto) so a tenant redirect STAYS on that tenant's host.
  const trustedOrigin = (() => {
    const host = req.headers.get('host') ?? req.nextUrl.host;
    const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
    return `${proto}://${host}`;
  })();
  if (isTenantRootRedirect(req.headers.get('host') ?? req.nextUrl.hostname, pathname)) {
    return NextResponse.redirect(new URL('/overview', trustedOrigin));
  }
  if (isPublicPath(pathname)) return withCors(pass(), pathname);
  if (isPublicFileGet(req.method, pathname)) return pass();
  if (isApiBearer(req)) return withCors(pass(), pathname);
  if (!req.auth) {
    // API clients get a clean 401 (not an HTML login redirect); browsers get sent to
    // /signin with a callbackUrl so they return to where they were headed.
    if (pathname.startsWith('/api/')) {
      return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }), pathname);
    }
    const signin = new URL('/signin', trustedOrigin);
    signin.searchParams.set('callbackUrl', pathname + req.nextUrl.search);
    return NextResponse.redirect(signin);
  }
  // READ-ONLY VIEWER — the load-bearing, catch-all write block for the public live demo. A viewer
  // cookie session may VIEW everything but may MUTATE nothing: any mutating method on an /api/* route
  // is rejected 403 HERE, before the handler runs, so every write route is covered without a per-file
  // edit (the per-handler `requireWriter` gate is defense-in-depth on top). GET/HEAD/OPTIONS pass, so
  // a viewer reads every surface. Machine bearer tokens are never a viewer (they short-circuit above).
  const role = (req.auth.user as { role?: string } | undefined)?.role;
  if (pathname.startsWith('/api/') && isViewerWriteAttempt(role, req.method)) {
    return withCors(NextResponse.json(VIEWER_FORBIDDEN_BODY, { status: 403 }), pathname);
  }
  return withCors(pass(), pathname);
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|diagrams).*)',
  ],
};
