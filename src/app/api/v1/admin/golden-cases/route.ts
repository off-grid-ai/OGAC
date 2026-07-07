import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { addGoldenCase, listGoldenCases } from '@/lib/evals';
import { validateGoldenCase } from '@/lib/evals-golden';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // ?appId=<id> → that pipeline's golden set · ?appId=none → org-wide library · omitted → all.
  const raw = new URL(req.url).searchParams.get('appId');
  const appId = raw === null ? undefined : raw === 'none' ? null : raw;
  return NextResponse.json({ object: 'list', data: await listGoldenCases(appId) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const v = validateGoldenCase(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  // Optional appId attaches this golden case to a pipeline (else it's an org-wide library case).
  const appId = typeof body?.appId === 'string' ? body.appId : null;
  return NextResponse.json(await addGoldenCase(v.value, appId), { status: 201 });
}
