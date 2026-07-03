import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readLineageView } from '@/lib/marquez';

// Admin lineage read-back — the normalized Marquez display model (namespaces / jobs / datasets /
// edges + counts + last-run). Best-effort: readLineageView never throws, so a { configured, data,
// error } envelope is always returned.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await readLineageView());
}
