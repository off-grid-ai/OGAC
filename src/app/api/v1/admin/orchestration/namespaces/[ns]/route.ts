import { NextResponse } from 'next/server';
import { kestraCatalog } from '@/lib/adapters/kestra-catalog';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// One namespace + its secret keys (read-only) and KV entries (full CRUD) — the detail view's data.
// Fetched together so the detail page renders in one round-trip.
export async function GET(req: Request, { params }: { params: Promise<{ ns: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { ns } = await params;
  const [namespace, secrets, kv] = await Promise.all([
    kestraCatalog.getNamespace(ns),
    kestraCatalog.listSecrets(ns),
    kestraCatalog.listKv(ns),
  ]);
  if (!namespace) {
    return NextResponse.json({ error: 'namespace not found or engine unreachable' }, { status: 404 });
  }
  return NextResponse.json({ configured: kestraCatalog.configured(), namespace, secrets, kv });
}
