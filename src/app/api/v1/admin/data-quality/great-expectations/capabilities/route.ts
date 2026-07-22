import { NextResponse } from 'next/server';
import { greatExpectationsLifecycle } from '@/lib/adapters/great-expectations-lifecycle';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const manifest = await greatExpectationsLifecycle.capabilities({
    orgId: await currentOrgId(),
    actor: gate.user.email ?? gate.user.name ?? 'authenticated-admin',
  });
  return NextResponse.json(manifest);
}
