import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideRouting, type RoutingRuleLite } from '../src/lib/routing-policy.ts';
import { planCloudRoute } from '../src/lib/cloud-routing.ts';
import { parseCloudProviders, type CloudEnv } from '../src/lib/cloud-providers.ts';

// PURE governance chokepoint. The load-bearing invariants: PII/block/local NEVER reach cloud, egress
// off hard-stops cloud, and an unconfigured cloud route degrades honestly (never fabricates cloud).
// Exercised end-to-end through the REAL decideRouting → planCloudRoute pipeline, no mocks.

const openaiEnv: CloudEnv = {
  OFFGRID_CLOUD_OPENAI_API_KEY: 'sk-test',
  OFFGRID_CLOUD_OPENAI_MODEL: 'gpt-4o-mini',
};
const providers = parseCloudProviders(openaiEnv);

const rules: RoutingRuleLite[] = [
  { name: 'pii-local', priority: 10, attribute: 'data_class', operator: 'eq', value: 'pii', action: 'local', model: 'gemma-local', fallback: 'local', enabled: true },
  { name: 'secret-block', priority: 20, attribute: 'data_class', operator: 'eq', value: 'secret', action: 'block', model: '', fallback: 'block', enabled: true },
  { name: 'public-cloud', priority: 30, attribute: 'data_class', operator: 'eq', value: 'public', action: 'cloud', model: 'openai/gpt-4o-mini', fallback: 'local', enabled: true },
];

function plan(attrs: Record<string, string>, egressAllowed: boolean, provs = providers) {
  const decision = decideRouting(rules, attrs, egressAllowed);
  return planCloudRoute(decision, provs, egressAllowed);
}

// ── INVARIANT 1: block never leaves ──────────────────────────────────────────────
test('INVARIANT: a blocked data class NEVER reaches cloud (even with egress on + provider wired)', () => {
  const p = plan({ data_class: 'secret' }, true);
  assert.equal(p.kind, 'block');
  assert.equal(p.selection, null);
});

// ── INVARIANT 2: local stays local ───────────────────────────────────────────────
test('INVARIANT: PII → local NEVER reaches cloud (egress on, provider wired)', () => {
  const p = plan({ data_class: 'pii' }, true);
  assert.equal(p.kind, 'local');
  assert.equal(p.selection, null);
  assert.equal(p.cloudUnavailable, false);
});

// ── INVARIANT 3: egress-off hard-stops cloud ─────────────────────────────────────
test('INVARIANT: public → cloud is BLOCKED when org egress is OFF (leash)', () => {
  const p = plan({ data_class: 'public' }, false);
  assert.equal(p.kind, 'block');
  assert.equal(p.selection, null);
  assert.match(p.reason, /egress is OFF|leash/i);
});

test('INVARIANT: egress-off blocks cloud even if a decision is hand-built as effective:cloud', () => {
  // Defence in depth: planCloudRoute re-asserts the leash independently of decideRouting.
  const forged = { action: 'cloud', effective: 'cloud', model: 'gpt-4o', fallback: 'local', matched: 'x', reason: 'forged' } as const;
  const p = planCloudRoute(forged, providers, /* egressAllowed */ false);
  assert.equal(p.kind, 'block');
});

// ── The happy path: public → cloud when everything permits ───────────────────────
test('public → cloud reaches the configured provider when egress is ON', () => {
  const p = plan({ data_class: 'public' }, true);
  assert.equal(p.kind, 'cloud');
  assert.equal(p.selection?.provider.id, 'openai');
  assert.equal(p.selection?.model, 'gpt-4o-mini');
  assert.equal(p.cloudUnavailable, false);
});

// ── INVARIANT 4: honest degradation when no provider configured ──────────────────
test('INVARIANT: cloud route with NO provider configured falls back to local + marks unavailable', () => {
  const p = plan({ data_class: 'public' }, true, /* no providers */ []);
  assert.equal(p.kind, 'local');
  assert.equal(p.cloudUnavailable, true);
  assert.equal(p.selection, null);
  assert.match(p.reason, /no provider configured/i);
});

test('honest degradation: fallback=block with no provider → block (not a fabricated cloud call)', () => {
  const blockFallbackRules: RoutingRuleLite[] = [
    { name: 'public-cloud', priority: 10, attribute: 'data_class', operator: 'eq', value: 'public', action: 'cloud', model: 'openai/gpt-4o', fallback: 'block', enabled: true },
  ];
  const decision = decideRouting(blockFallbackRules, { data_class: 'public' }, true);
  const p = planCloudRoute(decision, [], true);
  assert.equal(p.kind, 'block');
  assert.equal(p.cloudUnavailable, true);
});

// ── No matching rule → local default, never cloud ────────────────────────────────
test('no matching rule defaults to local (never accidental cloud)', () => {
  const p = plan({ data_class: 'unmapped' }, true);
  assert.equal(p.kind, 'local');
  assert.equal(p.selection, null);
});
