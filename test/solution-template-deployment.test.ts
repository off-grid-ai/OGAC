import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppSpec } from '../src/lib/app-model.ts';
import type { DataDomain } from '../src/lib/data-domains.ts';
import {
  bindSolutionActionConnector,
  capabilitySelectionProjection,
  registeredTemplateMatches,
  solutionAppRequirements,
} from '../src/lib/solution-template-deployment.ts';
import { parseSolutionTemplateDeploymentRequest } from '../src/lib/solution-template-deployment-request.ts';

const app: AppSpec = {
  id: 'app_template',
  orgId: 'org_source',
  ownerId: 'author@test.local',
  title: 'Collections intervention',
  summary: 'Governed intervention',
  visibility: 'org',
  published: true,
  pipelineId: 'pipeline_source',
  trigger: { kind: 'on-demand' },
  steps: [
    { id: 'read', kind: 'connector-query', label: 'Read loans', domain: 'loan accounts' },
    { id: 'approve', kind: 'human', label: 'Approve' },
    {
      id: 'act',
      kind: 'action',
      label: 'Create follow-up',
      actionId: 'crm.create-task',
      connectorId: 'source_crm',
      command: {
        subject: 'Call borrower',
        useCase: 'collections',
        kind: 'call',
        accountId: 'acct_101',
      },
      approvalStepId: 'approve',
    },
  ],
  edges: [
    { from: 'read', to: 'approve' },
    { from: 'approve', to: 'act' },
  ],
};

const domains: DataDomain[] = [
  {
    id: 'dom_loans',
    orgId: 'org_target',
    label: 'loan accounts',
    aliases: ['loans'],
    connectorId: 'con_core',
    resource: 'accounts',
  },
];

test('deployment request parser accepts only an explicit version, template, pipeline and string values', () => {
  assert.deepEqual(
    parseSolutionTemplateDeploymentRequest({
      blueprintVersion: 2,
      templateId: ' app_template ',
      pipelineId: ' pipeline_target ',
      title: ' Target collections ',
      actionConnectorId: ' crm_target ',
      values: { team: ' Collections ' },
    }),
    {
      value: {
        blueprintVersion: 2,
        templateId: 'app_template',
        pipelineId: 'pipeline_target',
        title: 'Target collections',
        actionConnectorId: 'crm_target',
        values: { team: 'Collections' },
      },
      errors: [],
    },
  );

  const invalid = parseSolutionTemplateDeploymentRequest({
    blueprintVersion: '2',
    templateId: '',
    pipelineId: '',
    title: ' ',
    actionConnectorId: ' ',
    values: { team: 42 },
  });
  assert.equal(invalid.value, null);
  assert.deepEqual(invalid.errors, [
    'blueprint version must be a positive integer',
    'template is required',
    'governed pipeline is required',
    'App title cannot be blank',
    'action connection cannot be blank',
    'template values must be a string map',
  ]);
  assert.deepEqual(parseSolutionTemplateDeploymentRequest(null).errors, [
    'a JSON deployment request is required',
  ]);
});

test('registered template matching is exact by id or canonical published slug', () => {
  const template = { id: 'app_template', slug: 'collections-template-abc123' };
  assert.equal(registeredTemplateMatches('app_template', template), true);
  assert.equal(registeredTemplateMatches('collections-template-abc123', template), true);
  assert.equal(registeredTemplateMatches('collections-template', template), false);
  assert.equal(registeredTemplateMatches('', template), false);
});

test('solution requirements preserve data and governed action intent while rebinding the tenant connector', () => {
  const bound = bindSolutionActionConnector(app, 'crm_target');
  assert.equal((app.steps[2] as { connectorId: string }).connectorId, 'source_crm');
  assert.deepEqual(solutionAppRequirements(bound), {
    dataDomains: ['loan accounts'],
    actions: [
      {
        stepId: 'act',
        label: 'Create follow-up',
        actionId: 'crm.create-task',
        connectorId: 'crm_target',
        approvalStepId: 'approve',
      },
    ],
  });
});

test('enterprise selection projection resolves labels and aliases to canonical ids without changing the runtime graph', () => {
  const projected = capabilitySelectionProjection(app, domains);
  assert.equal((projected.steps[0] as { domain: string }).domain, 'dom_loans');
  assert.equal((app.steps[0] as { domain: string }).domain, 'loan accounts');

  const aliasApp = {
    ...app,
    steps: app.steps.map((step) =>
      step.kind === 'connector-query' ? { ...step, domain: 'loans' } : step,
    ),
  };
  assert.equal(
    (capabilitySelectionProjection(aliasApp, domains).steps[0] as { domain: string }).domain,
    'dom_loans',
  );
  const unknownApp = {
    ...app,
    steps: app.steps.map((step) =>
      step.kind === 'connector-query' ? { ...step, domain: 'unknown domain' } : step,
    ),
  };
  assert.equal(
    (capabilitySelectionProjection(unknownApp, domains).steps[0] as { domain: string }).domain,
    'unknown domain',
  );
});
