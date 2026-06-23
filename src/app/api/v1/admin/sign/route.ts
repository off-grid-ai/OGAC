import { NextResponse } from 'next/server';
import { sign, verify } from '@/lib/sign';

// Sign a payload (answer + citations, an export, …) → tamper-evident signature. With `signature`
// present, verifies instead. First-party HMAC; C2PA/Sigstore are the external upgrades.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as {
    payload?: unknown;
    signature?: string;
  } | null;
  if (!b || b.payload === undefined) {
    return NextResponse.json({ error: 'payload required' }, { status: 400 });
  }
  if (typeof b.signature === 'string') {
    return NextResponse.json({ valid: verify(b.payload, b.signature) });
  }
  return NextResponse.json({ signature: sign(b.payload) }, { status: 201 });
}
