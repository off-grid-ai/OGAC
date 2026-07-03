import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeShowcase } from '../src/lib/provit.ts';

// Unit tests for the pure showcase-normalization rule — NO mocks, NO network. Exercises the
// real parsing that the Provit route + page depend on, so a regression is caught directly.

test('normalizeShowcase: normalizes a well-formed array', () => {
  const items = normalizeShowcase([
    { id: 'a', title: 'Login flow', url: 'https://provit.example/a', description: 'diff' },
    { id: 'b', title: 'Checkout', url: 'https://provit.example/b' },
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    id: 'a',
    title: 'Login flow',
    url: 'https://provit.example/a',
    description: 'diff',
  });
  assert.equal(items[1].description, undefined);
});

test('normalizeShowcase: accepts { items } / { showcase } / { results } wrappers', () => {
  const one = normalizeShowcase({ items: [{ title: 'X', url: 'u' }] });
  const two = normalizeShowcase({ showcase: [{ title: 'Y', url: 'u' }] });
  const three = normalizeShowcase({ results: [{ title: 'Z', url: 'u' }] });
  assert.equal(one[0].title, 'X');
  assert.equal(two[0].title, 'Y');
  assert.equal(three[0].title, 'Z');
});

test('normalizeShowcase: fills id/title fallbacks and maps alternate keys', () => {
  const items = normalizeShowcase([
    { name: 'By name', link: 'https://x/1', summary: 'sum' }, // name/link/summary aliases
    { href: 'https://x/2' }, // url-only → title falls back to url
    { slug: 'slugged', title: 'T' }, // slug → id
  ]);
  assert.equal(items[0].id, 'item-0');
  assert.equal(items[0].title, 'By name');
  assert.equal(items[0].url, 'https://x/1');
  assert.equal(items[0].description, 'sum');
  assert.equal(items[1].title, 'https://x/2');
  assert.equal(items[2].id, 'slugged');
});

test('normalizeShowcase: drops entries with neither title nor url', () => {
  const items = normalizeShowcase([
    { description: 'orphan' },
    {},
    null,
    42,
    'nope',
    { title: 'Keep', url: 'u' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Keep');
});

test('normalizeShowcase: graceful on malformed / empty / non-object input', () => {
  assert.deepEqual(normalizeShowcase(null), []);
  assert.deepEqual(normalizeShowcase(undefined), []);
  assert.deepEqual(normalizeShowcase('garbage'), []);
  assert.deepEqual(normalizeShowcase(123), []);
  assert.deepEqual(normalizeShowcase([]), []);
  assert.deepEqual(normalizeShowcase({}), []);
  assert.deepEqual(normalizeShowcase({ items: 'not-an-array' }), []);
});

test('normalizeShowcase: trims strings and ignores blank fields', () => {
  const items = normalizeShowcase([{ title: '  Padded  ', url: '  https://x  ', id: '   ' }]);
  assert.equal(items[0].title, 'Padded');
  assert.equal(items[0].url, 'https://x');
  assert.equal(items[0].id, 'item-0'); // blank id → fallback
});
