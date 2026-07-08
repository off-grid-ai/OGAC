// CONDITION-COVERAGE tests for pipeline-governance.ts — the remaining uncovered branches are in
// tightenOverlay (the bool "expects on/off" error arm + the level type/loosen guards) plus
// controlMeta's fallback, coerceControl's junk arms (via normalizeOverlay), sourceOf's three arms,
// valueLabelFor's kind/undefined arms, and the guardrail-entity mapping's every case. Additive.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ORG_GUARDRAIL_DEFAULTS,
  ORG_POLICY_DEFAULTS,
  clearOverlayControl,
  controlMeta,
  describeEffective,
  enableGuardrailOnPipeline,
  guardrailEntityToControl,
  normalizeOverlay,
  pipelinesEnforcingGuardrail,
  sourceOf,
  tightenOverlay,
} from '@/lib/pipeline-governance';
import type { GovernanceControls } from '@/lib/pipelines-policy';

// ─── controlMeta — known + unknown (fallback) arms ─────────────────────────────────────────────────

test('controlMeta: known key returns its rich meta; unknown returns a safe generic fallback', () => {
  assert.equal(controlMeta('maxEgress').label, 'Data egress ceiling');
  const fb = controlMeta('mysteryControl');
  assert.deepEqual(fb, { key: 'mysteryControl', label: 'mysteryControl', description: '', kind: 'bool' });
});

// ─── sourceOf — pipeline-override, org-locked, org-default (all three arms) ────────────────────────

test('sourceOf: overridden → pipeline-override', () => {
  assert.equal(
    sourceOf({ key: 'k', mode: 'default', fromLocked: false, loosenRejected: false, overridden: true }),
    'pipeline-override',
  );
});

test('sourceOf: not overridden + fromLocked → org-locked', () => {
  assert.equal(
    sourceOf({ key: 'k', mode: 'locked', fromLocked: true, loosenRejected: false, overridden: false }),
    'org-locked',
  );
});

test('sourceOf: not overridden + not locked → org-default', () => {
  assert.equal(
    sourceOf({ key: 'k', mode: 'default', fromLocked: false, loosenRejected: false, overridden: false }),
    'org-default',
  );
});

// ─── describeEffective — level valueLabel, bool on/off labels, override "org:" surfacing ──────────

test('describeEffective: renders org baselines with source badges + value labels', () => {
  const view = describeEffective(ORG_POLICY_DEFAULTS, {});
  const egress = view.controls.find((c) => c.key === 'maxEgress')!;
  assert.equal(egress.valueLabel, 'local'); // kind level → the level string
  assert.equal(egress.source, 'org-locked');
  assert.equal(egress.locked, true);
  const purpose = view.controls.find((c) => c.key === 'requirePurpose')!;
  assert.equal(purpose.valueLabel, 'Purpose required'); // bool true → onLabel
  const exp = view.controls.find((c) => c.key === 'allowExport')!;
  assert.equal(exp.valueLabel, 'Export blocked'); // bool false → offLabel
});

test('describeEffective: a legitimate tighten shows pipeline-override + the org value label', () => {
  const overlay: GovernanceControls = { maxEgress: { mode: 'default', level: 'block' } };
  const view = describeEffective(ORG_POLICY_DEFAULTS, overlay);
  const egress = view.controls.find((c) => c.key === 'maxEgress')!;
  assert.equal(egress.valueLabel, 'block'); // tightened
  assert.equal(egress.orgValueLabel, 'local'); // org baseline surfaced
  assert.equal(egress.source, 'pipeline-override');
  assert.equal(egress.overridden, true);
});

test('describeEffective: a rejected loosen surfaces loosenRejected + the rejected list', () => {
  const overlay: GovernanceControls = { maxEgress: { mode: 'default', level: 'cloud' } }; // loosen
  const view = describeEffective(ORG_POLICY_DEFAULTS, overlay);
  const egress = view.controls.find((c) => c.key === 'maxEgress')!;
  assert.equal(egress.loosenRejected, true);
  assert.equal(egress.valueLabel, 'local'); // stayed at the locked ceiling
  assert.ok(view.rejected.includes('maxEgress'));
});

