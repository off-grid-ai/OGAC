import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { managedSetVariants, UnleashRequiredError } from '@/lib/flags-manager';
import type { VariantInput } from '@/lib/unleash-admin';

// Parse + normalize a raw variant array into VariantInput[]. Pure: no I/O. Returns either the
// parsed set or the exact validation-error string the handler surfaces as a 400 (behavior-identical
// to the previous inline loop).
function parseVariants(
  raw: unknown[],
): { ok: true; variants: VariantInput[] } | { ok: false; error: string } {
  const variants: VariantInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'each variant must be an object' };
    }
    const v = item as Record<string, unknown>;
    if (typeof v.name !== 'string' || !v.name.trim()) {
      return { ok: false, error: 'each variant needs a name' };
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
  return { ok: true, variants };
}

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
  const parsed = parseVariants(b.variants);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const variants = parsed.variants;
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
