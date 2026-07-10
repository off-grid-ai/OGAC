import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRateLimit, type Counter } from '../src/lib/rate-limit.ts';
import { parseCloudProviders, selectCloudProvider } from '../src/lib/cloud-providers.ts';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ADVERSARIAL break-test of the CONSOLE GATEWAY + MODEL-SETTINGS feature.
//
// This file is the QA-on-a-bug-hunt companion to the existing (author-written) suites. Its job is to
// PROVE THE DEVELOPER WRONG at the intersections the happy-path tests skip — not to re-confirm known
// behavior. Confirmed breaks are `test.skip`'d (so `npm test` stays green) with a G-ADV-GW-* ref and
// the RED assertion left intact; un-skip after the fix lands to watch red→green. Full write-up:
// docs/adversarial/gateway.md. Backlog: docs/GAPS_BACKLOG.md (G-ADV-GW-*).
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function freshMap(): Map<string, Counter> {
  return new Map<string, Counter>();
}

// ── G-ADV-GW-1 (HIGH): a NaN clock permanently WEDGES a rate-limit bucket ──────────────────────────
//
// checkRateLimit(key, cfg, now, counters) has NO guard on `now`. A single call with `now = NaN`
// writes `resetAt = NaN` into the bucket. Thereafter `now > entry.resetAt` is ALWAYS false (every
// comparison with NaN is false), so the window can NEVER reset — the key/IP is denied FOREVER, with
// a NaN retry-after. `now` is `Date.now()` in the middleware today (not directly attacker-reachable),
// but checkRateLimit is an exported pure primitive with a documented contract and other callers; a
// bad/mocked clock, or any future caller, silently corrupts shared state that never self-heals.
// This is a fail-CLOSED-forever robustness defect (a DoS-on-self, not an over-admit).
//
// RED: the recovery call SHOULD be allowed once a real clock arrives, but the poisoned resetAt blocks
// it permanently. Un-skip after checkRateLimit clamps/rejects a non-finite `now`.
test.skip('G-ADV-GW-1: a NaN now must not permanently wedge the bucket (currently DOES)', () => {
  const counters = freshMap();
  const cfg = { limit: 1, windowMs: 60_000 };
  checkRateLimit('k', cfg, Number.NaN, counters); // poisons resetAt = NaN
  // A later request on a REAL, well past-window clock must open a fresh window.
  const recovered = checkRateLimit('k', cfg, 10_000_000, counters);
  assert.equal(recovered.allow, true, 'a healthy clock after a NaN must re-admit — bucket must self-heal');
});

// Characterization (PASSES today) — documents the exact broken state so a future reader sees it.
test('G-ADV-GW-1 (characterization): NaN now writes a poisoned, never-resetting bucket', () => {
  const counters = freshMap();
  const cfg = { limit: 1, windowMs: 60_000 };
  const first = checkRateLimit('k', cfg, Number.NaN, counters);
  assert.equal(first.allow, true, 'first call under limit 1 is admitted');
  assert.ok(Number.isNaN(counters.get('k')!.resetAt), 'resetAt is poisoned to NaN');
  // Every subsequent call — on ANY clock — is denied, because now > NaN is always false.
  assert.equal(checkRateLimit('k', cfg, 10_000_000, counters).allow, false, 'wedged: denied forever');
  assert.ok(Number.isNaN(checkRateLimit('k', cfg, 10_000_000, counters).retryAfterSec), 'retry-after is NaN');
});

// ── G-ADV-GW-2 (LOW): off-by-one at the EXACT reset instant ────────────────────────────────────────
//
// Window reset uses `now > entry.resetAt` (strict). At the exact millisecond now === resetAt the
// window is treated as still-closed (deny), not reset. Benign (1ms), but undocumented and untested —
// a boundary the author's "60_001" test steps over.
test('G-ADV-GW-2 (characterization): now === resetAt is still the OLD window (deny), off-by-one', () => {
  const counters = freshMap();
  const cfg = { limit: 1, windowMs: 60_000 };
  assert.equal(checkRateLimit('k', cfg, 0, counters).allow, true); // resetAt = 60_000
  assert.equal(
    checkRateLimit('k', cfg, 60_000, counters).allow,
    false,
    'at now===resetAt the window has NOT reset (uses > not >=) — one-ms starvation at the boundary',
  );
});

// ── G-ADV-GW-3 (MEDIUM): selectCloudProvider matches a provider token in the MIDDLE of a model id ──
//
// The matcher (cloud-providers.ts:187) accepts `lower.includes(`:${prefix}:`)` — a SUBSTRING match,
// not a prefix. So an arbitrary / mistyped / adversarial model tag that merely CONTAINS `:openai:`
// anywhere is bound to the OpenAI cloud provider, and the upstream model is then mangled to whatever
// follows the LAST colon (line 197). A model id like `my-local-model:openai:v2` → provider=openai,
// upstream=`v2`. That is a wrong-provider + corrupted-model routing bug. The existing test only
// exercises the well-formed leading triple form `cloud:openai:gpt-4o`, so this crossing is uncovered.
//
// RED: a token buried mid-string must NOT select that cloud provider. Un-skip after the matcher is
// tightened to a true prefix / anchored form.
test.skip('G-ADV-GW-3: a provider token in the MIDDLE of a model id must not route to that cloud provider', () => {
  const providers = parseCloudProviders({
    OFFGRID_CLOUD_OPENAI_API_KEY: 'sk-openai',
    OFFGRID_CLOUD_ANTHROPIC_API_KEY: 'sk-ant',
  });
  const sel = selectCloudProvider(providers, 'my-local-model:openai:v2');
  assert.equal(sel, null, 'a mid-string :openai: is not a provider selector — must be null, not a cloud route');
});

// Characterization (PASSES today) — proves the mis-route + the model mangling happen.
test('G-ADV-GW-3 (characterization): mid-string :openai: mis-routes to cloud + mangles the model', () => {
  const providers = parseCloudProviders({
    OFFGRID_CLOUD_OPENAI_API_KEY: 'sk-openai',
    OFFGRID_CLOUD_ANTHROPIC_API_KEY: 'sk-ant',
  });
  const sel = selectCloudProvider(providers, 'my-local-model:openai:v2');
  assert.equal(sel?.provider.id, 'openai', 'buried :openai: still binds the OpenAI cloud provider');
  assert.equal(sel?.model, 'v2', 'the upstream model is corrupted to the tail after the last colon');
});
