import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PageSkeleton } from '@/components/PageSkeleton';
import { CopilotConsole } from '@/components/copilot/CopilotConsole';
import { PolicyTemplatesPanel } from '@/components/policy/PolicyTemplatesPanel';

test('page loading uses shared, softly elevated surfaces with phased skeleton motion', () => {
  const html = renderToStaticMarkup(createElement(PageSkeleton, { stats: 4, cards: 8 }));

  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-slot="skeleton"/);
  assert.match(html, /data-slot="card"/);
  assert.match(html, /data-og-surface="raised"/);
  assert.match(html, /border-border\/60/);
  assert.match(html, /--skeleton-phase:0/);
  assert.match(html, /--skeleton-phase:3/);
  assert.doesNotMatch(html, /border-black|border-foreground/);
});

test('policy templates flow through one responsive grid and carry quiet group and effect labels', () => {
  const html = renderToStaticMarkup(createElement(PolicyTemplatesPanel));

  assert.match(html, /sm:grid-cols-2/);
  assert.match(html, /2xl:grid-cols-4/);
  assert.equal((html.match(/data-template-group="Data residency"/g) ?? []).length, 2);
  assert.equal((html.match(/data-template-group="Egress control"/g) ?? []).length, 2);
  assert.equal((html.match(/data-template-group="Model governance"/g) ?? []).length, 2);
  assert.equal((html.match(/data-template-group="Operations"/g) ?? []).length, 1);
  assert.match(html, /data-variant="outline"/);
  assert.match(html, /border-border bg-muted\/60 text-foreground/);
  assert.doesNotMatch(html, /border-destructive\/25 text-destructive/);
  assert.doesNotMatch(html, /data-variant="destructive"|bg-destructive(?:\s|\/)/);
  assert.doesNotMatch(html, /<section/);
});

test('copilot anomaly rail keeps its description in the shared header slot and uses a quiet alert', () => {
  const html = renderToStaticMarkup(
    createElement(CopilotConsole, {
      anomalies: [
        {
          metric: 'daily cost',
          label: '2026-07-05',
          value: 0.0191,
          baseline: 0.0031,
          deviation: 26.98,
          direction: 'spike' as const,
          severity: 'critical' as const,
        },
      ],
    }),
  );

  assert.match(html, /data-slot="card-header"/);
  assert.match(html, /data-slot="card-description"/);
  assert.match(html, /Anomalies right now/);
  assert.match(html, /not a fixed threshold/);
  assert.match(html, /xl:grid-cols-\[minmax\(36rem,1fr\)_minmax\(20rem,24rem\)\]/);
  assert.match(html, /data-variant="outline"/);
  assert.match(html, /border-destructive\/25 bg-transparent text-destructive/);
  assert.doesNotMatch(html, /bg-destructive\/10|bg-amber-500/);
});
