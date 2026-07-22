import { NextResponse } from 'next/server';
import { kestraCatalog } from '@/lib/adapters/kestra-catalog';
import { requireAdmin } from '@/lib/authz';
import { summarizePluginCatalog } from '@/lib/kestra-catalog';

export const dynamic = 'force-dynamic';

// The installed orchestration plugin catalog: the composable actions (tasks/triggers/conditions) an
// operator can wire into a governed flow/app step. Read-only. Degrades to an empty catalog when the
// engine is unreachable so the surface renders an honest state, never a 500.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const groups = await kestraCatalog.listPlugins();
  return NextResponse.json({
    configured: kestraCatalog.configured(),
    summary: summarizePluginCatalog(groups),
    groups,
  });
}
