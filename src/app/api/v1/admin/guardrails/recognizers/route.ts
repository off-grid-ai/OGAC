import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createRecognizer, listRecognizers, validateRecognizer } from '@/lib/presidio-recognizers';
import { degradeOn503 } from '@/lib/route-degrade';
import { currentOrgId } from '@/lib/tenancy';

// Custom Presidio recognizers collection. GET lists the org's recognizers; POST creates one after
// pure validation (pattern → regex + context words, or deny_list → literal terms). These become
// `ad_hoc_recognizers` on every Presidio /analyze call. Thin: admin-gated, validate, delegate.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return degradeOn503(async () =>
    NextResponse.json({ object: 'list', data: await listRecognizers(await currentOrgId()) }),
  );
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const parsed = validateRecognizer(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return degradeOn503(async () =>
    NextResponse.json(await createRecognizer(parsed.value, await currentOrgId()), { status: 201 }),
  );
}
