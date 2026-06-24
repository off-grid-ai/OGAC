import { NextResponse } from 'next/server';
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

const { auth } = NextAuth(authConfig);

// Node endpoints authenticate with device/enrollment tokens, not user SSO — left public here.
const NODE_API = /^\/api\/v1\/devices\/(enroll|[^/]+\/(policy|audit|commands))$/;

// Marketing, docs, and auth surfaces that never require an SSO session.
const PUBLIC_EXACT = ['/', '/docs', '/openapi.json'];
const PUBLIC_PREFIX = ['/architecture', '/journey', '/handbook', '/signin', '/api/auth'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname)) return true;
  if (PUBLIC_PREFIX.some((p) => pathname.startsWith(p))) return true;
  return NODE_API.test(pathname);
}

// Service-account bearer for the admin API — automation / CI / integration tests authenticate
// with `Authorization: Bearer $OFFGRID_ADMIN_TOKEN` instead of an interactive SSO session. Only
// active for /api/* routes and only when the token env is set (off by default).
function hasAdminToken(req: { headers: Headers; nextUrl: { pathname: string } }): boolean {
  const token = process.env.OFFGRID_ADMIN_TOKEN;
  if (!token || !req.nextUrl.pathname.startsWith('/api/')) return false;
  return req.headers.get('authorization') === `Bearer ${token}`;
}

// User/admin surface (console UI + admin/audit APIs) requires an SSO session (or a service token).
export default auth((req) => {
  if (isPublic(req.nextUrl.pathname)) return NextResponse.next();
  if (hasAdminToken(req)) return NextResponse.next();
  if (!req.auth) return NextResponse.redirect(new URL('/signin', req.nextUrl.origin));
  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|diagrams).*)',
  ],
};
