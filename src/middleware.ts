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
  '/app/', // deployed Studio apps (S2) — public shareable surfaces
  '/api/v1/app/', // their public run endpoint
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
export default auth((req) => {
  if (!checkRateLimit(req)) {
    return NextResponse.json({ error: 'too many requests' }, {
      status: 429,
      headers: { 'Retry-After': '60' },
    });
  }
  if (isPublic(req.nextUrl.pathname)) return NextResponse.next();
  if (req.method === 'GET' && FILE_GET.test(req.nextUrl.pathname)) return NextResponse.next();
  if (isApiBearer(req)) return NextResponse.next();
  if (!req.auth) {
    // API clients get a clean 401 (not an HTML login redirect); browsers get sent to
    // /signin with a callbackUrl so they return to where they were headed.
    if (req.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const signin = new URL('/signin', req.nextUrl.origin);
    signin.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signin);
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|diagrams).*)',
  ],
};
