// The question the guide asks when a reader hits "Explain this page".
//
// It lives in a pure lib and is tested because this sentence IS the product surface — it decides what
// a stranger is told about a screen — and because two of its properties are load-bearing rather than
// cosmetic.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageExplanationQuestion } from '@/lib/guide-events';

test('the SECTION is named, not just the leaf', () => {
  // Overview, Audit and Export each exist under more than one section, so "explain Overview" is
  // unanswerable. The section is what makes the question resolvable.
  const q = pageExplanationQuestion({ title: 'Overview', eyebrow: 'Governance' });
  assert.match(q, /Governance → Overview/);
});

test("the page's own description is fed to the model when it has one", () => {
  // Grounds the answer in how the product already describes itself instead of letting the model
  // invent a purpose for the screen.
  const q = pageExplanationQuestion({
    title: 'Evidence',
    eyebrow: 'Governance',
    description: 'Inspect audit, security, provenance, and exportable evidence.',
  });
  assert.match(q, /describes itself as: Inspect audit, security, provenance/);
});

test('a page with no description still produces a clean question', () => {
  const q = pageExplanationQuestion({ title: 'Runs', eyebrow: 'Operations' });
  assert.match(q, /Operations → Runs/);
  assert.ok(!q.includes('describes itself as'), 'no dangling empty description clause');
  assert.ok(!q.includes('undefined'));
});

test('a route with no registered identity falls back to something answerable', () => {
  // The guide passes the raw pathname when route-identity has no entry, rather than asking about "".
  const q = pageExplanationQuestion({ title: '/some/unregistered/route' });
  assert.match(q, /"\/some\/unregistered\/route"/);
  assert.ok(!q.includes('→'), 'no empty section separator when there is no eyebrow');
});

test('it asks for what a newcomer actually needs', () => {
  const q = pageExplanationQuestion({ title: 'Catalog', eyebrow: 'Data' });
  assert.match(q, /what is it for/i);
  assert.match(q, /what should I check first/i);
});
