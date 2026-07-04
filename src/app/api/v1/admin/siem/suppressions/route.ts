import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createSuppression, listSuppressions } from '@/lib/siem-suppress';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listSuppressions(await currentOrgId()) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const result = await createSuppression(
    {
      kind: body?.kind as never,
      pattern: (body?.pattern as string) ?? '',
      note: body?.note as string | undefined,
    },
    await currentOrgId(),
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.rule, { status: 201 });
}
