import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// Write-authorizer for the public file store (SeaweedFS behind gateway.getoffgridai.co/files).
// Caddy `forward_auth` calls this ONLY for write methods (PUT/POST/DELETE/PATCH); reads are
// public and never hit it. Returns 200 when the caller presents a valid Keycloak bearer
// (verified via the IdentityVerifier seam in requireUser) or a console session, 401 otherwise.
// It authenticates the same way as every other API surface — no store-specific credentials.
export async function GET(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  return new Response(null, { status: gate instanceof NextResponse ? 401 : 200 });
}
