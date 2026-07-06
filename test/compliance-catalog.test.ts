import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCrossMap,
  CATALOG,
  CONTROL_STATUSES,
  crossMapFor,
  findControl,
  frameworkProgress,
  getFramework,
  isControlStatus,
  isKnownControl,
  isKnownFramework,
  statusScore,
  validateStatusTransition,
  type ControlTrackStatus,
} from '../src/lib/compliance-catalog.ts';

// Pure catalog + cross-map + status transitions. No DB, no mocks — the shipped control library and
// the rules that decide coverage. The adoption I/O (self-creating table) is exercised separately.

// ── catalog integrity ────────────────────────────────────────────────────────

test('catalog ships the three real frameworks', () => {
  const ids = CATALOG.map((f) => f.id).sort();
  assert.deepEqual(ids, ['eu-ai-act', 'iso-42001', 'nist-ai-rmf']);
});

test('every framework has controls with real ref + title + plain description', () => {
  for (const f of CATALOG) {
    assert.ok(f.controls.length >= 8, `${f.id} should have a representative control set`);
    for (const c of f.controls) {
      assert.ok(c.id && c.ref && c.title && c.description, `${f.id}/${c.id} fully populated`);
    }
  }
});

test('control ids are globally unique', () => {
  const all = CATALOG.flatMap((f) => f.controls.map((c) => c.id));
  assert.equal(new Set(all).size, all.length);
});

test('every mapsTo target is a real control in ANOTHER framework (no fabricated / self refs)', () => {
  const byId = new Map(CATALOG.flatMap((f) => f.controls.map((c) => [c.id, f.id])));
  for (const f of CATALOG) {
    for (const c of f.controls) {
      for (const target of c.mapsTo) {
        assert.ok(byId.has(target), `${c.id} maps to unknown control ${target}`);
        assert.notEqual(byId.get(target), f.id, `${c.id} maps within its own framework`);
      }
    }
  }
});

// ── lookups ────────────────────────────────────────────────────────────────────

test('getFramework / findControl / isKnown* resolve real ids and reject unknown', () => {
  assert.equal(getFramework('iso-42001')?.name, 'ISO/IEC 42001');
  assert.equal(getFramework('nope' as never), undefined);
  assert.equal(findControl('eu-art-10-data-gov')?.framework, 'eu-ai-act');
  assert.equal(findControl('made-up'), undefined);
  assert.equal(isKnownControl('nist-map-2-1'), true);
  assert.equal(isKnownControl('nist-map-9-9'), false);
  assert.equal(isKnownFramework('eu-ai-act'), true);
  assert.equal(isKnownFramework('ccpa'), false);
});

// ── cross-map (symmetric closure) ────────────────────────────────────────────

test('crossMap is symmetric — a data-governance control links ISO + EU + NIST both ways', () => {
  const forEu = crossMapFor('eu-art-10-data-gov').map((s) => s.id).sort();
  assert.ok(forEu.includes('iso-a7-data-governance'));
  assert.ok(forEu.includes('nist-map-2-1'));
  // reverse direction is present even though ISO declared the edge one-way
  const forIso = crossMapFor('iso-a7-data-governance').map((s) => s.id);
  assert.ok(forIso.includes('eu-art-10-data-gov'));
  assert.ok(forIso.includes('nist-map-2-1'));
});

test('buildCrossMap only lists controls that actually cross-map, and never to themselves', () => {
  const entries = buildCrossMap();
  assert.ok(entries.length > 0);
  for (const e of entries) {
    assert.ok(e.satisfies.length > 0);
    for (const s of e.satisfies) {
      assert.notEqual(s.id, e.control.id);
      assert.notEqual(s.framework, e.control.framework);
    }
  }
});

test('crossMapFor an isolated / unknown control is empty', () => {
  assert.deepEqual(crossMapFor('does-not-exist'), []);
});

// ── status model ────────────────────────────────────────────────────────────

test('status vocabulary is new | in-progress | met', () => {
  assert.deepEqual([...CONTROL_STATUSES], ['new', 'in-progress', 'met']);
  assert.equal(isControlStatus('met'), true);
  assert.equal(isControlStatus('done'), false);
  assert.equal(isControlStatus(3), false);
});

test('validateStatusTransition accepts a known status and rejects anything else', () => {
  const ok = validateStatusTransition('in-progress');
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.status, 'in-progress');
  assert.equal(validateStatusTransition('foo').ok, false);
  assert.equal(validateStatusTransition(undefined).ok, false);
});

test('statusScore: met=1, in-progress=0.5, new/undefined=0', () => {
  assert.equal(statusScore('met'), 1);
  assert.equal(statusScore('in-progress'), 0.5);
  assert.equal(statusScore('new'), 0);
  assert.equal(statusScore(undefined), 0);
});

// ── coverage math ─────────────────────────────────────────────────────────────

test('frameworkProgress computes met/in-progress counts and rounded coverage', () => {
  const iso = getFramework('iso-42001')!;
  const statuses: Record<string, ControlTrackStatus> = {};
  // mark the first two met, the third in-progress; rest untracked
  statuses[iso.controls[0].id] = 'met';
  statuses[iso.controls[1].id] = 'met';
  statuses[iso.controls[2].id] = 'in-progress';
  const p = frameworkProgress(iso, statuses);
  assert.equal(p.total, iso.controls.length);
  assert.equal(p.met, 2);
  assert.equal(p.inProgress, 1);
  const expected = Math.round(((2 + 0.5) / iso.controls.length) * 100);
  assert.equal(p.coverage, expected);
});

test('frameworkProgress with no tracking is 0% coverage', () => {
  const nist = getFramework('nist-ai-rmf')!;
  const p = frameworkProgress(nist, {});
  assert.equal(p.coverage, 0);
  assert.equal(p.met, 0);
});

test('a fully-met framework is 100%', () => {
  const eu = getFramework('eu-ai-act')!;
  const statuses: Record<string, ControlTrackStatus> = {};
  for (const c of eu.controls) statuses[c.id] = 'met';
  assert.equal(frameworkProgress(eu, statuses).coverage, 100);
});