test('describeEffective: a bool-kind control with NO bool value renders "—" (valueLabelFor undefined arm)', () => {
  // An unknown org key → controlMeta fallback kind 'bool'; give it only a level so eff.bool stays
  // undefined → valueLabelFor hits the `ctrl.bool === undefined` arm → "—".
  const custom: GovernanceControls = { customThing: { mode: 'default', level: 'local' } };
  const view = describeEffective(custom, {});
  const c = view.controls.find((x) => x.key === 'customThing')!;
  assert.equal(c.kind, 'bool'); // fallback meta
  assert.equal(c.valueLabel, '—'); // bool undefined
  assert.equal(c.orgValueLabel, '—');
});

test('describeEffective: a level control with NO level renders "—" (level-kind undefined arm)', () => {
  // maxEgress is kind 'level'; strip its level so valueLabelFor returns the level `?? "—"`.
  const custom: GovernanceControls = { maxEgress: { mode: 'default' } };
  const view = describeEffective(custom, {});
  const c = view.controls.find((x) => x.key === 'maxEgress')!;
  assert.equal(c.valueLabel, '—');
});

// ─── normalizeOverlay + coerceControl — every junk arm ─────────────────────────────────────────────

test('normalizeOverlay: keeps only known keys with a bool or level; drops junk', () => {
  const raw = {
    requirePiiMasking: { mode: 'default', bool: true }, // known + valid
    unknownControl: { mode: 'default', bool: true }, // not in `known` → dropped
    requireGrounding: { mode: 'locked', level: 'bogus' }, // invalid level + no bool → dropped
    filterToxicity: 'not-an-object', // coerceControl null (typeof !== object)
    blockPromptInjection: null, // coerceControl null (falsy)
    requireGroundingEmpty: {}, // no bool + no level → dropped
  };
  const out = normalizeOverlay(raw, ORG_GUARDRAIL_DEFAULTS);
  assert.deepEqual(Object.keys(out), ['requirePiiMasking']);
  assert.equal(out.requirePiiMasking.mode, 'default');
  assert.equal(out.requirePiiMasking.bool, true);
});

test('normalizeOverlay: non-object raw → empty (early guard arm)', () => {
  assert.deepEqual(normalizeOverlay(null, ORG_GUARDRAIL_DEFAULTS), {});
  assert.deepEqual(normalizeOverlay('str', ORG_GUARDRAIL_DEFAULTS), {});
});

test('normalizeOverlay: a locked-mode overlay entry is coerced (mode === locked arm)', () => {
  const out = normalizeOverlay({ requirePiiMasking: { mode: 'locked', bool: true } }, ORG_GUARDRAIL_DEFAULTS);
  assert.equal(out.requirePiiMasking.mode, 'locked');
});

test('normalizeOverlay: a level-only control is kept (isPermissionLevel arm)', () => {
  const out = normalizeOverlay({ maxEgress: { mode: 'default', level: 'block' } }, ORG_POLICY_DEFAULTS);
  assert.equal(out.maxEgress.level, 'block');
});

// ─── tightenOverlay — every guard arm ──────────────────────────────────────────────────────────────

