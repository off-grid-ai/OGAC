import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuilderCapabilityContext } from '@/components/build/BuilderCapabilityContext';
import { buildBuilderCapabilityView } from '@/lib/builder-capability-view';
import {
  loadBuilderCapabilityContext,
  parseEnterpriseContextEnvelope,
} from '@/lib/enterprise-context-client';
import type { EnterpriseContextResolution } from '@/lib/enterprise-context-resolver';

function resolution(): EnterpriseContextResolution {
  return {
    policyVersion: 'enterprise-context/v1',
    evaluatedAt: '2026-07-23T01:00:00.000Z',
    actor: {
      actorId: 'builder@bank.test',
      principalKind: 'user',
      role: 'operator',
      baseRole: 'operator',
      departments: ['Retail'],
      teams: ['cross-sell'],
    },
    tenant: { effectiveOrgId: 'org-bank', requestedOrgId: 'org-bank' },
    resources: [
      {
        ref: 'data:customers',
        sliceId: 'data',
        kind: 'data',
        label: 'Customer records',
        description: 'Approved customer profile fields.',
        disposition: 'ready',
        canSelect: true,
        canUseNow: true,
        requiresApproval: false,
        reasonCode: 'data.ready',
        reason: 'Customer records are ready to use.',
      },
      {
        ref: 'tool:crm',
        sliceId: 'capabilities',
        kind: 'capability',
        label: 'CRM follow-up',
        disposition: 'unavailable',
        canSelect: false,
        canUseNow: false,
        requiresApproval: false,
        reasonCode: 'crm-connector-required',
        reason: 'Connect the CRM before using this option.',
        remedyHref: '/data/sources?setup=crm',
      },
      {
        ref: 'action:email',
        sliceId: 'actions',
        kind: 'action',
        label: 'Send a customer email',
        disposition: 'approval-required',
        canSelect: true,
        canUseNow: false,
        requiresApproval: true,
        reasonCode: 'action.maker-checker',
        reason: 'A second person must approve this action.',
        action: {
          connectorCompatibility: 'compatible',
          approvalRequired: true,
          eligiblePriorHumanSteps: [{ ref: 'step:manager', label: 'Manager review' }],
        },
      },
    ],
    omittedCount: 1,
    intentDecisions: [
      {
        intent: 'build.create',
        status: 'allowed',
        source: 'module-access',
        reasonCode: 'build.allowed',
        reason: 'You can create apps.',
      },
      {
        intent: 'build.edit',
        status: 'denied',
        source: 'app-access',
        reasonCode: 'edit.denied',
        reason: 'You can view this app but cannot edit it.',
      },
    ],
    allowedIntents: ['build.create'],
    slices: [
      {
        id: 'data',
        label: 'Data',
        status: 'ready',
        source: 'org-context',
        reasonCode: 'data.ready',
        reason: 'Data is ready.',
      },
      {
        id: 'capabilities',
        label: 'Tools',
        status: 'partial',
        source: 'catalog',
        reasonCode: 'tools.partial',
        reason: 'Some tools need setup.',
      },
      {
        id: 'pipelines',
        label: 'Pipelines',
        status: 'failed',
        source: 'org-context',
        reasonCode: 'pipelines.load-failed',
        reason: 'Pipelines could not be loaded.',
        remedyHref: '/runtime/pipelines',
      },
      {
        id: 'actions',
        label: 'Actions',
        status: 'ready',
        source: 'catalog',
        reasonCode: 'actions.ready',
        reason: 'Actions are ready.',
      },
    ],
    summary: {
      visible: 3,
      omitted: 1,
      ready: 1,
      approvalRequired: 1,
      unavailable: 1,
      denied: 0,
    },
  };
}

