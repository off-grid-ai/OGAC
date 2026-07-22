import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { validateSavedQuery } from '@/lib/victoriametrics-query';
import { createSavedQuery, listSavedQueries } from '@/lib/vm-saved-queries-store';

export const dynamic = 'force-dynamic';

// GET (admin) → list this tenant's saved metric queries. POST (admin) → create a validated one.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listSavedQueries(await currentOrgId()) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const raw = await req.json().catch(() => null);
  const v = validateSavedQuery(raw);
  if (!v.valid || !v.value) {
    return NextResponse.json({ error: v.errors.join('; ') }, { status: 400 });
  }
  const org = await currentOrgId();
  const created = await createSavedQuery(v.value, gate.user.email ?? '', org);
  auditFromSession(gate, org, {
    action: 'metrics.saved_query.create',
    resource: `vm_saved_query/${created.id}`,
    outcome: 'success',
  });
  return NextResponse.json(created, { status: 201 });
}
