import assert from 'node:assert/strict';
import test from 'node:test';
import { isCompatibleCrmActionConnector } from '../src/lib/action-connector-compatibility.ts';
import type { AppSpec } from '../src/lib/app-model.ts';
import {
  getEnterpriseContext,
  type EnterpriseContextSources,
} from '../src/lib/enterprise-context.ts';
import type { PipelineView } from '../src/lib/pipelines.ts';
import { allModuleIds } from '../src/lib/roles.ts';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const publishedApp: AppSpec = {
  id: 'app-published',
  orgId: ORG_A,
  ownerId: 'owner@a.test',
  title: 'Customer follow-up',
  summary: 'Creates the right next step.',
  visibility: 'org',
  published: true,
  trigger: { kind: 'on-demand' },
  steps: [{ id: 'review', label: 'Manager review', kind: 'human' }],
  edges: [],
};

const pipeline: PipelineView = {
  id: 'pl-ready',
  orgId: ORG_A,
  ownerId: 'owner@a.test',
  teamId: 'team-risk',
  name: 'Customer decisions',
  description: 'Governed customer decisioning.',
  visibility: 'org',
  gatewayId: null,
  defaultModel: null,
  routing: {},
  dataAllowlist: [],
  policyOverlay: {},
  guardrailOverlay: {},
  status: 'published',
  version: 3,
  isTemplate: false,
  createdAt: null,
  updatedAt: null,
};

function sources(overrides: Partial<EnterpriseContextSources> = {}): EnterpriseContextSources {
  return {
    async resolvePermissions(role) {
      return {
        role: role ?? 'viewer',
        baseRole: role ?? 'viewer',
        isCustom: false,
        modules: new Set(allModuleIds()),
      };
    },
    async listMemberships(userId) {
      return [{ teamId: 'team-risk', userId, role: 'lead' }];
    },
    async listTeams() {
      return [
        {
          id: 'team-risk',
          name: 'Risk operations',
          description: '',
          department: 'Risk',
          memberCount: 1,
          createdAt: null,
          updatedAt: null,
        },
      ];
    },
    async listDomains() {
      return [
        {
          id: 'domain-a',
          orgId: ORG_A,
          label: 'Customer opportunities',
          aliases: ['opportunities'],
          connectorId: 'con-crm',
          resource: 'opportunities',
        },
        {
          id: 'domain-cross-tenant',
          orgId: ORG_B,
          label: 'Secret claims',
          aliases: [],
          connectorId: 'con-b',
          resource: 'claims',
        },
      ];
    },
    async listConnectors() {
      return [
        {
          id: 'con-crm',
          name: 'CRM',
          type: 'rest',
          status: 'connected',
          lastSync: null,
          endpoint: 'http://crm.local/api',
          auth: 'api-key',
          description: 'Sensitive connection detail',
          custom: false,
        },
      ];
    },
    async listTools() {
      return [
        {
          id: 'collections',
          name: 'Collections system',
          type: 'http',
          endpoint: 'https://secret.internal/token',
          description: 'Create a collections work item.',
          enabled: true,
          policy: 'approval',
        },
      ];
    },
    async listApps() {
      return [publishedApp];
    },
    async getApp(id, orgId) {
      return id === publishedApp.id && orgId === ORG_A ? publishedApp : null;
    },
    async listPipelines() {
      return [pipeline];
    },
    async resolveCaller(actor, orgId) {
      return {
        userId: actor.userId,
        role: actor.role,
        department: 'Risk',
        orgId,
      };
    },
    async appAccess() {
      return { allow: true, reason: 'run permitted (shared editor)' };
    },
    ...overrides,
  };
}

function request(role: string, appId: string | null = null) {
  return {
    orgId: ORG_A,
    actor: { userId: `${role}@a.test`, role },
    appId,
    evaluatedAt: '2026-07-23T00:00:00.000Z',
    env: {},
  };
}

