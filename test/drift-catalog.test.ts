import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DRIFT_APPLIES_TO,
  DRIFT_CATALOG,
  DRIFT_KINDS,
  autoSelectMethodId,
  buildDriftRunConfig,
  catalogByKind,
  clampDriftShareThreshold,
  driftItemAvailability,
  filterDriftCatalog,
  getDriftItem,
  isDriftFilterActive,
  verdictFromShare,
} from '../src/lib/drift-catalog.ts';

// PURE unit tests for the standard DRIFT catalog + availability + method-selection +
// threshold/verdict + run-config builder (Builder Epic #126). No I/O. Grounded in real Evidently
// stat tests + presets.

// ─── Catalog integrity ──────────────────────────────────────────────────────────────────────────
test('catalog is a non-trivial curated set', () => {
  assert.ok(DRIFT_CATALOG.length >= 10, `expected >=10, got ${DRIFT_CATALOG.length}`);
});

test('every item carries full required metadata', () => {
  for (const i of DRIFT_CATALOG) {
    assert.ok(i.id, 'id');
    assert.ok(i.name, `name for ${i.id}`);
    assert.ok(DRIFT_KINDS.includes(i.kind), `kind for ${i.id}`);
    assert.ok(DRIFT_APPLIES_TO.includes(i.appliesTo), `appliesTo for ${i.id}`);
    assert.equal(i.engine, 'evidently', `engine for ${i.id}`);
    assert.ok(i.evidentlyName, `evidentlyName for ${i.id}`);
    assert.ok(i.description.length > 10, `description for ${i.id}`);
    assert.equal(typeof i.recommended, 'boolean', `recommended for ${i.id}`);
  }
});

test('ids are unique', () => {
  const ids = DRIFT_CATALOG.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate id');
});

test('contains the real Evidently methods we ground on', () => {
  const names = new Set(DRIFT_CATALOG.map((i) => i.evidentlyName.toLowerCase()));
  for (const m of ['psi', 'ks', 'wasserstein', 'chisquare', 'z', 'tvd', 'jensenshannon', 'kl_div']) {
    assert.ok(names.has(m.toLowerCase()), `expected method ${m}`);
  }
});

test('contains the real Evidently presets', () => {
  const presets = DRIFT_CATALOG.filter((i) => i.kind === 'preset').map((i) => i.evidentlyName);
  for (const p of ['DataDriftPreset', 'DataSummaryPreset', 'DataQualityPreset']) {
    assert.ok(presets.includes(p), `expected preset ${p}`);
  }
});

// ─── Lookup + grouping ──────────────────────────────────────────────────────────────────────────
test('getDriftItem finds by id, null otherwise', () => {
  assert.equal(getDriftItem('psi')?.evidentlyName, 'psi');
  assert.equal(getDriftItem('nope'), null);
});

test('catalogByKind groups presets first, drops empties', () => {
  const groups = catalogByKind();
  assert.equal(groups[0].kind, 'preset');
  assert.equal(groups[1].kind, 'method');
  for (const g of groups) assert.ok(g.items.length > 0);
});

// ─── Filtering ──────────────────────────────────────────────────────────────────────────────────
test('isDriftFilterActive reflects any set field', () => {
  assert.equal(isDriftFilterActive({}), false);
  assert.equal(isDriftFilterActive({ q: '  ' }), false);
  assert.equal(isDriftFilterActive({ q: 'psi' }), true);
  assert.equal(isDriftFilterActive({ kind: 'method' }), true);
  assert.equal(isDriftFilterActive({ appliesTo: 'numerical' }), true);
});

test('filterDriftCatalog: query matches name/description/evidentlyName', () => {
  assert.ok(filterDriftCatalog(DRIFT_CATALOG, { q: 'chi-square' }).some((i) => i.id === 'chisquare'));
  assert.ok(filterDriftCatalog(DRIFT_CATALOG, { q: 'wasserstein' }).some((i) => i.id === 'wasserstein'));
});

test('filterDriftCatalog: kind filter', () => {
  const presets = filterDriftCatalog(DRIFT_CATALOG, { kind: 'preset' });
  assert.ok(presets.length >= 3);
  assert.ok(presets.every((i) => i.kind === 'preset'));
});

test('filterDriftCatalog: appliesTo — numerical includes numerical + any', () => {
  const num = filterDriftCatalog(DRIFT_CATALOG, { appliesTo: 'numerical' });
  assert.ok(num.some((i) => i.id === 'ks')); // numerical
  assert.ok(num.some((i) => i.id === 'psi')); // any → matches every column type
  assert.ok(!num.some((i) => i.id === 'chisquare')); // categorical-only excluded
});

test('filterDriftCatalog: pure — does not mutate input', () => {
  const before = [...DRIFT_CATALOG];
  filterDriftCatalog(DRIFT_CATALOG, { q: 'psi', kind: 'method' });
  assert.deepEqual(DRIFT_CATALOG, before);
});

