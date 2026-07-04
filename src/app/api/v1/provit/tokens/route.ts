import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { currentPrincipal } from '@/lib/provit-access';
import { listTokens, mintToken, revokeToken } from '@/lib/provit-token';

export const dynamic = 'force-dynamic';

// GET /api/v1/provit/tokens — list this org's Provit integration tokens (no secrets).
export async function GET(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const p = await currentPrincipal();
  return NextResponse.json({ tokens: await listTokens(p.orgId) }, { headers: { 'cache-control': 'no-store' } });
}

// POST /api/v1/provit/tokens — mint a token bound to the caller's org + identity. Plaintext once.
export async function POST(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const p = await currentPrincipal();
  const b = (await req.json().catch(() => ({}))) as { label?: string };
  const { id, token } = await mintToken(p.orgId, p.email || 'user', (b.label ?? '').slice(0, 80));
  return NextResponse.json({ id, token }); // token shown ONCE
}

// DELETE /api/v1/provit/tokens?id=… — revoke.
export async function DELETE(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const p = await currentPrincipal();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await revokeToken(id, p.orgId);
  return NextResponse.json({ ok: true });
}
