import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { type ProvenanceManifest, verifyManifest } from '@/lib/provenance';

// Verify a detached provenance manifest (from a report export). Checks the signature with the
// active signing port's public key; if `sha256` of the file is supplied, also checks it matches the
// manifest. ed25519 verification needs only the public key — no shared secret.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as {
    manifest?: ProvenanceManifest;
    sha256?: unknown;
  } | null;
  const m = b?.manifest;
  if (!m || typeof m.signature !== 'string' || typeof m.sha256 !== 'string') {
    return NextResponse.json({ error: 'manifest (with signature + sha256) required' }, { status: 400 });
  }
  const sha = typeof b?.sha256 === 'string' ? b.sha256 : undefined;
  return NextResponse.json(verifyManifest(m, sha));
}
