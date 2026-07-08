import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteApiKey, setApiKeyEnabled } from '@/lib/store';
import { getKeyRateLimit, setKeyRateLimit } from '@/lib/rate-limit-store';

// Read a single key's configured per-minute rate limit (null = unset → org/global default applies).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  return NextResponse.json({ id, rateLimit: await getKeyRateLimit(id) });
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

  if (hasEnabled) await setApiKeyEnabled(id, b.enabled as boolean);
  if (hasRateLimit) {
    await setKeyRateLimit(id, b.rateLimit === null ? null : Math.floor(b.rateLimit as number));
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteApiKey(id);
  return NextResponse.json({ ok: true });
}
