import { NextResponse } from 'next/server';
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

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

// Node endpoints authenticate with device/enrollment tokens, not user SSO — left public here.
const NODE_API = /^\/api\/v1\/devices\/(enroll|[^/]+\/(policy|audit|commands))$/;

// GET of a single file is allowed through unauthenticated — the handler serves it only
// if the file is public and returns 404 for private ones. Upload/list/patch/delete
// (POST/GET-list/PATCH/DELETE) are NOT here and still require auth.
const FILE_GET = /^\/api\/v1\/files\/[^/]+$/;

// Marketing, docs, and auth surfaces that never require an SSO session.
const PUBLIC_EXACT = ['/', '/docs', '/openapi.json'];
const PUBLIC_PREFIX = [
  '/architecture',
  '/journey',
  '/features',
  '/fleet-control',
  '/handbook',
  '/signin',
  '/api/auth',
  '/api/waitlist', // public request-access capture from the signin page (no session needed)
  '/app/', // deployed Studio apps (S2) — public shareable surfaces
  '/api/v1/app/', // their public run endpoint
  '/api/v1/status', // public service status (uptime monitors)
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname)) return true;
  if (PUBLIC_PREFIX.some((p) => pathname.startsWith(p))) return true;
  return NODE_API.test(pathname);
}

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

export default auth((req) => {
  const { pathname } = req.nextUrl;

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
  if (isPublic(pathname)) return withCors(NextResponse.next(), pathname);
  if (req.method === 'GET' && FILE_GET.test(pathname)) return NextResponse.next();
  if (isApiBearer(req)) return withCors(NextResponse.next(), pathname);
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
  return withCors(NextResponse.next(), pathname);
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|diagrams).*)',
  ],
};
