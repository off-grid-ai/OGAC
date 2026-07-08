import assert from 'node:assert/strict';
import { test } from 'node:test';

// Coverage for the small, zero-IO leaf helpers under src/lib that the app's server + client
// surfaces share. Real behaviour, no mocks.
import { cn } from '../src/lib/utils.ts';
import {
  BRAIN_VIEWS,
  DEFAULT_BRAIN_VIEW,
  normalizeBrainView,
  type BrainView,
} from '../src/lib/brain-view.ts';
import { posthogHeadTag } from '../src/lib/posthog-snippet.ts';
import { INTEGRATIONS, type IntegrationLayer } from '../src/lib/integrations.ts';

// ─── utils.cn ───────────────────────────────────────────────────────────────
test('cn joins truthy classes and drops falsy ones', () => {
  assert.equal(cn('a', 'b'), 'a b');
  assert.equal(cn('a', false, null, undefined, 'b'), 'a b');
});

test('cn merges conflicting tailwind classes (last wins)', () => {
  // twMerge collapses conflicting utilities — the later px wins.
  assert.equal(cn('px-2', 'px-4'), 'px-4');
  // conditional object form is supported via clsx
  assert.equal(cn({ 'text-red-500': true, hidden: false }), 'text-red-500');
});

test('cn with no input is the empty string', () => {
  assert.equal(cn(), '');
});

// ─── brain-view.normalizeBrainView ───────────────────────────────────────────
test('every declared BRAIN_VIEWS value normalizes to itself', () => {
  for (const v of BRAIN_VIEWS) {
    assert.equal(normalizeBrainView(v), v as BrainView);
  }
});

test('normalizeBrainView takes the first element of an array param', () => {
  assert.equal(normalizeBrainView(['tools', 'evals']), 'tools');
  // first element invalid → default
  assert.equal(normalizeBrainView(['nope', 'tools']), DEFAULT_BRAIN_VIEW);
});

test('normalizeBrainView defaults on undefined / empty / unknown', () => {
  assert.equal(normalizeBrainView(undefined), DEFAULT_BRAIN_VIEW);
  assert.equal(normalizeBrainView(''), DEFAULT_BRAIN_VIEW);
  assert.equal(normalizeBrainView('does-not-exist'), DEFAULT_BRAIN_VIEW);
  assert.equal(normalizeBrainView([]), DEFAULT_BRAIN_VIEW);
  assert.equal(DEFAULT_BRAIN_VIEW, 'router');
});

// ─── posthog-snippet.posthogHeadTag ───────────────────────────────────────────
test('posthogHeadTag emits a self-contained <script> with the configured key + host', () => {
  const tag = posthogHeadTag();
  // KEY has a hard-coded fallback, so it is always set in this env → non-empty tag.
  assert.ok(tag.startsWith('<script>'));
  assert.ok(tag.trimEnd().endsWith('</script>'));
  assert.ok(tag.includes('posthog.init('));
  // the host default is embedded as JSON
  assert.ok(tag.includes('us.i.posthog.com'));
  // JSON.stringify quoting means the key is embedded as a quoted string literal
  assert.match(tag, /posthog\.init\("phc_/);
});

// ─── integrations.INTEGRATIONS ────────────────────────────────────────────────
test('INTEGRATIONS is a non-empty, well-formed catalog with unique layers', () => {
  assert.ok(Array.isArray(INTEGRATIONS));
  assert.ok(INTEGRATIONS.length > 5);
  const layers = INTEGRATIONS.map((l: IntegrationLayer) => l.layer);
  assert.equal(new Set(layers).size, layers.length, 'layer names are unique');
  for (const l of INTEGRATIONS) {
    assert.ok(l.layer.length > 0, 'layer has a name');
    assert.ok(l.blurb.length > 0, 'layer has a blurb');
    assert.ok(Array.isArray(l.tools) && l.tools.length > 0, `${l.layer} lists tools`);
    for (const t of l.tools) assert.ok(t.length > 0);
  }
});

test('INTEGRATIONS includes the first-party gateway layer', () => {
  const gw = INTEGRATIONS.find((l) => l.tools.includes('Off Grid AI Gateway'));
  assert.ok(gw, 'gateway layer present');
});
