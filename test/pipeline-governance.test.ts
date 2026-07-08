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
} from '../src/lib/pipeline-governance.ts';
import type { GovernanceControls } from '../src/lib/pipelines-policy.ts';

// Unit tests for the PURE pipeline-governance display + shaping layer. No I/O. These cover the
// effective-governance display shaping and the locked→tighten-only / loosen-rejected edit path that
// the Policy + Guardrails tabs rely on (mirrors the guarantees in pipelines-policy but tests OUR
// shaping — the source badge, the pre-validated edit, the library mapping).

// ── describeEffective: inheritance + source badges ───────────────────────────────────────────────

test('describeEffective with an empty overlay: every control inherits the org value + source', () => {
  const view = describeEffective(ORG_POLICY_DEFAULTS, {});
  assert.equal(view.rejected.length, 0, 'no loosen attempts');
  const byKey = Object.fromEntries(view.controls.map((c) => [c.key, c]));

  // A locked control with no override → org-locked, not overridden.
  assert.equal(byKey.maxEgress.source, 'org-locked');
  assert.equal(byKey.maxEgress.locked, true);
  assert.equal(byKey.maxEgress.overridden, false);
  assert.equal(byKey.maxEgress.valueLabel, 'local');

  // A default control with no override → org-default.
  assert.equal(byKey.allowExport.source, 'org-default');
  assert.equal(byKey.allowExport.locked, false);
  assert.equal(byKey.allowExport.valueLabel, 'Export blocked');
});

test('describeEffective preserves the org declared order', () => {
  const view = describeEffective(ORG_POLICY_DEFAULTS, {});
  assert.deepEqual(
    view.controls.map((c) => c.key),
    Object.keys(ORG_POLICY_DEFAULTS),
  );
});

test('describeEffective: a legitimate override is flagged pipeline-override with the org value kept', () => {
  // Enable a `default` control (requireHumanReview) at the pipeline.
  const overlay: GovernanceControls = { requireHumanReview: { mode: 'default', bool: true } };
  const view = describeEffective(ORG_POLICY_DEFAULTS, overlay);
  const c = view.controls.find((x) => x.key === 'requireHumanReview')!;
  assert.equal(c.source, 'pipeline-override');
  assert.equal(c.overridden, true);
  assert.equal(c.bool, true);
  assert.equal(c.valueLabel, 'Review required');
  assert.equal(c.orgValueLabel, 'No review', 'org value preserved for the "revert to" label');
});

test('describeEffective: tightening a locked level control is honoured', () => {
  // maxEgress locked at 'local'; tighten to 'block' (less permissive) → honoured.
  const overlay: GovernanceControls = { maxEgress: { mode: 'default', level: 'block' } };
  const view = describeEffective(ORG_POLICY_DEFAULTS, overlay);
  const c = view.controls.find((x) => x.key === 'maxEgress')!;
  assert.equal(c.overridden, true);
  assert.equal(c.level, 'block');
  assert.equal(c.valueLabel, 'block');
  assert.equal(view.rejected.length, 0);
});

test('describeEffective: loosening a locked level control is REJECTED + surfaced', () => {
  // maxEgress locked at 'local'; try to loosen to 'cloud' (more permissive) → rejected, org stands.
  const overlay: GovernanceControls = { maxEgress: { mode: 'default', level: 'cloud' } };
  const view = describeEffective(ORG_POLICY_DEFAULTS, overlay);
  const c = view.controls.find((x) => x.key === 'maxEgress')!;
  assert.equal(c.loosenRejected, true);
  assert.equal(c.level, 'local', 'org locked value stands');
  assert.deepEqual(view.rejected, ['maxEgress']);
});

test('describeEffective: turning a locked-on bool OFF is rejected', () => {
  // requirePiiMasking is locked ON; overlay tries to turn it off → rejected, stays on.
  const overlay: GovernanceControls = { requirePiiMasking: { mode: 'default', bool: false } };
  const view = describeEffective(ORG_GUARDRAIL_DEFAULTS, overlay);
  const c = view.controls.find((x) => x.key === 'requirePiiMasking')!;
  assert.equal(c.loosenRejected, true);
  assert.equal(c.bool, true, 'stays on');
  assert.deepEqual(view.rejected, ['requirePiiMasking']);
});

// ── sourceOf ─────────────────────────────────────────────────────────────────────────────────────

