import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { fetchLineageGraph } from '@/lib/marquez';

// Marquez lineage read-back — the server-sourced job→dataset graph for the Lineage page.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await fetchLineageGraph());
}
