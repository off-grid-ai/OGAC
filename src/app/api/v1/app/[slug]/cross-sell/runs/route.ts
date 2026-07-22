import { NextResponse } from 'next/server';
import { startBankCrossSellRecommendation } from '@/lib/adapters/bank-cross-sell-execution';
import { callerFromSession } from '@/lib/app-access-caller';
import { enforceAppAccessWithSharing } from '@/lib/app-sharing';
import { getAppBySlug } from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireUser } from '@/lib/authz';
import { bankCrossSellErrorResponse } from '@/lib/bank-cross-sell-http';
import { assertSolutionRuntimeBinding } from '@/lib/solution-blueprints-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { slug } = await params;
  const orgId = await currentOrgId();
  const body = (await req.json().catch(() => ({}))) as { customerId?: unknown };
  const customerId = typeof body.customerId === 'string' ? body.customerId.trim() : '';
  if (!customerId) {
    return NextResponse.json(
      { error: 'Choose a customer before generating a recommendation', code: 'customer-required' },
      { status: 400 },
    );
  }
  const app = await getAppBySlug(slug);
  if (!app || app.orgId !== orgId || !app.published) {
    return NextResponse.json(
      { error: 'Cross-sell App was not found', code: 'app-not-found' },
      { status: 404 },
    );
  }
  const caller = await callerFromSession(gate, orgId);
  const access = await enforceAppAccessWithSharing({
    appId: app.id,
    orgId,
    ownerId: app.ownerId,
    caller,
    action: 'run',
    requestAttrs: { customerId },
  });
  if (!access.allow) {
    auditFromSession(gate, orgId, {
      action: 'access.denied',
      resource: `app:${app.id} cross-sell-run`,
      outcome: 'blocked',
    });
    return NextResponse.json({ error: 'access denied', reason: access.reason }, { status: 403 });
  }
  try {
    await assertSolutionRuntimeBinding(app, orgId);
    const result = await startBankCrossSellRecommendation({
      slug,
      orgId,
      actor: caller.userId,
      customerId,
    });
    auditFromSession(gate, orgId, {
      action: 'app.run',
      resource: `app:${app.id} cross-sell:${customerId}`,
      outcome: 'ok',
    });
    return NextResponse.json(
      { data: result.opportunity, evidence: result.evidence },
      { status: 202, headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return bankCrossSellErrorResponse(error);
  }
}
