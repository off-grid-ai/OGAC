import { NextResponse } from 'next/server';
import { type Bundle } from 'sigstore';
import { sigstoreSign, sigstoreSigningConfigured, sigstoreVerify } from '@/lib/sigstore';

// Sigstore keyless signing / verification for artifacts & exports.
//   POST { action: 'sign',   payload, identityToken? }  → { bundle }   (needs an OIDC token)
//   POST { action: 'verify', bundle, payload? }         → { valid, error? }
//   GET                                                  → { signingConfigured }
export async function GET() {
  return NextResponse.json({ signingConfigured: sigstoreSigningConfigured() });
}

interface Body {
  action?: unknown;
  payload?: unknown;
  identityToken?: unknown;
  bundle?: unknown;
}

async function doSign(b: Body): Promise<NextResponse> {
  if (typeof b.payload !== 'string') return NextResponse.json({ error: 'payload (string) required' }, { status: 400 });
  const token = typeof b.identityToken === 'string' ? b.identityToken : undefined;
  const bundle = await sigstoreSign(b.payload, token);
  return NextResponse.json({ bundle }, { status: 201 });
}

async function doVerify(b: Body): Promise<NextResponse> {
  if (!b.bundle || typeof b.bundle !== 'object') return NextResponse.json({ error: 'bundle (object) required' }, { status: 400 });
  const payload = typeof b.payload === 'string' ? b.payload : undefined;
  return NextResponse.json(await sigstoreVerify(b.bundle as Bundle, payload));
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b) return NextResponse.json({ error: 'body required' }, { status: 400 });
  try {
    if (b.action === 'verify') return await doVerify(b);
    return await doSign(b);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'sigstore failed' }, { status: 502 });
  }
}
