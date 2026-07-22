import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { getEnterpriseContext } from '@/lib/enterprise-context';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const SAFE_APP_ID = /^[A-Za-z0-9_-]{1,128}$/;

// GET /api/v1/admin/enterprise-context?appId=<optional existing App>
// The effective tenant always comes from the authenticated request context. appId only asks the
// org-scoped App owner for additional edit/cycle facts; it can never select another organization.
export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;

  const appId = new URL(req.url).searchParams.get('appId')?.trim() || null;
  if (appId && !SAFE_APP_ID.test(appId)) {
    return NextResponse.json({ error: 'appId must be a valid App identifier' }, { status: 400 });
  }

  const orgId = await currentOrgId();
  const data = await getEnterpriseContext({
    orgId,
    actor: {
      userId: gate.user.email ?? gate.user.name ?? 'authenticated-user',
      role: gate.user.role,
    },
    appId,
  });
  return NextResponse.json(
    { object: 'enterprise_context', data },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
