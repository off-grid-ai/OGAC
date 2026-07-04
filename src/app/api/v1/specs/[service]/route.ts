import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { getServiceSpec, resolveSpecUrl } from '@/lib/service-specs';

export const dynamic = 'force-dynamic';

// Serve a service's OpenAPI spec through one authed surface (Phase 5). The console spec redirects
// to the generated /openapi.json; a native service is fetched SERVER-SIDE (so CORS + LAN-only hosts
// are non-issues); a stub or unreachable service returns a clear, non-crashing message.
export async function GET(req: Request, { params }: { params: Promise<{ service: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { service } = await params;
  const spec = getServiceSpec(service);
  if (!spec) return NextResponse.json({ error: 'unknown service' }, { status: 404 });

  if (spec.kind === 'console') {
    return NextResponse.redirect(new URL('/openapi.json', req.url));
  }
  if (spec.kind === 'stub') {
    return NextResponse.json({ error: 'no machine spec', note: spec.note }, { status: 501 });
  }

  const url = resolveSpecUrl(spec);
  if (!url) {
    return NextResponse.json(
      { error: 'not configured', note: `${spec.envVar} is not set` },
      { status: 503 },
    );
  }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    if (!r.ok) {
      return NextResponse.json({ error: `service returned ${r.status}` }, { status: 502 });
    }
    const doc = await r.json();
    return NextResponse.json(doc);
  } catch {
    return NextResponse.json(
      { error: 'unreachable', note: `${spec.label} did not respond` },
      { status: 502 },
    );
  }
}
