import { NextResponse } from 'next/server';
import { AppValidationError, getApp, updateApp } from '@/lib/apps-store';
import { diffAppVersions } from '@/lib/app-version-diff';
import { getAppVersion } from '@/lib/app-versions-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; version: string }> };

// GET …/versions/[version] — one frozen snapshot, plus what it would change if restored NOW. The
// second half is the point: an operator deciding whether to roll back needs to see what rolling back
// would undo, not just what the old version contained.
export async function GET(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id, version } = await params;
  const orgId = await currentOrgId();
  const [app, snapshot] = await Promise.all([
    getApp(id, orgId),
    getAppVersion(id, Number(version), orgId),
  ]);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!snapshot) return NextResponse.json({ error: 'no such version' }, { status: 404 });

  const live = {
    title: app.title,
    summary: app.summary,
    visibility: app.visibility,
    pipelineId: app.pipelineId ?? null,
    slug: app.slug ?? null,
    published: app.published,
    trigger: app.trigger,
    inputForm: app.inputForm ?? null,
    steps: app.steps as never,
    edges: app.edges,
  };
  return NextResponse.json({
    ...snapshot,
    // "What restoring this would change", i.e. live → this version.
    wouldChange: diffAppVersions(live, snapshot.snapshot),
  });
}

// POST …/versions/[version] — RESTORE that version as the live app.
//
// ROADMAP §10 Flow 7 step 7 ("rolls out or rolls back") and §11's "human control … reversal". A restore
// is not a special write: it goes through `updateApp`, so validation, agent re-sync and — importantly —
// the version writer all run exactly as they do for a hand edit. The restore therefore APPENDS a new
// version rather than rewinding history, which is the only honest way to record it: nothing is
// un-happened, and the audit trail keeps every state the app was ever in.
export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id, version } = await params;
  const orgId = await currentOrgId();
  const target = Number(version);
  const snapshot = await getAppVersion(id, target, orgId);
  if (!snapshot) return NextResponse.json({ error: 'no such version' }, { status: 404 });

  const s = snapshot.snapshot;
  try {
    const restored = await updateApp(id, orgId, {
      title: s.title,
      summary: s.summary,
      visibility: s.visibility as 'private' | 'org' | 'public' | undefined,
      pipelineId: s.pipelineId ?? null,
      trigger: s.trigger as never,
      inputForm: (s.inputForm ?? undefined) as never,
      steps: (s.steps ?? []) as never,
      edges: (s.edges ?? []) as never,
      editedBy: gate.user.email ?? '',
      versionNote: `Rolled back to v${target}`,
    });
    if (!restored) return NextResponse.json({ error: 'not found' }, { status: 404 });
    // A rollback is a consequential action: it changes what the app will DO on its next run, so it
    // lands in the ledger like a publish does.
    auditFromSession(gate, orgId, {
      action: 'app.rollback',
      resource: `app:${id}#v${target}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true, restoredFrom: target, app: restored });
  } catch (e) {
    // A snapshot can fail validation if the model has moved on since it was frozen. Say that, with the
    // reasons — silently refusing a rollback is the worst possible outcome for the operator using it.
    if (e instanceof AppValidationError) {
      return NextResponse.json(
        { error: 'that version is no longer valid', reason: e.errors.join('; ') },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
