import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { deleteApiKey, setApiKeyEnabled } from '@/lib/store';
import { getKeyRateLimit, setKeyRateLimit } from '@/lib/rate-limit-store';

// Read a single key's configured per-minute rate limit (null = unset → org/global default applies).
// Scoped to the caller's org — a cross-tenant id reads back null, never org B's limit (P1 IDOR fix).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  return NextResponse.json({ id, rateLimit: await getKeyRateLimit(id, await currentOrgId()) });
}

// PATCH accepts `enabled` (on/off) and/or `rateLimit` (requests/min; null clears the per-key limit).
// At least one must be present.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as {
    enabled?: unknown;
    rateLimit?: unknown;
  } | null;
  if (!b) return NextResponse.json({ error: 'body required' }, { status: 400 });

  const hasEnabled = typeof b.enabled === 'boolean';
  const hasRateLimit = 'rateLimit' in b;
  if (!hasEnabled && !hasRateLimit) {
    return NextResponse.json(
      { error: 'enabled (boolean) and/or rateLimit (number|null) required' },
      { status: 400 },
    );
  }
  if (hasRateLimit && b.rateLimit !== null) {
    if (typeof b.rateLimit !== 'number' || !Number.isFinite(b.rateLimit) || b.rateLimit < 0) {
      return NextResponse.json(
        { error: 'rateLimit must be a non-negative number or null' },
        { status: 400 },
      );
    }
  }

  // Scope every mutation to the caller's org — a guessed id from another tenant is a no-op, so org A
  // can neither enable/disable nor throttle org B's key (P1 IDOR fix).
  const orgId = await currentOrgId();
  if (hasEnabled) await setApiKeyEnabled(id, b.enabled as boolean, orgId);
  if (hasRateLimit) {
    await setKeyRateLimit(
      id,
      b.rateLimit === null ? null : Math.floor(b.rateLimit as number),
      orgId,
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  // Scope the delete to the caller's org — org A cannot delete org B's key via a guessed id (P1 IDOR).
  await deleteApiKey(id, await currentOrgId());
  return NextResponse.json({ ok: true });
}
