import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppSpec } from '@/lib/app-model';
import type { AppRunView } from '@/lib/app-runs-view';
import {
  BankCrossSellExecutionError,
  readBankCrossSellOpportunityBook,
  startBankCrossSellRecommendation,
  type BankCrossSellExecutionSources,
} from '@/lib/adapters/bank-cross-sell-execution';

const APP: AppSpec = {
  id: 'app_cross_sell',
  orgId: 'org_bank',
  ownerId: 'owner',
  title: 'Cross sell',
  summary: '',
  visibility: 'org',
  published: true,
  slug: 'cross-sell',
  pipelineId: 'pipe',
  trigger: { kind: 'on-demand' },
  steps: [
    { id: 'read-customer', label: 'Customer', kind: 'connector-query', domain: 'customer data' },
    { id: 'read-rate', label: 'Rates', kind: 'connector-query', domain: 'pricing rate card' },
    { id: 'recommend', label: 'Recommend', kind: 'agent', agentId: 'rm-agent' },
    { id: 'review', label: 'RM review', kind: 'human' },
    { id: 'output', label: 'Report', kind: 'output', sink: 'report' },
  ],
  edges: [
    { from: 'read-customer', to: 'read-rate' },
    { from: 'read-rate', to: 'recommend' },
    { from: 'recommend', to: 'review' },
    { from: 'review', to: 'output' },
  ],
};

function sources(): BankCrossSellExecutionSources & {
  current: AppRunView | null;
  submittedInput: Record<string, unknown> | null;
} {
  const source = {
    current: null as AppRunView | null,
    submittedInput: null as Record<string, unknown> | null,
    loadContext: async () => ({
      customerDomain: 'customer data',
      eligibilityDomain: 'pricing rate card',
      customerResource: 'accounts',
      eligibilityResource: 'pricing_rate_card',
      customerConnectorId: 'crm',
      eligibilityConnectorId: 'rates',
      readAt: '2026-07-23T00:00:00.000Z',
      customerRows: [
        {
          id: 7,
          name: 'Alpha Ltd',
          industry: 'Insurance',
          group_size: 30,
          owner: 'rm@example.test',
        },
      ],
      eligibilityRows: [
        {
          scheme_type: 'Group Term',
          age_band: '31-40',
          base_rate_per_mille: 1.2,
          min_group_size: 10,
        },
      ],
    }),
    getAppBySlug: async () => APP,
    listRuns: async () => (source.current ? [source.current] : []),
    getRun: async () => source.current,
    listOutcomes: async () => [],
    submit: async (
      spec: AppSpec,
      input: Record<string, unknown>,
      context: { orgId: string; actor: string; runId: string },
    ) => {
      assert.equal(spec.steps.find((step) => step.kind === 'action')?.kind, 'action');
      source.submittedInput = input;
      source.current = {
        id: context.runId,
        appId: spec.id,
        status: 'awaiting_human',
        input,
        outcome: '',
        provenance: null,
        startedAt: '2026-07-23T00:01:00.000Z',
        finishedAt: null,
        steps: spec.steps.map((step) => ({
          id: step.id,
          kind: step.kind,
          label: step.label,
          status:
            step.kind === 'human'
              ? 'awaiting_human'
              : step.id === 'cross-sell-writeback' || step.id === 'output'
                ? 'queued'
                : 'done',
        })),
      };
      return {
        runId: context.runId,
        mode: 'inline' as const,
        submitted: false,
        status: 'awaiting_human',
      };
    },
  };
  return source;
}

test('live book starts one governed run and freezes the approved source/action facts', async () => {
  const deps = sources();
  const initial = await readBankCrossSellOpportunityBook('cross-sell', 'org_bank', deps);
  assert.equal(initial.opportunities[0].source.kind, 'live');
  assert.equal(initial.evidence[0].phase, 'needs-recommendation');

  const started = await startBankCrossSellRecommendation(
    {
      slug: 'cross-sell',
      orgId: 'org_bank',
      actor: 'rm@example.test',
      customerId: '7',
    },
    deps,
  );
  assert.equal(started.evidence.phase, 'needs-rm-decision');
  const frozen = deps.submittedInput?.crossSell as {
    recommendation: { product: string };
    action: { actionId: string; connectorId: string; accountId: string };
  };
  assert.equal(frozen.recommendation.product, 'Group Term');
  assert.deepEqual(frozen.action, {
    actionId: 'crm.create-task',
    connectorId: 'crm',
    accountId: '7',
  });
  await assert.rejects(
    startBankCrossSellRecommendation(
      {
        slug: 'cross-sell',
        orgId: 'org_bank',
        actor: 'rm@example.test',
        customerId: '7',
      },
      deps,
    ),
    (error) => error instanceof BankCrossSellExecutionError && error.code === 'duplicate-run',
  );
});