test('tightenOverlay: unknown key → refused', () => {
  const r = tightenOverlay(ORG_POLICY_DEFAULTS, {}, 'ghost', { bool: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /Unknown control/);
});

test('tightenOverlay: a bool control given a NON-boolean value → "expects an on/off value" (line 320)', () => {
  const r = tightenOverlay(ORG_POLICY_DEFAULTS, {}, 'requirePurpose', { level: 'local' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /expects an on\/off value/);
});

test('tightenOverlay: turning a locked-ON bool OFF is refused', () => {
  const r = tightenOverlay(ORG_POLICY_DEFAULTS, {}, 'requirePurpose', { bool: false });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /locked on/);
});

test('tightenOverlay: a default bool control accepts either value', () => {
  const on = tightenOverlay(ORG_POLICY_DEFAULTS, {}, 'requireHumanReview', { bool: true });
  assert.equal(on.ok, true);
  if (on.ok) assert.equal(on.overlay.requireHumanReview.bool, true);
  const off = tightenOverlay(ORG_POLICY_DEFAULTS, {}, 'allowExport', { bool: false });
  assert.equal(off.ok, true);
});

test('tightenOverlay: a level control given a non-level value → "expects one of" error', () => {
  const r = tightenOverlay(ORG_POLICY_DEFAULTS, {}, 'maxEgress', { bool: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /expects one of/);
});

test('tightenOverlay: a locked level loosen (cloud > local) is refused with the tighten hint', () => {
  const r = tightenOverlay(ORG_POLICY_DEFAULTS, {}, 'maxEgress', { level: 'cloud' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /locked at "local".*only tighten/s);
});

test('tightenOverlay: a locked level tighten (block <= local) is accepted', () => {
  const r = tightenOverlay(ORG_POLICY_DEFAULTS, { existing: { mode: 'default', bool: true } }, 'maxEgress', {
    level: 'block',
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.overlay.maxEgress.level, 'block');
    assert.equal(r.overlay.existing.bool, true); // prior overlay entries preserved
  }
});

// ─── clearOverlayControl ───────────────────────────────────────────────────────────────────────────

test('clearOverlayControl removes just the named key, leaving the rest', () => {
  const before: GovernanceControls = {
    maxEgress: { mode: 'default', level: 'block' },
    allowExport: { mode: 'default', bool: false },
  };
  const after = clearOverlayControl(before, 'maxEgress');
  assert.deepEqual(Object.keys(after), ['allowExport']);
  assert.ok('maxEgress' in before); // original untouched (pure)
});

// ─── guardrailEntityToControl — every case + the PII default ──────────────────────────────────────

test('guardrailEntityToControl: each catalog entity maps to its control', () => {
  assert.deepEqual(guardrailEntityToControl('PROMPT_INJECTION'), { key: 'blockPromptInjection', value: { bool: true } });
  assert.equal(guardrailEntityToControl('TOXIC_LANGUAGE').key, 'filterToxicity');
  assert.equal(guardrailEntityToControl('PROFANITY').key, 'filterToxicity');
  assert.equal(guardrailEntityToControl('GROUNDED').key, 'requireGrounding');
  assert.equal(guardrailEntityToControl('GROUNDEDNESS').key, 'requireGrounding');
  assert.equal(guardrailEntityToControl('PROVENANCE').key, 'requireGrounding');
  // Any PII entity → the default arm → mask PII.
  assert.equal(guardrailEntityToControl('EMAIL_ADDRESS').key, 'requirePiiMasking');
});

// ─── enableGuardrailOnPipeline — composes normalize + map + tighten ────────────────────────────────

test('enableGuardrailOnPipeline: turning grounding on for a pipeline succeeds', () => {
  const r = enableGuardrailOnPipeline({}, 'GROUNDED');
  assert.equal(r.key, 'requireGrounding');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.overlay.requireGrounding.bool, true);
});

test('enableGuardrailOnPipeline: an existing (junk-containing) raw overlay is normalized first', () => {
  const r = enableGuardrailOnPipeline({ garbage: 1, requirePiiMasking: { bool: true } }, 'PROMPT_INJECTION');
  assert.equal(r.key, 'blockPromptInjection');
  assert.equal(r.ok, true);
});

// ─── pipelinesEnforcingGuardrail — the effective-on filter (both arms) ─────────────────────────────

test('pipelinesEnforcingGuardrail: returns only pipelines whose effective control is ON', () => {
  // requirePiiMasking is org-LOCKED ON, so ALL pipelines enforce it regardless of overlay.
  const masking = pipelinesEnforcingGuardrail('EMAIL_ADDRESS', [
    { id: 'p1', name: 'One', guardrailOverlay: {} },
    { id: 'p2', name: 'Two', guardrailOverlay: { requirePiiMasking: { bool: true } } },
  ]);
  assert.deepEqual(masking.map((p) => p.id).sort(), ['p1', 'p2']);

  // requireGrounding is org-default OFF → only the pipeline that tightened it on is returned.
  const grounding = pipelinesEnforcingGuardrail('GROUNDED', [
    { id: 'p1', name: 'One', guardrailOverlay: {} }, // off → excluded
    { id: 'p2', name: 'Two', guardrailOverlay: { requireGrounding: { mode: 'default', bool: true } } },
  ]);
  assert.deepEqual(grounding.map((p) => p.id), ['p2']);
});
