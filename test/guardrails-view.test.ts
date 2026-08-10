import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildEnforcedProtections,
  buildGuardrailsView,
  PRESIDIO_ENTITY_TYPES,
  FLOOR_ENTITY_TYPES,
  REGEX_ENTITY_TYPES,
} from '../src/lib/guardrails-view.ts';

// Pure guardrails normalizer + demo floor. No network, no mocks — adapter meta / health / sample
// scans in, asserted display model out. Covers Presidio active, the regex fallback, and
// empty/malformed inputs.


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
  // The domestic floor runs on EVERY engine, so its guaranteed types are always reported alongside
  // the engine's own catalog (G-F2). Reporting only the engine's list understated what is masked.
  assert.deepEqual(v.entityTypes, [...PRESIDIO_ENTITY_TYPES, ...FLOOR_ENTITY_TYPES]);
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
  assert.deepEqual(v.entityTypes, [...REGEX_ENTITY_TYPES, ...FLOOR_ENTITY_TYPES]);
});

test('buildGuardrailsView: a scanner-based remote still reports the floor types', () => {
  // The live regression: llm-guard enumerates no fixed entity list, so this reported `[]` — telling
  // an operator the platform recognized no Indian PII while it was masking all four itself.
  const v = buildGuardrailsView({ id: 'llm-guard', embedUrl: 'http://guard:8000' }, true);
  assert.equal(v.engine, 'llm-guard');
  assert.deepEqual(v.entityTypes, [...FLOOR_ENTITY_TYPES]);
  assert.ok(v.entityTypes.includes('IN_PAN'));
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
  // A real adapter PiiResult shape — the route now passes the engine's own verdict here, not a
  // locally-computed one (demoScan is gone; see G-F2 in src/lib/guardrails-view.ts).
  const scan = { hits: true, entities: ['EMAIL_ADDRESS'], redacted: '[EMAIL]', engine: 'regex' };
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

// ── buildEnforcedProtections: the "what's checked" overview summary ────────

test('buildEnforcedProtections: maps each enabled rule to a clean label + verb', () => {
  const out = buildEnforcedProtections([
    { id: 'r1', label: 'Block prompt-injection attempts', action: 'block', enabled: true },
    { id: 'r2', label: 'Mask phone numbers', action: 'mask', enabled: true },
    { id: 'r3', label: 'Redact Aadhaar numbers', action: 'redact', enabled: true },
  ]);
  assert.deepEqual(out, [
    { id: 'r1', label: 'Block prompt-injection attempts', action: 'Blocked' },
    { id: 'r2', label: 'Mask phone numbers', action: 'Masked' },
    { id: 'r3', label: 'Redact Aadhaar numbers', action: 'Removed' },
  ]);
});

test('buildEnforcedProtections: disabled rules are dropped', () => {
  const out = buildEnforcedProtections([
    { id: 'r1', label: 'Mask email addresses', action: 'mask', enabled: false },
  ]);
  assert.deepEqual(out, []);
});

test('buildEnforcedProtections: sanitizes a leaked engine name in a stored label', () => {
  // The live regression this guards: a rule enabled from the standard-guardrails catalog stored
  // "Person names (Presidio — from catalog)" verbatim — the OSS engine name reaching a
  // customer-facing table. The overview summary must never repeat that.
  const out = buildEnforcedProtections([
    { id: 'r1', label: 'Person names (Presidio — from catalog)', action: 'redact', enabled: true },
  ]);
  assert.equal(out.length, 1);
  assert.ok(!/presidio/i.test(out[0].label), `label leaked an engine name: ${out[0].label}`);
  assert.equal(out[0].action, 'Removed');
});

test('buildEnforcedProtections: an unknown action passes through verbatim', () => {
  const out = buildEnforcedProtections([
    { id: 'r1', label: 'Some rule', action: 'quarantine', enabled: true },
  ]);
  assert.equal(out[0].action, 'quarantine');
});

test('buildEnforcedProtections: an empty label falls back rather than rendering blank', () => {
  const out = buildEnforcedProtections([{ id: 'r1', label: '', action: 'mask', enabled: true }]);
  assert.equal(out[0].label, 'Custom protection');
});
