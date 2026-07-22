import { NextResponse } from 'next/server';
import { listIndexTemplates } from '@/lib/adapters/opensearch-admin';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// SIEM index-lifecycle context (read-only): the index templates that govern what mappings/settings/
// rollover-alias a new audit index inherits. Deploy-owned, so read-only. Thin: auth, call the lib.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await listIndexTemplates());
}
