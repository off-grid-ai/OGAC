import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createGovernance, listGovernance } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

const KINDS = [
  'policy',
  'ethics_review',
  'raci',
  'training',
  'vendor',
  'insurance',
  'drill',
  'impact_assessment',
];

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listGovernance(await currentOrgId()) });
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || !b.title || !KINDS.includes(b.kind as string)) {
    return NextResponse.json({ error: 'title and a valid kind required' }, { status: 400 });
  }
  return NextResponse.json(
    await createGovernance({
      kind: b.kind as string,
      title: b.title as string,
      owner: (b.owner as string | undefined) ?? '',
      status: (b.status as string | undefined) ?? 'active',
      detail: (b.detail as string | undefined) ?? '',
      reviewedAt: (b.reviewedAt as string | undefined) ?? '',
    }),
    { status: 201 },
  );
}
