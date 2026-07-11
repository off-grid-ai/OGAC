import { NextResponse } from 'next/server';
import { appToolCatalog } from '@/lib/app-tools';
import { listApps } from '@/lib/apps-store';
import { requireAdmin } from '@/lib/authz';
import { listTools } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { primitiveCatalog } from '@/lib/tool-primitives';

// ─── Tool catalog (Builder Epic #117) — the three grouped, labeled tool sources the picker offers ─
// Assembles, for the builder's dead-simple tool picker, the three sources a non-technical builder can
// grant an agent step: their published APPS (apps-as-tools, each flagged if it would cycle), the
// built-in PRIMITIVES (web_search/read_url/… with live enabled/off state from env — air-gap safe),
// and the org's REGISTERED tools (http/mcp). Admin-gated, org-scoped, read-only. The heavy lifting is
// the pure catalog builders (tool-primitives.ts, app-tools.ts); this route is a thin aggregator.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();

  // The app being edited (so apps-as-tools can flag which candidates would create a cycle).
  const callerAppId = new URL(req.url).searchParams.get('appId') ?? '';

  const [tools, apps] = await Promise.all([listTools(orgId), listApps(orgId)]);

  const primitives = primitiveCatalog(process.env as Record<string, string | undefined>);
  const appTools = appToolCatalog(apps, callerAppId);
  const registered = tools
    .filter((t) => t.enabled)
    .map((t) => ({
      id: t.id,
      ref: `tool:${t.id}`,
      name: t.name,
      description: t.description || `${t.type} tool`,
      type: t.type,
      policy: t.policy,
    }));

  return NextResponse.json({
    object: 'tool-catalog',
    apps: appTools,
    primitives,
    registered,
  });
}
