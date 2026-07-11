// Internal rate-limit resolver — the ONLY DB-touching hop the Edge middleware makes.
//
// The middleware can't query Postgres (Edge runtime). It fingerprints the presented API secret with
// Web Crypto and asks this Node route for that key's configured limit + the org default; it caches
// the answer for ~30s so this is at most one lookup per key per window, not per request.
//
// Gated by a shared secret (AUTH_SECRET) in the `x-rl-internal` header — the middleware knows it, so
// this route is not a key-existence oracle for outside callers. It returns only a numeric limit,
// never any secret material.
import { NextResponse } from 'next/server';
import { getOrgDefaultRateLimit, resolveKeyByHash } from '@/lib/rate-limit-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET ?? '';
  const presented = req.headers.get('x-rl-internal') ?? '';
  // Constant-ish guard: require the shared secret to be set AND to match.
  if (!secret || presented !== secret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const hash = new URL(req.url).searchParams.get('h') ?? '';
  if (!hash) return NextResponse.json({ rateLimit: null, orgDefault: null });

  try {
    const [key, orgDefault] = await Promise.all([
      resolveKeyByHash(hash),
      getOrgDefaultRateLimit(),
    ]);
    // A disabled key is pinned to 0 → the edge denies every request for it (retry-after = window).
    let rateLimit: number | null = null;
    if (key) rateLimit = key.enabled ? key.rateLimit : 0;
    return NextResponse.json({ rateLimit, orgDefault });
  } catch {
    // On any DB error, tell the edge "nothing configured" → it applies the global floor. Never 500
    // the resolver in a way that would block legitimate traffic.
    return NextResponse.json({ rateLimit: null, orgDefault: null });
  }
}
