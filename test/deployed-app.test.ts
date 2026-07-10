import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDeployedApp } from '../src/lib/deployed-app.ts';

// The public /app/<slug> gate: a slug resolves to a servable app ONLY when the app is published AND
// carries a non-empty slug. This is the exact regression the 404 fix closes — the page used to query
// studioTemplates while published apps + the run endpoint live in the `apps` table.

test('resolveDeployedApp: a published app with a slug resolves', () => {
  const r = resolveDeployedApp({ title: 'KYC Verifier', summary: 'Checks OVDs', slug: 'kyc-verifier-ab12', published: true });
  assert.deepEqual(r, { title: 'KYC Verifier', summary: 'Checks OVDs', slug: 'kyc-verifier-ab12' });
});

test('resolveDeployedApp: an UNPUBLISHED app 404s (returns null) — never served publicly', () => {
  assert.equal(resolveDeployedApp({ title: 'Draft', summary: '', slug: 'draft-xy99', published: false }), null);
});

test('resolveDeployedApp: a published-but-slugless app 404s (returns null)', () => {
  assert.equal(resolveDeployedApp({ title: 'No slug', summary: '', slug: null, published: true }), null);
  assert.equal(resolveDeployedApp({ title: 'Blank slug', summary: '', slug: '   ', published: true }), null);
  assert.equal(resolveDeployedApp({ title: 'Missing slug', summary: '', published: true }), null);
});

test('resolveDeployedApp: a missing app (null/undefined) 404s', () => {
  assert.equal(resolveDeployedApp(null), null);
  assert.equal(resolveDeployedApp(undefined), null);
});

test('resolveDeployedApp: normalizes display fields (trims, falls back to slug, blank summary)', () => {
  const r = resolveDeployedApp({ title: '  ', summary: undefined, slug: '  slugged-app  ', published: true });
  assert.deepEqual(r, { title: 'slugged-app', summary: '', slug: 'slugged-app' });
});
