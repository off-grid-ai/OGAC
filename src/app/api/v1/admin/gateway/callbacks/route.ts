import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getCallbacksStatus } from '@/lib/adapters/litellm-callbacks';

export const dynamic = 'force-dynamic';

// Gateway structured-callbacks status — the LIVE active success/failure callback sinks the proxy fans
// every model call to (Langfuse / OTel / S3 / webhook), classified + rendered honestly. Global
// callbacks are configured at deploy (config file + reload); this is the read side.
// Honest: configured:false when OFFGRID_LITELLM_URL is unset; reachable:false + error when the proxy
// or the callbacks API isn't there (404 on versions without it).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const status = await getCallbacksStatus();
  return NextResponse.json(status);
}