test('accepts only the frozen enterprise-context envelope and complete data shape', () => {
  const source = resolution();
  assert.equal(
    parseEnterpriseContextEnvelope({ object: 'enterprise_context', data: source }),
    source,
  );
  assert.throws(
    () => parseEnterpriseContextEnvelope({ object: 'list', data: source }),
    /response was incomplete/,
  );

  const malformed = [
    (() => {
      const value = structuredClone(source);
      (value.resources[0] as unknown as { managementHref: number }).managementHref = 7;
      return value;
    })(),
    (() => {
      const value = structuredClone(source);
      value.resources[2].action = {
        ...value.resources[2].action!,
        connectorCompatibility: 'broken' as 'compatible',
      };
      return value;
    })(),
    (() => {
      const value = structuredClone(source);
      (value.resources[2].action as unknown as { impactSummary: number }).impactSummary = 4;
      return value;
    })(),
    (() => {
      const value = structuredClone(source);
      value.slices[0].source = 'unknown' as 'catalog';
      return value;
    })(),
    (() => {
      const value = structuredClone(source);
      (value.intentDecisions[0] as unknown as { remedyHref: number }).remedyHref = 5;
      return value;
    })(),
  ];
  for (const data of malformed) {
    assert.throws(
      () => parseEnterpriseContextEnvelope({ object: 'enterprise_context', data }),
      /response was incomplete/,
    );
  }
  assert.throws(
    () =>
      parseEnterpriseContextEnvelope({
        object: 'enterprise_context',
        data: { ...source, resources: [{ ref: 'broken' }] },
      }),
    /response was incomplete/,
  );
});

test('loads create and edit context through the exact no-store API URLs', async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    seen.push({ url: String(input), init });
    return Response.json({ object: 'enterprise_context', data: resolution() });
  };

  const create = await loadBuilderCapabilityContext(fetchImpl);
  const edit = await loadBuilderCapabilityContext(fetchImpl, 'app 10/claims');
  assert.equal(create.controls[0].state, 'enabled');
  assert.equal(edit.slices[1].status, 'partial');
  assert.deepEqual(
    seen.map((entry) => entry.url),
    ['/api/v1/admin/enterprise-context', '/api/v1/admin/enterprise-context?appId=app+10%2Fclaims'],
  );
  assert.ok(seen.every((entry) => entry.init?.cache === 'no-store'));
});

test('turns non-success and malformed success responses into honest load errors', async () => {
  await assert.rejects(
    () => loadBuilderCapabilityContext(async () => new Response(null, { status: 503 })),
    /could not be loaded/,
  );
  await assert.rejects(
    () =>
      loadBuilderCapabilityContext(async () =>
        Response.json({ object: 'enterprise_context', data: {} }),
      ),
    /response was incomplete/,
  );
});

test('renders shared loading and retryable error states', () => {
  const loading = renderToStaticMarkup(
    createElement(BuilderCapabilityContext, {
      state: { status: 'loading' },
      onRetry() {},
    }),
  );
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Available to you/);
  assert.equal((loading.match(/data-slot="skeleton"/g) ?? []).length, 4);

  const error = renderToStaticMarkup(
    createElement(BuilderCapabilityContext, {
      state: { status: 'error', message: 'Available options are taking too long to load.' },
      onRetry() {},
    }),
  );
  assert.match(error, /Available options could not be loaded/);
  assert.match(error, /taking too long/);
  assert.match(error, />Try again</);
});

test('renders grouped ready, partial, failed, setup, approval, and hidden-count states plainly', () => {
  const source = resolution();
  source.slices.unshift({
    id: 'identity',
    label: 'Your organization access',
    status: 'ready',
    source: 'org-context',
    reasonCode: 'identity.ready',
    reason: 'Your role is ready.',
  });
  for (let index = 0; index < 5; index += 1) {
    source.resources.push({
      ...source.resources[0],
      ref: `data:extra-${index}`,
      label: `Additional data ${index + 1}`,
    });
  }
  const html = renderToStaticMarkup(
    createElement(BuilderCapabilityContext, {
      state: { status: 'ready', view: buildBuilderCapabilityView(source) },
      onRetry() {},
    }),
  );

  for (const label of ['Data', 'Tools', 'Pipelines', 'Actions'])
    assert.match(html, new RegExp(label));
  assert.match(html, /Some tools need setup/);
  assert.match(html, /Pipelines could not be loaded/);
  assert.match(html, /No options can be selected until this section loads/);
  assert.match(html, /CRM follow-up/);
  assert.match(html, /Setup needed/);
  assert.match(html, /href="\/data\/sources\?setup=crm"/);
  assert.match(html, /Use an existing approval step/);
  assert.match(html, /Manager review/);
  assert.match(html, /1 not shown by access/);
  assert.doesNotMatch(html, /Your organization access/);
  assert.match(html, /data-slot="disclosure"/);
  assert.match(html, /Show 2 more/);
  assert.doesNotMatch(html, /enterprise-context\/v1|maker-checker|crm-connector-required/);
  assert.match(html, /md:grid-cols-2 xl:grid-cols-4/);
});
