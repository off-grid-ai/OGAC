import { NextResponse } from 'next/server';
import { getDrift } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

// Drift / degradation report over the eval-score history (first-party PSI by default, Evidently
// when OFFGRID_ADAPTER_DRIFT=evidently). GET so dashboards/monitors can poll it cheaply.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await getDrift().analyze({ orgId: await currentOrgId() }));
}