test('sourceOf maps merged flags to the badge', () => {
  assert.equal(sourceOf({ key: 'k', mode: 'locked', fromLocked: true, loosenRejected: false, overridden: false }), 'org-locked');
  assert.equal(sourceOf({ key: 'k', mode: 'default', fromLocked: false, loosenRejected: false, overridden: false }), 'org-default');
  assert.equal(sourceOf({ key: 'k', mode: 'default', fromLocked: false, loosenRejected: false, overridden: true }), 'pipeline-override');
});

// ── normalizeOverlay ───────────────────────────────────────────────────────────────────────────────

test('normalizeOverlay drops junk + unknown keys, keeps valid known controls', () => {
  const raw = {
    requireHumanReview: { mode: 'default', bool: true }, // valid known
    maxEgress: { mode: 'default', level: 'block' }, // valid known
    bogusControl: { mode: 'default', bool: true }, // unknown key → dropped
    emptyControl: { mode: 'default' }, // no value → dropped
    garbage: 42, // not an object → dropped
  };
  const out = normalizeOverlay(raw, ORG_POLICY_DEFAULTS);
  assert.deepEqual(Object.keys(out).sort(), ['maxEgress', 'requireHumanReview']);
  assert.equal(out.requireHumanReview.bool, true);
  assert.equal(out.maxEgress.level, 'block');
});

test('normalizeOverlay on non-object input → empty', () => {
  assert.deepEqual(normalizeOverlay(null, ORG_POLICY_DEFAULTS), {});
  assert.deepEqual(normalizeOverlay('nope', ORG_POLICY_DEFAULTS), {});
  assert.deepEqual(normalizeOverlay(undefined, ORG_POLICY_DEFAULTS), {});
});

// ── tightenOverlay: the pre-validated edit path ────────────────────────────────────────────────────

test('tightenOverlay refuses an unknown control key', () => {
  const r = tightenOverlay(ORG_POLICY_DEFAULTS, {}, 'nope', { bool: true });
  assert.equal(r.ok, false);
});

test('tightenOverlay: a default control accepts any value', () => {
  const r = tightenOverlay(ORG_POLICY_DEFAULTS, {}, 'requireHumanReview', { bool: true });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.overlay.requireHumanReview.bool, true);
});

test('tightenOverlay: locked-on bool cannot be turned off (refused before persist)', () => {
  const r = tightenOverlay(ORG_GUARDRAIL_DEFAULTS, {}, 'requirePiiMasking', { bool: false });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /locked on/i);
});

test('tightenOverlay: locked-off bool CAN be turned on (a tighten)', () => {
  // blockPromptInjection is locked ON already; requireGrounding is default-off. Use a locked-off
  // scenario via a synthetic org control to prove the direction is honoured.
  const org: GovernanceControls = { x: { mode: 'locked', bool: false } };
  // controlMeta('x') falls back to a bool kind, so the edit path treats it as a toggle.
  assert.equal(controlMeta('x').kind, 'bool');
  const r = tightenOverlay(org, {}, 'x', { bool: true });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.overlay.x.bool, true);
});

test('tightenOverlay: locked level accepts a tighten, refuses a loosen', () => {
  const tighten = tightenOverlay(ORG_POLICY_DEFAULTS, {}, 'maxEgress', { level: 'block' });
  assert.equal(tighten.ok, true);
  if (tighten.ok) assert.equal(tighten.overlay.maxEgress.level, 'block');

  const loosen = tightenOverlay(ORG_POLICY_DEFAULTS, {}, 'maxEgress', { level: 'cloud' });
  assert.equal(loosen.ok, false);
  if (!loosen.ok) assert.match(loosen.reason, /tighten/i);
});

test('tightenOverlay: a level control given a bool value is refused', () => {
  const r = tightenOverlay(ORG_POLICY_DEFAULTS, {}, 'maxEgress', { bool: true });
  assert.equal(r.ok, false);
});

test('tightenOverlay preserves other overlay controls (merge, not replace)', () => {
  const overlay: GovernanceControls = { requireHumanReview: { mode: 'default', bool: true } };
  const r = tightenOverlay(ORG_POLICY_DEFAULTS, overlay, 'maxEgress', { level: 'mask' });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.overlay.requireHumanReview.bool, true, 'existing control kept');
    assert.equal(r.overlay.maxEgress.level, 'mask', 'new control added');
  }
});

// The edit path and the display path must AGREE: a value tightenOverlay accepts must NOT show up as
// loosenRejected when re-merged, and one it refuses must NOT change the effective value.
test('tightenOverlay and describeEffective agree (round-trip)', () => {
  const accept = tightenOverlay(ORG_POLICY_DEFAULTS, {}, 'maxEgress', { level: 'block' });
  assert.equal(accept.ok, true);
  if (accept.ok) {
    const view = describeEffective(ORG_POLICY_DEFAULTS, accept.overlay);
    const c = view.controls.find((x) => x.key === 'maxEgress')!;
    assert.equal(c.loosenRejected, false);
    assert.equal(c.level, 'block');
  }
});

