import { notFound } from 'next/navigation';
import { AppQualityPanel } from '@/components/build/AppQualityPanel';
import { AppQualityCoverage, type NotWatching } from '@/components/build/AppQualityCoverage';
import { listDriftRunsForApp } from '@/lib/drift-runs';
import { appDriftSentence } from '@/lib/quality-plain';
import { RealCaseQualityCard } from '@/components/build/RealCaseQualityCard';
import { Card, CardContent } from '@/components/ui/card';
import { FEEDBACK_SUITE } from '@/lib/feedback-map';
import { getAlertDestination } from '@/lib/qa/quality-alert-destination-store';
import { SuggestedChecks } from '@/components/build/SuggestedChecks';
import { listAppRunsView } from '@/lib/app-runs-view-reader';
import { listOnlineScoresForApp } from '@/lib/qa/online-scores';
import { qualityOnRealCases } from '@/lib/quality-on-real-cases';
import { getApp } from '@/lib/apps-store';
import { listEvalDefs } from '@/lib/eval-defs';
import { listEvalRuns, listGoldenCases } from '@/lib/evals';
import { lastRunPerCheck, runsPerCheck } from '@/lib/quality-plain';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app QUALITY tab (pipeline-owns-governance #154/#158) ─────────────────────────────────────
// The founder's ask made concrete: an eval / golden set / drift is owned BY a pipeline, not a floating
// global entity. This screen shows the evals + golden set THIS pipeline owns (app_id = this app), run
// in the pipeline's own context, plus the org-wide library you can attach from. Answers "where do I
// run it, how do I test it, what does it apply to" — it applies to THIS pipeline.
export default async function AppQualityTab({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) notFound();

  // RESOLVE THE PIPELINE ONCE, then query BOTH panels by it.
  //
  // This screen is titled "Evals for this pipeline" and "Golden set for this pipeline", and it was querying
  // both by APP id — so an app showed "0 attached" and "Golden set (0)" while the pipeline it runs on had
  // evals and golden cases sitting right there. Golden cases already existed for pipelines nobody had
  // touched and still displayed 0, which is how it was caught: the data was never missing, the filter was
  // asking the wrong question. A heading that says "pipeline" and a query that says "app" is the bug stated
  // in the UI.
  //
  // Falling back to the app id keeps an UNBOUND app working (it has no pipeline to ask about) and keeps any
  // app-scoped rows authored before this visible, so nothing already attached disappears.
  const scope = app.pipelineId?.trim()
    ? { pipelineId: app.pipelineId, appId: undefined }
    : { appId: id, pipelineId: undefined };
  const [evals, golden, libraryEvals, pastRuns] = await Promise.all([
    listEvalDefs(scope),
    listGoldenCases(scope),
    // ORG-WIDE LIBRARY = unattached to BOTH an app and a pipeline. `listEvalDefs(null)` is the legacy
    // string|null form meaning `appId: null`, which filters `app_id IS NULL` ONLY — so every
    // pipeline-bound eval that has no app leaked in here and was offered for "attaching" when it was
    // already attached. That is the four identical "Hallucination / Faithfulness" chips. It would also
    // have grown by 21 the moment the per-pipeline dedupe cleared `app_id`.
    listEvalDefs({ pipelineId: null }), // → pipeline_id IS NULL AND app_id IS NULL
    // THE LAST RESULT PER CHECK. The tab had a Run button and no last result: the display existed but
    // was filled only by clicking Run in that session, so opening the tab could never answer "is this
    // app OK right now?". Read here, best-effort — a failed read leaves the checks reading "never run",
    // which is honest, rather than implying a pass.
    listEvalRuns(200, orgId).catch(() => []),
  ]);

  const checkHistory = runsPerCheck(
    evals.map((d) => ({ id: d.id, metric: d.metric, pipelineId: app.pipelineId ?? null })),
    pastRuns.map((r) => ({
      engine: r.engine,
      passed: r.passed,
      total: r.total,
      startedAt: String(r.startedAt ?? ''),
      pipelineId: (r as { pipelineId?: string | null }).pipelineId ?? null,
    })),
  );

  // QUALITY ON REAL CASES. The judge already scores finished runs into online_scores tagged
  // `app:<id>`; nothing read it back on the app that produced them. Coverage is computed against how
  // many cases actually FINISHED, so an average over one of ten cannot read as the app's quality.
  const [verdicts, appRuns] = await Promise.all([
    listOnlineScoresForApp(id, orgId).catch(() => []),
    listAppRunsView(id, orgId, 500).catch(() => []),
  ]);
  const finishedCases = appRuns.filter((r) =>
    ['done', 'error', 'cancelled'].includes(String(r.status)),
  ).length;
  const realCases = qualityOnRealCases(
    verdicts.map((v) => ({
      runId: v.runId,
      quality: v.quality,
      faithfulness: v.faithfulness,
      judged: v.judged,
      reasoning: v.reasoning,
      ts: v.ts,
    })),
    finishedCases,
  );

  // EVERYTHING THAT WATCHES THIS APP, and where each one stands. Built from what is genuinely
  // derivable for THIS app — anything that is not gets said, not faked.
  const pipelineId = app.pipelineId ?? null;
  const alertDest = await getAlertDestination(orgId).catch(() => null);
  const corrections = golden.filter((g) => g.suite === FEEDBACK_SUITE).length;

  // ONLY THE ABSENCES. Everything present is already on this tab in full; listing it again was noise,
  // and the version that did contradicted the page (it counted raw golden rows, 18, while the section
  // below dedupes to 7). Each entry below is derived, and the block disappears when nothing is missing.
  const coverage: NotWatching[] = [];
  if (evals.length === 0) {
    coverage.push({
      name: 'Automated checks',
      reason: 'none are attached, so nothing verifies this app on demand',
    });
  }
  if (corrections === 0) {
    coverage.push({
      name: 'Corrections from real use',
      reason:
        'nobody has marked a decision wrong yet, so nothing has been learned from real work — the control sits on each waiting case',
    });
  }
  if (pipelineId) {
    coverage.push({
      name: 'Release gate and auto-rollback',
      reason:
        'they belong to the pipeline this app shares with others, not to this app alone, so its releases are gated jointly',
      href: `/runtime/pipelines/${encodeURIComponent(pipelineId)}/quality`,
    });
  } else {
    coverage.push({
      name: 'Release gate and auto-rollback',
      reason: 'this app is bound to no pipeline, so nothing gates its releases and there is no version to roll back to',
    });
  }
  // DRIFT, now attributable. This used to be an unconditional gap: drift_runs carried only org_id, so a
  // per-app figure would have been invented. Rather than leave it as a permanent absence, the run now
  // RECORDS which app it was for (drift_runs.app_id), so this reports the real answer — and still says
  // "nothing yet" honestly for an app that has never had a check run for it.
  const appDrift = await listDriftRunsForApp(id, orgId).catch(() => []);
  const driftSentence = appDriftSentence(
    appDrift.map((r) => ({ status: r.status, driftShare: r.driftShare, startedAt: r.startedAt })),
  );
  if (appDrift.length === 0) {
    coverage.push({
      name: 'Drift on this app’s data',
      reason:
        'no drift check has been run for this app yet, so it is not known whether the data feeding it has shifted',
      href: '/insights/quality/drift',
    });
  }
  if (!alertDest) {
    coverage.push({
      name: 'Quality alerts',
      reason: 'no destination is configured, so a drop is only visible to someone who opens this tab',
    });
  }

  const lastRuns = lastRunPerCheck(
    evals.map((d) => ({ id: d.id, metric: d.metric, pipelineId: app.pipelineId ?? null })),
    pastRuns.map((r) => ({
      engine: r.engine,
      passed: r.passed,
      total: r.total,
      startedAt: String(r.startedAt ?? ''),
      pipelineId: (r as { pipelineId?: string | null }).pipelineId ?? null,
    })),
  );

  return (
    <div className="space-y-6">
      {/* ROADMAP §10 Flow 3 ("generates the app and tests … generates or updates evaluations"): checks
          derived from this app's own design, offered for a person to accept. Above the panel because a
          new app's evaluation set is empty and this is what fills it. */}
      <SuggestedChecks appId={id} appTitle={app.title} />
      <RealCaseQualityCard quality={realCases} appHref={`/solutions/apps/${encodeURIComponent(id)}`} />
      <AppQualityCoverage items={coverage} />
      {/* The positive answer, when there is one. Only reachable because the run records which app it was
          for — otherwise this would be an org-wide number wearing this app's name. */}
      {driftSentence ? (
        <Card className="shadow-sm">
          <CardContent className="py-4">
            <p className="text-xs font-medium text-foreground">Has the data feeding this app shifted?</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{driftSentence}</p>
          </CardContent>
        </Card>
      ) : null}
      <AppQualityPanel
        appId={id}
        appTitle={app.title}
        evals={evals}
        golden={golden}
        libraryEvals={libraryEvals}
        lastRuns={lastRuns}
        history={checkHistory}
        now={new Date().toISOString()}
      />
    </div>
  );
}
