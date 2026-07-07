import { NextResponse } from 'next/server';
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';
import { isPublicFileGet, isPublicPath, tenantSlugFromHost } from '@/lib/route-access';

// Sliding-window rate limiter — 60 req/min per IP on /api/* routes.
// Keyed on CF-Connecting-IP (set by Cloudflare Tunnel) then x-forwarded-for fallback.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(req: { headers: Headers; nextUrl: { pathname: string } }): boolean {
  if (!req.nextUrl.pathname.startsWith('/api/')) return true;
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT;
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

export default auth((req) => {
  const { pathname } = req.nextUrl;
  // Downstream requests carry the (spoof-proof) tenant slug parsed from the host.
  const reqHeaders = tenantScopedHeaders(req);
  const pass = () => NextResponse.next({ request: { headers: reqHeaders } });

  // CORS preflight — answer before auth/rate-limit so a browser can probe the public API.
  if (req.method === 'OPTIONS' && isPublicApi(pathname)) {
    return withCors(new NextResponse(null, { status: 204 }), pathname);
  }
  if (!checkRateLimit(req)) {
    return withCors(
      NextResponse.json({ error: 'too many requests' }, { status: 429, headers: { 'Retry-After': '60' } }),
      pathname,
    );
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
    const signin = new URL('/signin', req.nextUrl.origin);
    signin.searchParams.set('callbackUrl', pathname + req.nextUrl.search);
    return NextResponse.redirect(signin);
  }
  return withCors(pass(), pathname);
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|diagrams).*)',
  ],
};
