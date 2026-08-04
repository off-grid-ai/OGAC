import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireWriter } from '@/lib/authz';
import { listSlaRules, setSlaRule } from '@/lib/case-sla-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── How long this process may take to decide a case ─────────────────────────────────────────────────
//
// Without a target nothing is ever late, which is how a queue grows to ten-day-old cases with no signal.
// Setting it is deliberately a per-APP decision: "decide within 24 hours" means something different for a
// motor claim than for an expense reimbursement, and one org-wide number would be wrong for both.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireWriter(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const rules = await listSlaRules(await currentOrgId());
  return NextResponse.json({ target: rules.find((r) => r.appId === id) ?? null });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireWriter(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { hours?: number; escalateTo?: string } | null;

  const hours = Number(body?.hours);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24 * 365) {
    return NextResponse.json(
      { error: 'Give a number of hours between 0 (no target) and a year.' },
      { status: 400 },
    );
  }

  const org = await currentOrgId();
  await setSlaRule(
    { appId: id, hours: Math.floor(hours), escalateTo: body?.escalateTo?.trim() || undefined },
    gate.user?.email ?? '',
    org,
  );
  auditFromSession(gate, org, {
    action: 'apps.decision-target.set',
    resource: `app:${id}:${Math.floor(hours)}h`,
    outcome: 'ok',
  });
  // Zero is a legitimate choice, not a failure — it means this process makes no promise, and the queue
  // says exactly that rather than pretending everything is on time.
  return NextResponse.json({ ok: true, hours: Math.floor(hours) });
}
