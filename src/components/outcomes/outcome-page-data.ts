import { getActionOutcome, listActionOutcomes } from '@/lib/action-outcome-observation-store';
import type { ActionOutcomeRecord } from '@/lib/action-outcome-contract';
import type { ActionReceipt } from '@/lib/action-contract';
import { getAppRunView } from '@/lib/app-runs-view-reader';
import type { AppRunView } from '@/lib/app-runs-view';
import { getApp } from '@/lib/apps-store';

export interface RunActionOutcomeContext {
  app: NonNullable<Awaited<ReturnType<typeof getApp>>>;
  run: AppRunView;
  stepId: string;
  receipt: ActionReceipt;
  records: ActionOutcomeRecord[];
  observation: ActionOutcomeRecord | null;
}

export async function getRunActionOutcomeContext(args: {
  appId: string;
  runId: string;
  stepId: string;
  orgId: string;
  outcomeId?: string;
}): Promise<RunActionOutcomeContext | null> {
  if (!args.stepId.trim()) return null;
  const [app, run] = await Promise.all([
    getApp(args.appId, args.orgId),
    getAppRunView(args.runId, args.orgId),
  ]);
  if (!app || !run || run.appId !== app.id) return null;
  const step = run.steps.find(
    (candidate) => candidate.id === args.stepId && candidate.actionReceipt,
  );
  if (!step?.actionReceipt) return null;
  const [records, observation] = await Promise.all([
    listActionOutcomes(args.runId, args.stepId, args.orgId),
    args.outcomeId
      ? getActionOutcome(args.outcomeId, args.runId, args.stepId, args.orgId)
      : Promise.resolve(null),
  ]);
  if (args.outcomeId && !observation) return null;
  return {
    app,
    run,
    stepId: args.stepId,
    receipt: step.actionReceipt,
    records,
    observation,
  };
}
