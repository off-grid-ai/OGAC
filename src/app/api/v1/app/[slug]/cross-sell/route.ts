import { NextResponse } from 'next/server';
import { readBankCrossSellOpportunityBook } from '@/lib/adapters/bank-cross-sell-execution';
import { callerFromSession } from '@/lib/app-access-caller';
import { enforceAppAccessWithSharing } from '@/lib/app-sharing';
import { getAppBySlug } from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireUser } from '@/lib/authz';
import { bankCrossSellErrorResponse } from '@/lib/bank-cross-sell-http';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { slug } = await params;
  const orgId = await currentOrgId();
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
    action: 'view',
    requestAttrs: {},
  });
  if (!access.allow) {
    auditFromSession(gate, orgId, {
      action: 'access.denied',
      resource: `app:${app.id} cross-sell-book`,
      outcome: 'blocked',
    });
    return NextResponse.json({ error: 'access denied', reason: access.reason }, { status: 403 });
  }
  try {
    const result = await readBankCrossSellOpportunityBook(slug, orgId);
    return NextResponse.json(
      { data: result.opportunities, evidence: result.evidence },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return bankCrossSellErrorResponse(error);
  }
}
