import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildGuardrailsView,
  demoScan,
  PRESIDIO_ENTITY_TYPES,
  REGEX_ENTITY_TYPES,
} from '../src/lib/guardrails-view.ts';

// Pure guardrails normalizer + demo floor. No network, no mocks — adapter meta / health / sample
// scans in, asserted display model out. Covers Presidio active, the regex fallback, and
// empty/malformed inputs.

// ── demoScan (the pure regex floor) ─────────────────────────────────────────

test('demoScan: detects and redacts email + phone', () => {
  const r = demoScan('reach jane@acme.com or +1 202 555 0143 today');
  assert.equal(r.hits, true);
  assert.deepEqual(r.entities, ['EMAIL_ADDRESS', 'PHONE_NUMBER']);
  assert.match(r.redacted, /\[EMAIL\]/);
  assert.match(r.redacted, /\[PHONE\]/);
  assert.equal(r.engine, 'regex');
});

test('demoScan: clean text → no hits', () => {
  const r = demoScan('nothing sensitive here');
  assert.equal(r.hits, false);
  assert.deepEqual(r.entities, []);
  assert.equal(r.redacted, 'nothing sensitive here');
});

test('demoScan: is reusable across calls (global regex lastIndex safety)', () => {
  // A second scan of a matching string must still detect — regressions here mean lastIndex leaked.
  demoScan('a@b.com');
  const r = demoScan('c@d.com');
  assert.equal(r.hits, true);
  assert.deepEqual(r.entities, ['EMAIL_ADDRESS']);
});

test('demoScan: non-string input degrades to empty scan, never throws', () => {
  const r = demoScan(undefined as unknown as string);
  assert.equal(r.hits, false);
  assert.deepEqual(r.entities, []);
  assert.equal(r.redacted, '');
});

// ── buildGuardrailsView: Presidio active ────────────────────────────────────

test('buildGuardrailsView: presidio configured + reachable', () => {
  const v = buildGuardrailsView(
    {
      id: 'presidio',
      vendor: 'Microsoft Presidio',
      license: 'MIT',
      description: 'Production-grade PII detection.',
      embedUrl: 'http://presidio:3000',
    },
    true,
  );
  assert.equal(v.engine, 'presidio');
  assert.equal(v.adapterId, 'presidio');
  assert.equal(v.reachable, true);
  assert.equal(v.configured, true);
  assert.deepEqual(v.entityTypes, [...PRESIDIO_ENTITY_TYPES]);
  assert.equal(v.demo, undefined);
});

test('buildGuardrailsView: presidio active but unreachable stays unreachable', () => {
  const v = buildGuardrailsView({ id: 'presidio', embedUrl: 'http://presidio:3000' }, false);
  assert.equal(v.engine, 'presidio');
  assert.equal(v.reachable, false);
  assert.equal(v.configured, true);
});

test('buildGuardrailsView: presidio selected without embedUrl → not configured', () => {
  const v = buildGuardrailsView({ id: 'presidio' }, false);
  assert.equal(v.engine, 'presidio');
  assert.equal(v.configured, false);
});

// ── buildGuardrailsView: regex fallback / first-party ───────────────────────

test('buildGuardrailsView: checks spine → regex engine, always reachable + configured', () => {
  const v = buildGuardrailsView(
    { id: 'checks', vendor: 'Off Grid AI checks spine', license: 'first-party' },
    // health passed as false must NOT make the always-on floor unreachable
    false,
  );
  assert.equal(v.engine, 'regex');
  assert.equal(v.adapterId, 'checks');
  assert.equal(v.reachable, true);
  assert.equal(v.configured, true);
  assert.deepEqual(v.entityTypes, [...REGEX_ENTITY_TYPES]);
});

test('buildGuardrailsView: unknown adapter id normalizes to regex', () => {
  const v = buildGuardrailsView({ id: 'something-else' }, true);
  assert.equal(v.engine, 'regex');
  assert.equal(v.adapterId, 'something-else');
  assert.equal(v.reachable, true);
});

// ── buildGuardrailsView: empty / malformed ──────────────────────────────────

test('buildGuardrailsView: null meta → safe regex defaults, never throws', () => {
  const v = buildGuardrailsView(null, true);
  assert.equal(v.engine, 'regex');
  assert.equal(v.adapterId, 'checks');
  assert.equal(v.vendor, 'Off Grid AI checks spine');
  assert.equal(v.license, 'first-party');
  assert.equal(v.reachable, true);
  assert.equal(v.configured, true);
});

test('buildGuardrailsView: malformed meta fields fall back to defaults', () => {
  const v = buildGuardrailsView(
    { id: 42 as unknown as string, vendor: '', license: null as unknown as string },
    true,
  );
  assert.equal(v.engine, 'regex');
  assert.equal(v.adapterId, 'checks');
  assert.equal(v.vendor, 'Off Grid AI checks spine');
  assert.equal(v.license, 'first-party');
});

// ── buildGuardrailsView: demo threading ─────────────────────────────────────

test('buildGuardrailsView: threads a demo scan result through', () => {
  const scan = demoScan('jane@acme.com');
  const v = buildGuardrailsView({ id: 'checks' }, true, scan, 'jane@acme.com');
  assert.ok(v.demo);
  assert.equal(v.demo?.input, 'jane@acme.com');
  assert.equal(v.demo?.hits, true);
  assert.deepEqual(v.demo?.entities, ['EMAIL_ADDRESS']);
  assert.equal(v.demo?.engine, 'regex');
});

test('buildGuardrailsView: malformed demo (bad entities) degrades safely', () => {
  const v = buildGuardrailsView(
    { id: 'checks' },
    true,
    { hits: true, entities: 'nope' as unknown as string[] },
    'x',
  );
  assert.ok(v.demo);
  assert.deepEqual(v.demo?.entities, []);
  // hits stays true because the raw flag was true even though entities were unusable
  assert.equal(v.demo?.hits, true);
});

test('buildGuardrailsView: null demo → no demo block', () => {
  const v = buildGuardrailsView({ id: 'checks' }, true, null, '');
  assert.equal(v.demo, undefined);
});
