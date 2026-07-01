import { NextResponse } from 'next/server';
import { getSigning } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';

// Sign a payload (answer + citations, an export, …) → tamper-evident signature, through the
// provenance signing port (HMAC default; OFFGRID_ADAPTER_PROVENANCE=ed25519 for public-key
// signatures). With `signature` present, verifies instead. C2PA/Sigstore are the external upgrades.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as {
    payload?: unknown;
    signature?: string;
  } | null;
  if (!b || b.payload === undefined) {
    return NextResponse.json({ error: 'payload required' }, { status: 400 });
  }
  const signer = getSigning();
  if (typeof b.signature === 'string') {
    return NextResponse.json({ valid: signer.verify(b.payload, b.signature) });
  }
  return NextResponse.json(
    {
      signature: signer.sign(b.payload),
      algorithm: signer.algorithm,
      publicKey: signer.publicKey(),
    },
    { status: 201 },
  );
}

// Expose the verification public key (asymmetric adapters only) so a third party can verify our
// signatures without any shared secret — the whole point of public-key provenance.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const signer = getSigning();
  return NextResponse.json({ algorithm: signer.algorithm, publicKey: signer.publicKey() });
}