test('safe projection composes real catalog policy without leaking secrets or cross-tenant identities', async () => {
  const result = await getEnterpriseContext(request('admin', publishedApp.id), sources());

  assert.equal(result.tenant.effectiveOrgId, ORG_A);
  assert.equal(result.omittedCount, 1);
  assert.equal(
    result.resources.some((resource) => resource.ref === 'data:domain-a'),
    true,
  );
  assert.equal(
    result.resources.some((resource) => resource.ref === 'data:domain-cross-tenant'),
    false,
  );
  assert.equal(
    result.resources.some((resource) => resource.ref === 'app:app-published'),
    false,
    'the current App is excluded by the canonical cycle-aware app catalog',
  );

  const registered = result.resources.find((resource) => resource.ref === 'tool:collections');
  assert.equal(registered?.disposition, 'approval-required');
  assert.equal(registered?.canSelect, true);
  assert.equal(registered?.canUseNow, false);

  const crmAction = result.resources.find((resource) => resource.ref === 'action:crm.create-task');
  assert.equal(crmAction?.disposition, 'approval-required');
  assert.equal(crmAction?.action?.connectorCompatibility, 'compatible');
  assert.deepEqual(crmAction?.action?.eligiblePriorHumanSteps, [
    { ref: 'review', label: 'Manager review' },
  ]);

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /secret\.internal|api-key|Sensitive connection detail/);
  assert.doesNotMatch(serialized, /Secret claims|domain-cross-tenant|con-b/);
});

test('viewer, operator, and admin intent decisions reflect the actual admin-gated Builder surface', async () => {
  const [viewer, operator, admin] = await Promise.all([
    getEnterpriseContext(request('viewer'), sources()),
    getEnterpriseContext(request('operator'), sources()),
    getEnterpriseContext(request('admin'), sources()),
  ]);

  assert.deepEqual(viewer.allowedIntents, []);
  assert.equal(
    viewer.intentDecisions.every((decision) => decision.reasonCode === 'read-only-role'),
    true,
  );
  assert.deepEqual(operator.allowedIntents, []);
  assert.equal(
    operator.intentDecisions.every((decision) => decision.reasonCode === 'admin-required'),
    true,
  );
  assert.deepEqual(admin.allowedIntents, [
    'action.configure',
    'build.create',
    'build.edit',
    'data.configure',
    'publish',
    'tool.select',
  ]);

  for (const result of [viewer, operator]) {
    const data = result.resources.find((resource) => resource.ref === 'data:domain-a');
    const tool = result.resources.find((resource) => resource.ref === 'tool:collections');
    const action = result.resources.find((resource) => resource.ref === 'action:crm.create-task');
    assert.equal(data?.canSelect, false);
    assert.equal(tool?.canSelect, false);
    assert.equal(action?.canSelect, false);
    assert.equal(action?.disposition, 'denied', 'actor denial outranks maker-checker approval');
  }
  assert.equal(
    admin.resources.find((resource) => resource.ref === 'data:domain-a')?.canSelect,
    true,
  );
  assert.equal(
    admin.resources.find((resource) => resource.ref === 'tool:collections')?.canSelect,
    true,
  );
  assert.equal(
    admin.resources.find((resource) => resource.ref === 'action:crm.create-task')?.canSelect,
    true,
  );
});

test('one failed source degrades only its slices and never exposes static actions without resolved availability', async () => {
  const result = await getEnterpriseContext(
    request('admin'),
    sources({
      async listConnectors() {
        throw new Error('database connection lost');
      },
    }),
  );

  assert.equal(
    result.resources.some((resource) => resource.ref === 'tool:collections'),
    true,
  );
  assert.equal(
    result.resources.some((resource) => resource.ref === 'pipeline:pl-ready'),
    true,
  );
  assert.equal(
    result.resources.some((resource) => resource.kind === 'action'),
    false,
  );
  assert.equal(result.slices.find((entry) => entry.id === 'actions')?.status, 'failed');
  assert.equal(result.slices.find((entry) => entry.id === 'data')?.status, 'partial');
  assert.equal(result.slices.find((entry) => entry.id === 'capabilities')?.status, 'ready');
  assert.equal(
    result.resources.find((resource) => resource.ref === 'data:domain-a')?.disposition,
    'unavailable',
  );
  assert.doesNotMatch(JSON.stringify(result), /database connection lost/);
});

test('hidden app and pipeline authorization facts are omitted instead of returned as denied identities', async () => {
  const result = await getEnterpriseContext(
    request('admin'),
    sources({
      async resolvePermissions() {
        return {
          role: 'custom',
          baseRole: 'viewer',
          isCustom: true,
          modules: new Set(['studio', 'tools', 'data', 'pipelines']),
        };
      },
      async listMemberships() {
        return [];
      },
      async appAccess() {
        return { allow: false, reason: 'not shared' };
      },
    }),
  );

  assert.equal(
    result.resources.some((resource) => resource.ref === 'app:app-published'),
    false,
  );
  assert.equal(
    result.resources.some((resource) => resource.ref === 'pipeline:pl-ready'),
    false,
  );
  assert.ok(result.omittedCount >= 2);
});

