import { NextResponse } from 'next/server';
import { createGovernance, listGovernance } from '@/lib/store';

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

export async function GET() {
  return NextResponse.json({ object: 'list', data: await listGovernance() });
}

export async function POST(req: Request) {
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
