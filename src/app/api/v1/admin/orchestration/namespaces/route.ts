import { NextResponse } from 'next/server';
import { kestraCatalog } from '@/lib/adapters/kestra-catalog';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// The orchestration namespaces — the scopes that own flows, secrets and KV config. Read-only on this
// engine (namespace management is not exposed by the OSS API; namespaces appear when a flow/KV lands
// in them). Degrades to an empty list when the engine is unreachable.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const namespaces = await kestraCatalog.listNamespaces();
  return NextResponse.json({ configured: kestraCatalog.configured(), namespaces });
}
