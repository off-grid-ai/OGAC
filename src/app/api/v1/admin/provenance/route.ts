import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readProvenanceView } from '@/lib/provenance-view';

// Signed-provenance read-back — verified/unverified rollup + recent signed records for the
// Provenance page. Thin: gate, read, return the display model.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 50;
  return NextResponse.json(await readProvenanceView(Number.isFinite(limit) ? limit : 50));
}
