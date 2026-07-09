import { NextResponse } from 'next/server';
import { acceptInvite } from '@/lib/user-invites';

export const dynamic = 'force-dynamic';

// ─── PUBLIC invite ACCEPT endpoint — no session required (the token is the credential) ──────────────
// The invitee hits this BEFORE they have an account, so it is deliberately public (whitelisted in
// route-access.ts). Security is the single-use, hashed, expiring token itself — acceptInvite validates
// it against the store (unknown → 404, expired/revoked/consumed → 410) and only then provisions the
// Keycloak user + applies the invite's app grants + marks the invite consumed.
//
// Accepts the token in the JSON body OR the `token` query param (so a bare GET link can degrade to a
// simple confirmation flow). Never echoes the token back.
async function tokenFrom(req: Request): Promise<string> {
  const url = new URL(req.url);
  const qs = url.searchParams.get('token');
  if (qs && qs.trim()) return qs.trim();
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  return typeof body?.token === 'string' ? body.token.trim() : '';
}

export async function POST(req: Request) {
  const token = await tokenFrom(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: 'a token is required' }, { status: 400 });
  }
  const result = await acceptInvite(token);
  return NextResponse.json(
    {
      ok: result.ok,
      message: result.reason,
      provisioned: result.provisioned,
      // Where the client should send the user next: their org sign-in, where Keycloak forces the
      // set-password + verify-email required actions we set on provisioning.
      next: result.ok ? '/signin' : null,
      email: result.ok ? result.invite?.email : undefined,
    },
    { status: result.status },
  );
}
