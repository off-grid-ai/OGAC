import { notFound } from 'next/navigation';
import { AppQualityPanel } from '@/components/build/AppQualityPanel';
import { AppQualityCoverage, type CoverageItem } from '@/components/build/AppQualityCoverage';
import { RealCaseQualityCard } from '@/components/build/RealCaseQualityCard';
import { listDriftRuns } from '@/lib/drift-runs';
import { FEEDBACK_SUITE } from '@/lib/feedback-map';
import { listRollbackHistory } from '@/lib/pipeline-release';
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
  const [rollbacks, driftRuns, alertDest] = await Promise.all([
    pipelineId ? listRollbackHistory(pipelineId, orgId).catch(() => []) : Promise.resolve([]),
    listDriftRuns(5, orgId).catch(() => []),
    getAlertDestination(orgId).catch(() => null),
  ]);
  const corrections = golden.filter((g) => g.suite === FEEDBACK_SUITE).length;

  const coverage: CoverageItem[] = [
    {
      name: 'Quality checks',
      what: 'Automated checks run against this app on demand.',
      state: evals.length > 0 ? 'here' : 'off',
      detail:
        evals.length === 0
          ? 'No checks attached, so nothing is verifying this app automatically.'
          : `${evals.length} attached — their last results are below.`,
    },
    {
      name: 'Test cases',
      what: 'The examples those checks are measured against.',
      state: 'here',
      detail: `${golden.length} case${golden.length === 1 ? '' : 's'} on this app's pipeline.`,
    },
    {
      name: 'Quality on real cases',
      what: 'A judge scores finished cases in the background.',
      state: 'here',
      // Points at the card above rather than repeating its sentence verbatim — the list has to stay
      // complete to be a coverage list, but a duplicated paragraph reads as a rendering fault.
      detail: 'Shown in full at the top of this tab.',
    },
    {
      name: 'Corrections from real use',
      what: 'When someone says a decision was wrong, it becomes a test case.',
      state: corrections > 0 ? 'here' : 'off',
      detail:
        corrections > 0
          ? `${corrections} correction${corrections === 1 ? '' : 's'} captured from real decisions.`
          : 'Nobody has marked a decision wrong yet, so nothing has been learned from real use. The control is on each waiting case.',
    },
    {
      name: 'Release gate',
      what: 'Blocks publishing when the checks have not passed.',
      state: pipelineId ? 'linked' : 'off',
      detail: pipelineId
        ? 'Configured on the pipeline this app runs on, not per app — several apps can share one pipeline, so the gate is theirs jointly.'
        : 'This app is not bound to a pipeline, so nothing gates its releases.',
      href: pipelineId ? `/runtime/pipelines/${encodeURIComponent(pipelineId)}/quality` : undefined,
    },
    {
      name: 'Auto-rollback',
      what: 'Returns to the last good version when quality drops.',
      state: pipelineId ? 'linked' : 'off',
      detail: pipelineId
        ? `${rollbacks.length} rollback point${rollbacks.length === 1 ? '' : 's'} on the shared pipeline.`
        : 'No pipeline bound, so there is no version to roll back to.',
      href: pipelineId ? `/runtime/pipelines/${encodeURIComponent(pipelineId)}/quality` : undefined,
    },
    {
      name: 'Drift',
      what: 'Watches whether the incoming data has changed shape.',
      state: 'linked',
      // Deliberately NOT faked per app: drift_runs carry org and dataset only — no app or pipeline —
      // so any per-app drift number here would be invented. Checked, not assumed.
      detail:
        driftRuns.length === 0
          ? 'No drift run recorded for this organization. Drift is tracked per DATASET, not per app, so it cannot be attributed to this one.'
          : `${driftRuns.length} recent drift run${driftRuns.length === 1 ? '' : 's'} for this organization. Tracked per DATASET, not per app, so none of them is attributable to this app.`,
      href: '/insights/quality/drift',
    },
    {
      name: 'Quality alerts',
      what: 'Tells someone when quality drops, without them looking.',
      state: alertDest ? 'here' : 'off',
      detail: alertDest
        ? 'A destination is configured, so a drop is reported out of band.'
        : 'No destination configured, so a quality drop is only visible to someone who opens this tab.',
    },
  ];

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
