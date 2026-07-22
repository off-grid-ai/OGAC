import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SolutionDeploymentPanel,
  SolutionDeploymentRequestError,
  SolutionRequirementList,
  solutionDeploymentReceiptHref,
  submitSolutionDeployment,
  type SolutionRequirementView,
} from '@/components/solutions/SolutionDeploymentPanel';
import type {
  SolutionDeploymentReceipt,
  SolutionTemplateDeploymentRequest,
} from '@/lib/solution-template-deployment';

const readyRequirements: SolutionRequirementView[] = [
  {
    id: 'customers',
    label: 'Customer records',
    detail: 'The declared CRM connection is available.',
    status: 'ready',
  },
  {
    id: 'approval',
    label: 'Relationship manager approval',
    detail: 'A relationship manager approves the recommendation before CRM changes.',
    status: 'approval-required',
  },
];

function experience(overrides: Partial<Parameters<typeof SolutionDeploymentPanel>[0]> = {}) {
  return createElement(SolutionDeploymentPanel, {
    blueprintId: 'sbp_cross_sell',
    blueprintVersion: 3,
    solutionTitle: 'Bank relationship manager cross-sell',
    detailHref: '/solutions/catalogue/sbp_cross_sell',
    deploying: false,
    requirements: readyRequirements,
    templates: [
      {
        id: 'tpl_cross_sell',
        title: 'Cross-sell workflow',
        vars: [
          {
            name: 'offer_window_days',
            type: 'number',
            description: 'Offer window in days',
            required: true,
            default: '14',
          },
        ],
      },
    ],
    pipelines: [{ id: 'pl_retail', label: 'Retail relationship manager AI' }],
    connectors: [{ id: 'con_crm', label: 'Core CRM' }],
    hasActions: true,
    ...overrides,
  });
}

test('the catalogue detail keeps deployment URL-driven and blocks unavailable requirements with a remedy', () => {
  const ready = renderToStaticMarkup(experience());
  assert.match(ready, /href="\/solutions\/catalogue\/sbp_cross_sell\?deploy=1"/);
  assert.match(ready, /Configure and deploy/);

  const requirements: SolutionRequirementView[] = [
    {
      id: 'pipeline',
      label: 'Retail governed AI',
      detail: 'No published pipeline currently satisfies this solution.',
      status: 'unavailable',
      remedyHref: '/runtime/pipelines',
    },
  ];
  const blocked = renderToStaticMarkup(
    createElement(
      'div',
      null,
      createElement(SolutionRequirementList, { requirements }),
      experience({ requirements, pipelines: [] }),
    ),
  );
  assert.match(blocked, /No published pipeline currently satisfies this solution/);
  assert.match(blocked, /href="\/runtime\/pipelines"/);
  assert.match(blocked, /1 requirement need setup/);
  assert.match(blocked, /disabled=""/);
  assert.doesNotMatch(blocked, /Configure and deploy/);
});

test('configuration exposes only registered variables and compatible governed choices', () => {
  const html = renderToStaticMarkup(experience({ deploying: true }));
  assert.match(html, /Configure your App/);
  assert.match(html, /offer_window_days/);
  assert.match(html, /value="pl_retail" selected=""/);
  assert.match(html, /value="con_crm" selected=""/);
  assert.match(html, /Source-organization credentials are never copied/);
  assert.match(html, /href="\/solutions\/catalogue\/sbp_cross_sell"/);
  assert.doesNotMatch(html, /actionId/);
  assert.doesNotMatch(html, /approvalStepId/);
  assert.doesNotMatch(html, /connector endpoint/i);
});

test('the client boundary posts the frozen contract and returns its canonical receipt', async () => {
  const received: { method?: string; path?: string; body?: unknown } = {};
  const receipt: SolutionDeploymentReceipt = {
    deploymentId: 'sdep_123',
    appId: 'app_123',
    blueprintId: 'sbp_cross_sell',
    blueprintVersion: 3,
    templateId: 'tpl_cross_sell',
    pipelineId: 'pl_retail',
    status: 'active',
    appHref: '/solutions/apps/app_123',
    appTitle: 'Bank relationship manager cross-sell',
    requirements: {
      dataDomains: ['customers'],
      actions: [
        {
          stepId: 'write-crm',
          label: 'Create CRM follow-up',
          actionId: 'crm.create-task',
          connectorId: 'con_crm',
          approvalStepId: 'rm-review',
        },
      ],
    },
  };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.method = request.method;
    received.path = request.url;
    received.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ receipt }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const request: SolutionTemplateDeploymentRequest = {
    blueprintVersion: 3,
    templateId: 'tpl_cross_sell',
    pipelineId: 'pl_retail',
    title: 'Retail cross-sell',
    values: { offer_window_days: '14' },
    actionConnectorId: 'con_crm',
  };
  try {
    const result = await submitSolutionDeployment(
      fetch,
      `http://127.0.0.1:${address.port}/api/v1/solution-blueprints/sbp_cross_sell/deploy`,
      request,
    );
    assert.deepEqual(result, receipt);
    assert.equal(received.method, 'POST');
    assert.equal(received.path, '/api/v1/solution-blueprints/sbp_cross_sell/deploy');
    assert.deepEqual(received.body, request);
    assert.equal(solutionDeploymentReceiptHref(result), '/solutions/deployed/sdep_123');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('the client boundary preserves a governed server denial as useful nontechnical guidance', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(422, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: 'Choose one available on-prem CRM connection for this solution',
        errors: [],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    await assert.rejects(
      submitSolutionDeployment(
        fetch,
        `http://127.0.0.1:${address.port}/api/v1/solution-blueprints/sbp_cross_sell/deploy`,
        {
          blueprintVersion: 3,
          templateId: 'tpl_cross_sell',
          pipelineId: 'pl_retail',
          values: {},
        },
      ),
      (error: unknown) =>
        error instanceof SolutionDeploymentRequestError &&
        error.status === 422 &&
        /Choose one available on-prem CRM connection/.test(error.message),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