// ── clearOverlayControl ────────────────────────────────────────────────────────────────────────────

test('clearOverlayControl removes only the named control (revert to inherit)', () => {
  const overlay: GovernanceControls = {
    maxEgress: { mode: 'default', level: 'block' },
    requireHumanReview: { mode: 'default', bool: true },
  };
  const out = clearOverlayControl(overlay, 'maxEgress');
  assert.deepEqual(Object.keys(out), ['requireHumanReview']);
  // Original not mutated.
  assert.ok('maxEgress' in overlay);
});

// ── guardrailEntityToControl: attach-from-library mapping ────────────────────────────────────────

test('guardrailEntityToControl maps catalog entities to the right pipeline control', () => {
  assert.deepEqual(guardrailEntityToControl('PROMPT_INJECTION'), {
    key: 'blockPromptInjection',
    value: { bool: true },
  });
  assert.deepEqual(guardrailEntityToControl('TOXIC_LANGUAGE'), {
    key: 'filterToxicity',
    value: { bool: true },
  });
  assert.deepEqual(guardrailEntityToControl('GROUNDED'), {
    key: 'requireGrounding',
    value: { bool: true },
  });
  // Any Presidio PII entity → mask PII.
  assert.deepEqual(guardrailEntityToControl('EMAIL_ADDRESS'), {
    key: 'requirePiiMasking',
    value: { bool: true },
  });
  assert.deepEqual(guardrailEntityToControl('IN_PAN'), {
    key: 'requirePiiMasking',
    value: { bool: true },
  });
});

// ── enableGuardrailOnPipeline: the guardrails-catalog "scope → pipeline" write (task #173, T3) ────

test('enableGuardrailOnPipeline tightens the mapped control ON in the next overlay', () => {
  // TOXIC_LANGUAGE → filterToxicity (an org DEFAULT-off control the pipeline may enable).
  const result = enableGuardrailOnPipeline({}, 'TOXIC_LANGUAGE');
  assert.equal(result.ok, true);
  assert.equal(result.key, 'filterToxicity');
  if (result.ok) {
    assert.deepEqual(result.overlay.filterToxicity, { mode: 'default', bool: true });
  }
});

test('enableGuardrailOnPipeline is idempotent + preserves other overlay controls', () => {
  const existing = { requireGrounding: { mode: 'default', bool: true } } as GovernanceControls;
  const result = enableGuardrailOnPipeline(existing, 'GROUNDED');
  assert.equal(result.ok, true);
  if (result.ok) {
    // grounding stays on; nothing else is dropped.
    assert.equal(result.overlay.requireGrounding?.bool, true);
  }
});

test('enableGuardrailOnPipeline coerces a junk stored overlay without throwing', () => {
  const result = enableGuardrailOnPipeline({ junk: 'nonsense', filterToxicity: 42 }, 'PROMPT_INJECTION');
  assert.equal(result.ok, true);
  assert.equal(result.key, 'blockPromptInjection');
});

// ── pipelinesEnforcingGuardrail: the current-scope badge count ────────────────────────────────────

test('pipelinesEnforcingGuardrail lists pipelines whose EFFECTIVE guardrail is on', () => {
  const pipelines = [
    { id: 'p1', name: 'Payroll', guardrailOverlay: { filterToxicity: { mode: 'default', bool: true } } },
    { id: 'p2', name: 'Support', guardrailOverlay: {} },
    { id: 'p3', name: 'Legal', guardrailOverlay: { filterToxicity: { mode: 'default', bool: true } } },
  ];
  const on = pipelinesEnforcingGuardrail('TOXIC_LANGUAGE', pipelines);
  assert.deepEqual(on.map((p) => p.id).sort(), ['p1', 'p3']);
});

test('pipelinesEnforcingGuardrail counts a LOCKED-on org control for every pipeline', () => {
  // requirePiiMasking is locked ON at the org, so every pipeline inherits it → all match.
  const pipelines = [
    { id: 'p1', name: 'A', guardrailOverlay: {} },
    { id: 'p2', name: 'B', guardrailOverlay: {} },
  ];
  const on = pipelinesEnforcingGuardrail('EMAIL_ADDRESS', pipelines);
  assert.equal(on.length, 2);
});