// ─── Availability (honest degradation) ────────────────────────────────────────────────────────────
test('driftItemAvailability: ready only when Evidently selected AND configured', () => {
  const ks = getDriftItem('ks')!;
  assert.equal(
    driftItemAvailability(ks, { evidentlySelected: true, evidentlyConfigured: true }).status,
    'ready',
  );
  assert.equal(
    driftItemAvailability(ks, { evidentlySelected: true, evidentlyConfigured: false }).status,
    'fallback',
  );
  assert.equal(
    driftItemAvailability(ks, { evidentlySelected: false, evidentlyConfigured: true }).status,
    'fallback',
  );
});

test('driftItemAvailability: PSI fallback detail calls out the built-in heuristic', () => {
  const psi = getDriftItem('psi')!;
  const a = driftItemAvailability(psi, { evidentlySelected: false, evidentlyConfigured: false });
  assert.equal(a.status, 'fallback');
  assert.match(a.detail, /PSI heuristic/i);
});

// ─── Method auto-selection (Evidently defaults) ─────────────────────────────────────────────────────
test('autoSelectMethodId mirrors Evidently defaults by type + sample size', () => {
  assert.equal(autoSelectMethodId('numerical', 500), 'ks'); // small numerical → KS
  assert.equal(autoSelectMethodId('numerical', 5000), 'wasserstein'); // large numerical → Wasserstein
  assert.equal(autoSelectMethodId('categorical', 500), 'chisquare'); // small categorical → chi-square
  assert.equal(autoSelectMethodId('categorical', 500, { binary: true }), 'z'); // binary → Z
  assert.equal(autoSelectMethodId('categorical', 5000), 'jensenshannon'); // large categorical → JS
});

// ─── Threshold + verdict ────────────────────────────────────────────────────────────────────────
test('clampDriftShareThreshold clamps to [0,1] and defaults on garbage', () => {
  assert.equal(clampDriftShareThreshold(0.5), 0.5);
  assert.equal(clampDriftShareThreshold(-1), 0);
  assert.equal(clampDriftShareThreshold(9), 1);
  assert.equal(clampDriftShareThreshold('0.3'), 0.3);
  assert.equal(clampDriftShareThreshold('nope'), 0.5); // default
});

test('verdictFromShare bands share against threshold', () => {
  assert.equal(verdictFromShare(0.6, 0.5), 'drift'); // at/over threshold
  assert.equal(verdictFromShare(0.3, 0.5), 'warning'); // at/over half
  assert.equal(verdictFromShare(0.1, 0.5), 'stable'); // under half
  assert.equal(verdictFromShare(0.5, 0.5), 'drift'); // exactly at
});

test('verdictFromShare: threshold 0 means any drift is drift', () => {
  assert.equal(verdictFromShare(0.01, 0), 'drift');
  assert.equal(verdictFromShare(0, 0), 'stable');
});

// ─── Run-config builder — the seam to the drift run ─────────────────────────────────────────────────
test('buildDriftRunConfig: preset selection sets preset, method null', () => {
  const c = buildDriftRunConfig({ itemId: 'data-drift-preset', driftShareThreshold: 0.4 });
  assert.equal(c.preset, 'DataDriftPreset');
  assert.equal(c.method, null);
  assert.equal(c.driftShareThreshold, 0.4);
  assert.deepEqual(c.columnMethods, {});
});

test('buildDriftRunConfig: method selection sets method, preset null', () => {
  const c = buildDriftRunConfig({ itemId: 'ks' });
  assert.equal(c.preset, null);
  assert.equal(c.method, 'ks');
  assert.equal(c.driftShareThreshold, 0.5); // default
});

test('buildDriftRunConfig: per-column overrides resolve to evidentlyName tokens', () => {
  const c = buildDriftRunConfig({
    itemId: 'data-drift-preset',
    columnOverrides: [
      { column: 'latency', methodId: 'wasserstein' },
      { column: 'topic', methodId: 'chisquare' },
      { column: 'bad', methodId: 'not-a-method' }, // dropped
      { column: '', methodId: 'ks' }, // dropped (no column)
      { column: 'x', methodId: 'data-drift-preset' }, // dropped (not a method)
    ],
  });
  assert.deepEqual(c.columnMethods, { latency: 'wasserstein', topic: 'chisquare' });
});

test('buildDriftRunConfig: unknown item id → no preset/method, still valid', () => {
  const c = buildDriftRunConfig({ itemId: 'nope' });
  assert.equal(c.preset, null);
  assert.equal(c.method, null);
  assert.equal(c.driftShareThreshold, 0.5);
});

test('buildDriftRunConfig: threshold clamped', () => {
  assert.equal(buildDriftRunConfig({ itemId: 'psi', driftShareThreshold: 5 }).driftShareThreshold, 1);
});
