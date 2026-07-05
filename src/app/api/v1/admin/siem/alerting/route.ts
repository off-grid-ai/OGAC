import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createMonitor, listMonitors } from '@/lib/opensearch-alerting';
import { normalizeMonitorSpec } from '@/lib/opensearch-alerting-shape';

export const dynamic = 'force-dynamic';

// SIEM alerting monitors — list + create over OpenSearch's `_plugins/_alerting/monitors`. Thin: auth,
// parse/normalize, call the lib. Degrades gracefully (supported:false) when the plugin is absent.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await listMonitors());
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const spec = normalizeMonitorSpec(body ?? {});
  if (!spec) return NextResponse.json({ error: 'name and index are required' }, { status: 400 });
  const result = await createMonitor(spec);
  if (result.error) return NextResponse.json(result, { status: 502 });
  return NextResponse.json(result, { status: result.supported ? 201 : 200 });
}
