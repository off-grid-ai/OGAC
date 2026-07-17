import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlueprintForm } from '../src/components/solutions/BlueprintForm.tsx';
import { DeploymentForm } from '../src/components/solutions/DeploymentForm.tsx';

test('the rendered blueprint create journey exposes requirements, outcome, ROI and proof controls', () => {
  const html = renderToStaticMarkup(createElement(BlueprintForm));
  for (const label of [
    'Blueprint name',
    'Business owner',
    'Required data domains',
    'Governed pipeline',
    'Outcome contract',
    'Baseline',
    'Target',
    'Measured',
    'Justifiable ROI',
    'Annual benefit',
    'Implementation cost',
    'Proof version',
    'Proven deployments',
  ])
    assert.match(html, new RegExp(label));
  assert.match(html, /Create blueprint/);
});

test('deployment creation visibly binds a blueprint to a canonical App', () => {
  const html = renderToStaticMarkup(
    createElement(DeploymentForm, {
      blueprints: [{ id: 'bp-1', label: 'Delinquency Intervention' }],
      apps: [{ id: 'app-1', label: 'Collections App' }],
    }),
  );
  assert.match(html, />Blueprint</);
  assert.match(html, />Canonical App</);
  assert.match(html, /Delinquency Intervention/);
  assert.match(html, /Collections App/);
  assert.match(html, /Bind existing App/);
});
