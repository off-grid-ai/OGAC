import { NextResponse } from 'next/server';
import { getAppRun } from '@/lib/app-run-store';
import { caseTrail } from '@/lib/app-work-queue';
import { getAppBySlug } from '@/lib/apps-store';

export const dynamic = 'force-dynamic';

// ─── The run's outcome, for the DEPLOYED app ─────────────────────────────────────────────────────────
//
// `sharedSurface().runStatusBase` has always pointed here, but the route did not exist — so the run panel
// could never poll, and the best it could say after a run was "it is running now, look under Activity". The
// person did the work and got a redirect instead of an answer.
//
// Org-scoped through the app's own slug: a run is only readable via the app it belongs to, and only within
// that app's org. A runId from another app or another tenant is a 404, not a leak.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; runId: string }> },
) {
  const { slug, runId } = await params;
  const app = await getAppBySlug(slug);
  if (!app || !app.published) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const run = await getAppRun(runId, app.orgId);
  // Belongs-to check: the run must be THIS app's. Without it, any published app's slug would expose any run
  // in the same org.
  if (!run || run.appId !== app.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const steps = (run as { steps?: { kind?: string; status?: string }[] }).steps ?? [];
  return NextResponse.json({
    object: 'app_run',
    runId: run.id,
    status: String(run.status),
    outcome: (run as { outcome?: string | null }).outcome ?? null,
    // The governed trail, so the answer arrives with its provenance rather than as a bare string.
    trail: caseTrail(steps, { signed: Boolean((run as { provenance?: unknown }).provenance) }),
  });
}
