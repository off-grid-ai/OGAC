import { NextResponse } from 'next/server';
import { kestraCatalog } from '@/lib/adapters/kestra-catalog';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// The input schema of a single plugin task/trigger type (its properties, which are required, and the
// outputs it produces) — so an operator can see exactly what a composable action needs before adding
// it to a flow. `type` is a fully-qualified class id (io.kestra.plugin.core.log.Log).
export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { type } = await params;
  const schema = await kestraCatalog.getPluginSchema(type);
  if (!schema) {
    return NextResponse.json({ error: 'plugin type not found or engine unreachable' }, { status: 404 });
  }
  return NextResponse.json(schema);
}
