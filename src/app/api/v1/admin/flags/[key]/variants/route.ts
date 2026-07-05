import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { managedSetVariants, UnleashRequiredError } from '@/lib/flags-manager';
import type { VariantInput } from '@/lib/unleash-admin';

// Replace the flag's variant set for the active environment. Variants are an Unleash capability —
// with no Unleash configured this returns 409 (the first-party store can't model variants).
// Body: { variants: [{ name, weight?, weightType?, payload? }, ...] }
export async function PUT(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { key } = await params;
  const b = (await req.json().catch(() => null)) as { variants?: unknown } | null;
  if (!b || !Array.isArray(b.variants)) {
    return NextResponse.json({ error: 'variants (array) required' }, { status: 400 });
  }
  const variants: VariantInput[] = [];
  for (const raw of b.variants) {
    if (!raw || typeof raw !== 'object') {
      return NextResponse.json({ error: 'each variant must be an object' }, { status: 400 });
    }
    const v = raw as Record<string, unknown>;
    if (typeof v.name !== 'string' || !v.name.trim()) {
      return NextResponse.json({ error: 'each variant needs a name' }, { status: 400 });
    }
    variants.push({
      name: v.name.trim(),
      weight: typeof v.weight === 'number' ? v.weight : undefined,
      weightType: v.weightType === 'fix' ? 'fix' : 'variable',
      payload:
        v.payload && typeof v.payload === 'object'
          ? (v.payload as VariantInput['payload'])
          : undefined,
    });
  }
  try {
    const applied = await managedSetVariants(decodeURIComponent(key), variants);
    return NextResponse.json({ ok: true, variants: applied });
  } catch (e) {
    if (e instanceof UnleashRequiredError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'failed to set variants on Unleash' }, { status: 502 });
  }
}
