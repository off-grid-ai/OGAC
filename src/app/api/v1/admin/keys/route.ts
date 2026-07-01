import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createApiKey, listApiKeys } from '@/lib/store';

const TYPES = ['user', 'project'];

function valid(b: Record<string, unknown> | null): boolean {
  if (!b) return false;
  return Boolean(b.name) && Boolean(b.subject) && TYPES.includes(b.subjectType as string);
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listApiKeys() });
}

// Issue a virtual key. The secret token is returned ONCE here and never stored in cleartext.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!valid(b)) {
    return NextResponse.json(
      { error: 'name, subject, subjectType (user|project) required' },
      { status: 400 },
    );
  }
  const budget = typeof b!.budgetUsd === 'number' ? (b!.budgetUsd as number) : null;
  return NextResponse.json(
    await createApiKey({
      name: b!.name as string,
      subjectType: b!.subjectType as string,
      subject: b!.subject as string,
      budgetUsd: budget,
    }),
    { status: 201 },
  );
}
