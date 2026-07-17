import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Link from 'next/link.js';
import type { AppSpec } from '../src/lib/app-model.ts';
import { canonicalAgentCatalog } from '../src/lib/agent-catalog.ts';
import type { AgentDef } from '../src/lib/agents.ts';

const builtin: AgentDef = {
  id: 'builtin_claims',
  name: 'Claims capability',
  role: 'Claims',
  description: 'Built in',
  planes: [],
  tools: [],
  grounded: false,
  trigger: 'on-demand',
};

const runtime: AgentDef = {
  ...builtin,
  id: 'agent_runtime_hidden',
  name: 'Materialized runtime row',
  custom: true,
};

function app(id: string, steps: AppSpec['steps']): AppSpec {
  return {
    id,
    orgId: 'org_a',
    ownerId: 'owner@test.local',
    title: id,
    summary: '',
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps,
    edges: steps.length > 1 ? [{ from: steps[0].id, to: steps[1].id }] : [],
  };
}

test('canonical agent catalog excludes runtime rows and keeps one-step AppSpecs as authored agents', () => {
  const oneStep = app('app_authored', [
    {
      id: 'agent',
      label: 'Decide claim',
      kind: 'agent',
      inlineAgent: { systemPrompt: 'Decide.' },
    },
  ]);
  const workflow = app('app_workflow', [
    { id: 'agent', label: 'Decide', kind: 'agent', inlineAgent: { systemPrompt: 'Decide.' } },
    { id: 'output', label: 'Report', kind: 'output', sink: 'console' },
  ]);

  const catalog = canonicalAgentCatalog([builtin, runtime], [oneStep, workflow]);
  assert.deepEqual(
    catalog.builtIns.map((agent) => agent.id),
    ['builtin_claims'],
  );
  assert.deepEqual(
    catalog.authored.map((spec) => spec.id),
    ['app_authored'],
  );

  // Render the actual Next Link primitive from the canonical projection. Each entity has one
  // deep-linkable owner: built-ins use runtime detail; authored agents use the App lifecycle.
  const markup = renderToStaticMarkup(
    createElement(
      'nav',
      null,
      ...catalog.builtIns.map((agent) =>
        createElement(Link, { key: agent.id, href: `/build/agents/${agent.id}` }, agent.name),
      ),
      ...catalog.authored.map((spec) =>
        createElement(Link, { key: spec.id, href: `/build/apps/${spec.id}` }, spec.title),
      ),
      createElement(Link, { href: '/build/studio/new' }, 'New agent'),
    ),
  );

  assert.match(markup, /href="\/build\/agents\/builtin_claims"/);
  assert.match(markup, /href="\/build\/apps\/app_authored"/);
  assert.match(markup, /href="\/build\/studio\/new"/);
  assert.doesNotMatch(markup, /agent_runtime_hidden|app_workflow/);
});
