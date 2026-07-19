import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PipelineDetailRail } from '../src/components/pipelines/PipelineDetailNav.tsx';

test('pipeline lifecycle rail renders canonical grouped links with one active route', () => {
  const html = renderToStaticMarkup(
    createElement(PipelineDetailRail, {
      pipelineId: 'pl_42',
      name: 'Cross-Sell Advisor',
      active: 'audit',
    }),
  );

  assert.match(html, /<aside[^>]+aria-label="Pipeline"/);
  assert.match(html, /<nav[^>]+aria-label="Cross-Sell Advisor sections"/);
  assert.match(html, /Pipeline navigation/);
  assert.match(html, />Overview</);
  assert.match(html, />Configure</);
  assert.match(html, />Govern</);
  assert.match(html, />Assure</);
  assert.match(html, />Observe</);

  for (const route of [
    '',
    '/routing',
    '/api',
    '/versions',
    '/policy',
    '/guardrails',
    '/quality',
    '/drift',
    '/observability',
    '/audit',
    '/cost',
  ]) {
    assert.match(html, new RegExp(`href="/runtime/pipelines/pl_42${route}"`));
  }

  assert.match(html, /href="\/runtime\/pipelines\/pl_42\/audit" aria-current="page"/);
  assert.match(html, /<details[^>]+data-slot="disclosure"[^>]+open=""[^>]*>.*?>Observe</s);
  assert.doesNotMatch(
    html,
    /<h[1-6][^>]*>/,
    'the rail must not take heading ownership from the page',
  );
});

test('pipeline lifecycle rail composes the shared disclosure primitive', () => {
  const html = renderToStaticMarkup(
    createElement(PipelineDetailRail, {
      pipelineId: 'pl_42',
      name: 'Cross-Sell Advisor',
      active: 'overview',
    }),
  );

  assert.equal((html.match(/data-slot="disclosure"/g) ?? []).length, 5);
  assert.equal((html.match(/data-slot="disclosure-trigger"/g) ?? []).length, 5);
  assert.equal((html.match(/data-slot="disclosure-content"/g) ?? []).length, 5);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
});
