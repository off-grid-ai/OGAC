import { submitAppRun } from '@/lib/adapters/apprun';
import { loadBankCrossSellContext } from '@/lib/adapters/bank-cross-sell-context';
import { listActionOutcomes } from '@/lib/action-outcome-observation-store';
import { newAppRunId } from '@/lib/app-run';
import { listAppRunsView, getAppRunView } from '@/lib/app-runs-view-reader';
import { getAppBySlug } from '@/lib/apps-store';
import {
  buildBankCrossSellRuntimeSpec,
  freezeBankCrossSellRunSnapshot,
  projectBankCrossSellEvidence,
  type BankCrossSellOpportunityEvidence,
} from '@/lib/bank-cross-sell-execution';
import { assembleBankCrossSellOpportunities } from '@/lib/bank-cross-sell-opportunity';
import type { AppSpec } from '@/lib/app-model';
import type { AppRunView } from '@/lib/app-runs-view';
import type { ActionOutcomeRecord } from '@/lib/action-outcome-contract';
import type { BankCrossSellSourceSnapshot } from '@/lib/bank-cross-sell-opportunity';

export type BankCrossSellExecutionFailure =
  | 'app-not-found'
  | 'customer-not-found'
  | 'duplicate-run'
  | 'recommendation-blocked'
  | 'run-not-found'
  | 'review-state'
  | 'runtime-unavailable';

export class BankCrossSellExecutionError extends Error {
  constructor(
    readonly code: BankCrossSellExecutionFailure,
    message: string,
  ) {
    super(message);
    this.name = 'BankCrossSellExecutionError';
  }
}

type RunHandle = Awaited<ReturnType<typeof submitAppRun>>;
export interface BankCrossSellExecutionSources {
  loadContext(orgId: string): Promise<BankCrossSellSourceSnapshot>;
  getAppBySlug(slug: string): Promise<AppSpec | null>;
  listRuns(appId: string, orgId: string, limit: number): Promise<AppRunView[]>;
  getRun(runId: string, orgId: string): Promise<AppRunView | null>;
  listOutcomes(runId: string, stepId: string, orgId: string): Promise<ActionOutcomeRecord[]>;
  submit(
    spec: AppSpec,
    input: Record<string, unknown>,
    context: { orgId: string; actor: string; runId: string },
  ): Promise<RunHandle>;
}

const defaultSources: BankCrossSellExecutionSources = {
  loadContext: loadBankCrossSellContext,
  getAppBySlug,
  listRuns: listAppRunsView,
  getRun: getAppRunView,
  listOutcomes: listActionOutcomes,
  submit: submitAppRun,
};

async function appFor(
  slug: string,
  orgId: string,
  sources: BankCrossSellExecutionSources,
): Promise<AppSpec> {
  const app = await sources.getAppBySlug(slug);
  if (!app || app.orgId !== orgId || !app.published) {
    throw new BankCrossSellExecutionError('app-not-found', 'Cross-sell App was not found');
  }
  return app;
}

async function outcomesFor(
  run: AppRunView,
  orgId: string,
  sources: BankCrossSellExecutionSources,
): Promise<ActionOutcomeRecord[]> {
  const step = run.steps.find(
    (candidate) => candidate.kind === 'action' && candidate.actionReceipt,
  );
  return step ? sources.listOutcomes(run.id, step.id, orgId) : [];
}

async function evidenceFor(
  opportunity: ReturnType<typeof assembleBankCrossSellOpportunities>[number],
  run: AppRunView | null,
  orgId: string,
  sources: BankCrossSellExecutionSources,
): Promise<BankCrossSellOpportunityEvidence> {
  return projectBankCrossSellEvidence(
    opportunity,
    run,
    run ? await outcomesFor(run, orgId, sources) : [],
  );
}

export async function readBankCrossSellOpportunityBook(
  slug: string,
  orgId: string,
  sources: BankCrossSellExecutionSources = defaultSources,
): Promise<{
  opportunities: BankCrossSellOpportunityEvidence['opportunity'][];
  evidence: BankCrossSellOpportunityEvidence['evidence'][];
}> {
  const [app, snapshot] = await Promise.all([
    appFor(slug, orgId, sources),
    sources.loadContext(orgId),
  ]);
  const [opportunities, runs] = await Promise.all([
    Promise.resolve(assembleBankCrossSellOpportunities(snapshot)),
    sources.listRuns(app.id, orgId, 100),
  ]);
  const projected = await Promise.all(
    opportunities.map((opportunity) => {
      const run = runs.find(
        (candidate) => String(candidate.input.customerId ?? '') === opportunity.customerId,
      );
      return evidenceFor(opportunity, run ?? null, orgId, sources);
    }),
  );
  return {
    opportunities: projected.map((item) => item.opportunity),
    evidence: projected.map((item) => item.evidence),
  };
}

export async function startBankCrossSellRecommendation(
  input: { slug: string; orgId: string; actor: string; customerId: string },
  sources: BankCrossSellExecutionSources = defaultSources,
): Promise<BankCrossSellOpportunityEvidence> {
  const [app, snapshot] = await Promise.all([
    appFor(input.slug, input.orgId, sources),
    sources.loadContext(input.orgId),
  ]);
  const existingRuns = await sources.listRuns(app.id, input.orgId, 100);
  const opportunity = assembleBankCrossSellOpportunities(snapshot).find(
    (candidate) => candidate.customerId === input.customerId,
  );
  if (!opportunity) {
    throw new BankCrossSellExecutionError('customer-not-found', 'Customer was not found');
  }
  if (
    existingRuns.some(
      (run) =>
        ['queued', 'running', 'awaiting_human'].includes(run.status) &&
        String(run.input.customerId ?? '') === opportunity.customerId,
    )
  ) {
    throw new BankCrossSellExecutionError(
      'duplicate-run',
      'This customer already has a recommendation in progress',
    );
  }
  if (!snapshot.customerConnectorId) {
    throw new BankCrossSellExecutionError(
      'runtime-unavailable',
      'The governed CRM connection is unavailable',
    );
  }
  let runtime: AppSpec;
  try {
    runtime = buildBankCrossSellRuntimeSpec(app, opportunity, snapshot.customerConnectorId);
  } catch (error) {
    throw new BankCrossSellExecutionError(
      'recommendation-blocked',
      error instanceof Error ? error.message : 'Recommendation is not ready for action',
    );
  }
  const runId = newAppRunId();
  const frozen = freezeBankCrossSellRunSnapshot(opportunity, snapshot.customerConnectorId);
  const handle = await sources.submit(
    runtime,
    {
      customerId: opportunity.customerId,
      opportunityId: opportunity.opportunityId,
      sourceReadAt: snapshot.readAt,
      crossSell: frozen,
    },
    { orgId: input.orgId, actor: input.actor, runId },
  );
  const run = await sources.getRun(handle.runId, input.orgId);
  const current =
    run ??
    ({
      id: handle.runId,
      appId: app.id,
      status: handle.status ?? 'queued',
      input: { customerId: opportunity.customerId },
      steps: [],
      outcome: '',
      provenance: null,
      startedAt: null,
      finishedAt: null,
    } satisfies AppRunView);
  return evidenceFor(opportunity, current, input.orgId, sources);
}
