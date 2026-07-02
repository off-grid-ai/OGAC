import { NextResponse } from 'next/server';
import { requireAdmin, requireUser } from '@/lib/authz';
import { budgetsWithUsage, setBudget } from '@/lib/token-budgets';

export const dynamic = 'force-dynamic';

// Token budgets — issue + monitor per-user / per-org token allocations metered against the gateway's
// OpenSearch call history. GET (any user) → budgets joined with live usage. POST (admin) → upsert a
// budget for a subject (user id or `org:<name>`).
export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await budgetsWithUsage() });
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as {
    subject?: unknown;
    allocatedTokens?: unknown;
    period?: unknown;
  } | null;
  const subject = typeof b?.subject === 'string' ? b.subject.trim() : '';
  const allocatedTokens = Number(b?.allocatedTokens);
  if (!subject || !Number.isFinite(allocatedTokens) || allocatedTokens < 0) {
    return NextResponse.json({ error: 'subject and allocatedTokens required' }, { status: 400 });
  }
  const period = typeof b?.period === 'string' ? b.period : 'monthly';
  await setBudget(subject, Math.floor(allocatedTokens), period, gate.user.email ?? '');
  return NextResponse.json({ ok: true }, { status: 201 });
}
