import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlueprintForm } from '../src/components/solutions/BlueprintForm.tsx';
import { DeploymentForm } from '../src/components/solutions/DeploymentForm.tsx';
import { ObservationForm } from '../src/components/solutions/ObservationForm.tsx';

test('the rendered blueprint create journey exposes requirements, outcome, ROI and proof controls', () => {
  const html = renderToStaticMarkup(createElement(BlueprintForm));
  for (const label of [
    'Blueprint name',
    'Business owner',
    'Required data domains',
    'Required governed pipeline',
    'Outcome contract',
    'Baseline',
    'Target',
    'Justifiable ROI',
    'Annual benefit',
    'Implementation cost',
    'Evidence status',
    'Adoptable runtime',
  ])
    assert.match(html, new RegExp(label));
  assert.match(html, /Create blueprint/);
  assert.match(html, /Hypotheses stay visible but cannot be deployed/);
});

test('deployment creation visibly binds a blueprint to a canonical App', () => {
  const html = renderToStaticMarkup(
    createElement(DeploymentForm, {
      blueprints: [{ id: 'bp-1', label: 'Delinquency Intervention', version: 2 }],
      apps: [
        {
          id: 'app-1',
          label: 'Collections App',
          compatibleBlueprintIds: ['bp-1'],
        },
      ],
    }),
  );
  assert.match(html, />Blueprint</);
  assert.match(html, />Canonical App</);
  assert.match(html, /Delinquency Intervention/);
  assert.match(html, /Collections App/);
  assert.match(html, /Adopt Blueprint/);
});

test('observation UI labels operator claims and system-derived evidence honestly', () => {
  const html = renderToStaticMarkup(createElement(ObservationForm, { deploymentId: 'dep-1' }));
  assert.match(html, /Record an operator KPI claim/);
  assert.match(html, /KPI label/);
  assert.match(html, /Minutes saved \/ run \(estimate\)/);
  assert.match(html, /Loaded cost \/ hour in USD \(estimate\)/);
  assert.match(html, /Completed runs and AI cost are read from canonical run evidence/);
  assert.doesNotMatch(html, /name="runsCompleted"/);
  assert.doesNotMatch(html, /name="actualAiCost"/);
  assert.match(html, /required="" name="evidenceLinks"/);
});
