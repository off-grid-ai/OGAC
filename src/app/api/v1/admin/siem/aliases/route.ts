import { NextResponse } from 'next/server';
import { listAliases } from '@/lib/adapters/opensearch-admin';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// SIEM index-lifecycle context (read-only): the aliases over the audit/gateway indices — which
// physical index the write-alias currently points at (the rollover target). Thin: auth, call the lib.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await listAliases());
}