test('disabled, blocked, cyclic, and unpublished capabilities remain visible with honest dispositions', async () => {
  const cyclicTarget: AppSpec = {
    ...publishedApp,
    id: 'app-target',
    title: 'Target App',
    ownerId: 'admin@a.test',
    steps: [
      {
        id: 'agent',
        label: 'Agent',
        kind: 'agent',
        inlineAgent: { systemPrompt: 'Help.', tools: ['app:app-caller'] },
      },
    ],
  };
  const caller: AppSpec = {
    ...publishedApp,
    id: 'app-caller',
    title: 'Caller App',
    ownerId: 'admin@a.test',
    published: false,
    steps: [{ id: 'review', label: 'Review', kind: 'human' }],
  };
  const result = await getEnterpriseContext(
    request('admin', caller.id),
    sources({
      async listApps() {
        return [caller, cyclicTarget];
      },
      async getApp(id) {
        return id === caller.id ? caller : null;
      },
      async listTools() {
        return [
          {
            id: 'blocked',
            name: 'Blocked tool',
            type: 'http',
            endpoint: 'http://internal',
            description: '',
            enabled: true,
            policy: 'blocked',
          },
          {
            id: 'disabled',
            name: 'Disabled tool',
            type: 'http',
            endpoint: 'http://internal',
            description: '',
            enabled: false,
            policy: 'allow',
          },
        ];
      },
      async listPipelines() {
        return [{ ...pipeline, ownerId: 'admin@a.test', status: 'draft' }];
      },
    }),
  );

  assert.equal(
    result.resources.find((resource) => resource.ref === 'tool:blocked')?.disposition,
    'denied',
  );
  assert.equal(
    result.resources.find((resource) => resource.ref === 'tool:disabled')?.disposition,
    'unavailable',
  );
  assert.equal(
    result.resources.find((resource) => resource.ref === 'app:app-target')?.disposition,
    'unavailable',
  );
  assert.equal(
    result.resources.find((resource) => resource.ref === 'pipeline:pl-ready')?.disposition,
    'unavailable',
  );
  assert.equal(
    result.resources.find((resource) => resource.ref === 'prim:web_search')?.disposition,
    'unavailable',
  );
});

test('caller resolution failure hides reusable App identities and marks access-dependent slices partial', async () => {
  const editingApp: AppSpec = {
    ...publishedApp,
    id: 'app-editing',
    title: 'Editing App',
    published: false,
  };
  const result = await getEnterpriseContext(
    request('admin', editingApp.id),
    sources({
      async getApp(id) {
        return id === editingApp.id ? editingApp : null;
      },
      async resolveCaller() {
        throw new Error('team store unavailable');
      },
    }),
  );

  assert.equal(
    result.resources.some((resource) => resource.ref === 'app:app-published'),
    false,
  );
  assert.equal(result.slices.find((entry) => entry.id === 'capabilities')?.status, 'partial');
  assert.equal(result.slices.find((entry) => entry.id === 'app')?.status, 'partial');
  assert.equal(result.slices.find((entry) => entry.id === 'data')?.status, 'ready');
  assert.doesNotMatch(JSON.stringify(result), /team store unavailable/);
});

test('CRM action compatibility requires explicit CRM identity as well as an internal REST endpoint', async () => {
  assert.equal(
    isCompatibleCrmActionConnector({
      name: 'Bharat CRM',
      type: 'rest',
      endpoint: 'http://crm.local/api',
    }),
    true,
  );
  assert.equal(
    isCompatibleCrmActionConnector({
      name: 'Generic operations API',
      type: 'rest',
      endpoint: 'http://operations.local/api',
    }),
    false,
  );
  assert.equal(
    isCompatibleCrmActionConnector({
      name: 'Salesforce',
      type: 'rest',
      endpoint: 'https://salesforce.example.com/api',
    }),
    false,
  );

  const result = await getEnterpriseContext(
    request('admin'),
    sources({
      async listConnectors() {
        return [
          {
            id: 'con-generic',
            name: 'Generic operations API',
            type: 'rest',
            status: 'connected',
            lastSync: null,
            endpoint: 'http://operations.local/api',
            auth: 'none',
            description: '',
            custom: false,
          },
        ];
      },
    }),
  );
  const action = result.resources.find((resource) => resource.ref === 'action:crm.create-task');
  assert.equal(action?.disposition, 'unavailable');
  assert.equal(action?.action?.connectorCompatibility, 'incompatible');
});
