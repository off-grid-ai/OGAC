import { NextResponse } from 'next/server';
import { getApp } from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { fairnessReport } from '@/lib/fairness';
import { readAppDecidedCases } from '@/lib/fairness-reader';
import { listFairnessRuns, recordFairnessRun } from '@/lib/fairness-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Fairness on the decisions this app actually made ──────────────────────────────────────────────
//
// WHATS_MISSING_2 #5: zero fairness or bias checks existed, on a tenant whose live apps underwrite personal
// loans and assess death claims. For credit decisions this is the exposure a regulator opens with.
//
// GET  → the checks already on record for this app.
// POST → run one now over its decided cases, and FILE it. A check that is only ever computed on demand
//        answers "is it fair today"; a filed one answers "show me your last fairness review", which is the
//        question actually asked.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  return NextResponse.json({ object: 'list', data: await listFairnessRuns(id, orgId) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'app not found' }, { status: 404 });

  const { cases, undecided, failed } = await readAppDecidedCases(id, orgId);
  const report = fairnessReport(cases);

  const record = await recordFairnessRun(
    { appId: id, appTitle: app.title, ranBy: gate.user?.email ?? 'service', report },
    orgId,
  );

  auditFromSession(gate, orgId, {
    action: 'governance.fairness.check',
    resource: `app:${id}`,
    // A check that could not test anything is not a failure — it ran and recorded that it could not. The
    // outcome reflects whether the CHECK worked, not whether the app passed.
    outcome: 'ok',
  });

  return NextResponse.json(
    {
      run: record,
      // Excluded runs are reported rather than hidden: a reader comparing "10 decided" against the app's
      // 22 runs must be able to see where the other 12 went.
      excluded: { undecided, failed },
    },
    { status: 201 },
  );
}
