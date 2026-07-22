import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateGate } from '../src/lib/service-topology.ts';
import {
  buildReadinessByService,
  consoleUsedEvidence,
  mergeReadinessEvidence,
  readinessFromHealth,
} from '../src/lib/service-readiness-probe.ts';
import type { ReadinessEvidence } from '../src/lib/service-topology.ts';

const AT = '2026-07-22T09:00:00.000Z';

test('up → deployed/reachable/functional all pass, stamped with source + observedAt', () => {
  const ev = readinessFromHealth({ id: 'llm-guard', status: 'up', ms: 67 }, AT);
  assert.deepEqual(
    ev.map((e) => [e.gate, e.state]),
    [
      ['deployed', 'pass'],
      ['reachable', 'pass'],
      ['functional', 'pass'],
    ],
  );
  assert.ok(ev.every((e) => e.observedAt === AT && e.source.includes('health probe')));
  assert.match(ev[0].summary, /67ms/);
  // a summarized gate over this evidence must be 'pass'
  assert.equal(aggregateGate(ev.filter((e) => e.gate === 'reachable')), 'pass');
});

test('embedded → deployed+functional pass, reachable omitted (not-applicable, no network hop)', () => {
  const ev = readinessFromHealth({ id: 'console', status: 'embedded' }, AT);
  assert.deepEqual(
    ev.map((e) => e.gate),
    ['deployed', 'functional'],
  );
  assert.ok(ev.every((e) => e.state === 'pass'));
});

test('down → reachable+functional FAIL, deployed unknown (never claimed deployed)', () => {
  const ev = readinessFromHealth({ id: 'jaeger', status: 'down', ms: 5000 }, AT);
  const byGate = Object.fromEntries(ev.map((e) => [e.gate, e.state]));
  assert.equal(byGate.reachable, 'fail');
  assert.equal(byGate.functional, 'fail');
  assert.equal(byGate.deployed, 'unknown');
  assert.equal(aggregateGate(ev.filter((e) => e.gate === 'reachable')), 'fail');
});

test('optional → all unknown, never a false pass', () => {
  const ev = readinessFromHealth({ id: 'openbao', status: 'optional' }, AT);
  assert.ok(ev.length === 3 && ev.every((e) => e.state === 'unknown'));
});

test('never fabricates the seeded or console-used gates', () => {
  for (const status of ['up', 'embedded', 'down', 'optional'] as const) {
    const gates = readinessFromHealth({ id: 'x', status }, AT).map((e) => e.gate);
    assert.ok(!gates.includes('seeded' as never));
    assert.ok(!gates.includes('console-used' as never));
  }
});

test('mergeReadinessEvidence: live REPLACES probed gates, preserves seeded/console-used', () => {
  const baseline: ReadinessEvidence[] = [
    { gate: 'deployed', state: 'unknown', summary: 'baseline', source: 'registry' },
    { gate: 'reachable', state: 'unknown', summary: 'baseline', source: 'registry' },
    { gate: 'functional', state: 'unknown', summary: 'baseline', source: 'registry' },
    { gate: 'seeded', state: 'not-applicable', summary: 'baseline', source: 'registry' },
    { gate: 'console-used', state: 'unknown', summary: 'baseline', source: 'registry' },
  ];
  const live = readinessFromHealth({ id: 'x', status: 'up', ms: 10 }, AT);
  const merged = mergeReadinessEvidence(baseline, live);
  // no stale baseline entry survives for a probed gate (so the live pass isn't buried by unknown)
  const probedFromRegistry = merged.filter(
    (e) => ['deployed', 'reachable', 'functional'].includes(e.gate) && e.source === 'registry',
  );
  assert.equal(probedFromRegistry.length, 0);
  // seeded + console-used baseline preserved
  assert.ok(merged.find((e) => e.gate === 'seeded' && e.source === 'registry'));
  assert.ok(merged.find((e) => e.gate === 'console-used' && e.source === 'registry'));
  // and the summarized reachable gate is now pass, not unknown
  const reach = merged.filter((e) => e.gate === 'reachable');
  assert.equal(aggregateGate(reach), 'pass');
});

test('consoleUsedEvidence: pass only with a proven workflow, empty (keeps baseline unknown) otherwise', () => {
  const proven = consoleUsedEvidence(true, AT);
  assert.equal(proven.length, 1);
  assert.equal(proven[0].gate, 'console-used');
  assert.equal(proven[0].state, 'pass');
  assert.match(proven[0].source, /capability audit/);
  assert.deepEqual(consoleUsedEvidence(false, AT), []);
});

test('proven service reaches verified: up-probe + console-used pass, no unknown left', () => {
  const baseline: ReadinessEvidence[] = [
    { gate: 'deployed', state: 'unknown', summary: 'b', source: 'registry' },
    { gate: 'reachable', state: 'unknown', summary: 'b', source: 'registry' },
    { gate: 'functional', state: 'unknown', summary: 'b', source: 'registry' },
    { gate: 'seeded', state: 'not-applicable', summary: 'b', source: 'registry' },
    { gate: 'console-used', state: 'unknown', summary: 'b', source: 'registry' },
  ];
  const live = [
    ...readinessFromHealth({ id: 'llm-guard', status: 'up', ms: 67 }, AT),
    ...consoleUsedEvidence(true, AT),
  ];
  const merged = mergeReadinessEvidence(baseline, live);
  const byGate = Object.fromEntries(merged.map((e) => [e.gate, aggregateGate([e])]));
  // deployed/reachable/functional/console-used all pass; seeded not-applicable → readiness 'verified'
  assert.equal(byGate.deployed, 'pass');
  assert.equal(byGate['console-used'], 'pass');
  assert.ok(!merged.some((e) => e.state === 'unknown'));
});

test('mergeReadinessEvidence: empty live leaves baseline untouched', () => {
  const baseline: ReadinessEvidence[] = [
    { gate: 'deployed', state: 'unknown', summary: 'b', source: 'registry' },
  ];
  assert.deepEqual(mergeReadinessEvidence(baseline, []), baseline);
});

test('buildReadinessByService keys by id and skips blank ids', () => {
  const map = buildReadinessByService(
    [
      { id: 'litellm', status: 'up', ms: 145 },
      { id: '', status: 'up' },
      { id: 'qdrant', status: 'down' },
    ],
    AT,
  );
  assert.deepEqual([...map.keys()].sort(), ['litellm', 'qdrant']);
  assert.equal(map.get('litellm')?.find((e) => e.gate === 'deployed')?.state, 'pass');
  assert.equal(map.get('qdrant')?.find((e) => e.gate === 'reachable')?.state, 'fail');
});
