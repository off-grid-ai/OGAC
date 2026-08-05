import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readProvenanceView } from '@/lib/provenance-view';
import { currentOrgId } from '@/lib/tenancy';

// Signed-provenance read-back — verified/unverified rollup + recent signed records for the
// Provenance page. Thin: gate, read, return the display model.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 50;
  // ORG-SCOPED, same reason as the page: unscoped, this returned the DEFAULT org's signed records to
  // every tenant, including another tenant's run and agent ids.
  const orgId = await currentOrgId();
  const view = await readProvenanceView(Number.isFinite(limit) ? limit : 50, orgId);
  // A read failure is a 502, never a 200 with an empty ledger — a caller must be able to tell "nothing
  // is signed" from "we could not check".
  if (view.error) return NextResponse.json({ error: view.error }, { status: 502 });
  return NextResponse.json(view);
}
