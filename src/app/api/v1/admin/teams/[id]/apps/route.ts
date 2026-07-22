import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { getApp } from '@/lib/apps-store';
import { requireAdmin } from '@/lib/authz';
import { bindAppToTeam, getTeam, listTeamAppIds } from '@/lib/teams';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// A team's GOVERNED apps/agents (the app tier of team RBAC). Binding an app to a team gives that
// team's members delegated access to it, scored by the same team-access rule pipelines use. GET lists
// the governed apps (id/title/pipeline); POST binds an app (body { appId }). Admin-gated, org-scoped,
// audited. One team per app — re-binding an already-governed app moves it to this team.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const team = await getTeam(id, orgId);
  if (!team) return NextResponse.json({ error: 'unknown team' }, { status: 404 });

  const appIds = await listTeamAppIds(id, orgId);
  const apps = await Promise.all(appIds.map((appId) => getApp(appId, orgId)));
  const data = apps
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .map((a) => ({ id: a.id, title: a.title, published: a.published }));
  return NextResponse.json({ object: 'list', data });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const team = await getTeam(id, orgId);
  if (!team) return NextResponse.json({ error: 'unknown team' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { appId?: unknown } | null;
  const appId = typeof body?.appId === 'string' ? body.appId.trim() : '';
  if (!appId) return NextResponse.json({ error: 'appId is required' }, { status: 400 });

  const app = await getApp(appId, orgId);
  if (!app) return NextResponse.json({ error: 'unknown app' }, { status: 400 });

  await bindAppToTeam(id, appId, orgId);
  auditFromSession(gate, orgId, {
    action: 'team.app.bind',
    resource: `app:${appId}`,
    outcome: 'ok',
  });
  return NextResponse.json({ id: app.id, title: app.title, published: app.published }, {
    status: 201,
  });
}
