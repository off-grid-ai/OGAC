import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_PAGE_SIZE,
  ELLIPSIS,
  clampPage,
  clampPageSize,
  pageRange,
  paginate,
} from '../src/lib/paginate.ts';

// PURE unit tests for the pagination math — no React, no DOM, no I/O. Real functions, no mocks.
// These pin the slicing, page-clamping, and the compact page-range used by the shared control.

const items = Array.from({ length: 100 }, (_, i) => i + 1); // [1..100]

// ─── paginate ────────────────────────────────────────────────────────────────
test('paginate slices the correct page window', () => {
  const r = paginate(items, 1, 25);
  assert.deepEqual(r.pageItems, items.slice(0, 25));
  assert.equal(r.page, 1);
  assert.equal(r.pageCount, 4);
  assert.equal(r.total, 100);
  assert.equal(r.from, 1);
  assert.equal(r.to, 25);
  assert.equal(r.hasPrev, false);
  assert.equal(r.hasNext, true);
});

test('paginate middle page has both prev and next', () => {
  const r = paginate(items, 2, 25);
  assert.deepEqual(r.pageItems, items.slice(25, 50));
  assert.equal(r.from, 26);
  assert.equal(r.to, 50);
  assert.equal(r.hasPrev, true);
  assert.equal(r.hasNext, true);
});

test('paginate last (partial) page ends at total', () => {
  const r = paginate(items.slice(0, 90), 4, 25);
  assert.equal(r.pageCount, 4);
  assert.equal(r.pageItems.length, 15);
  assert.equal(r.from, 76);
  assert.equal(r.to, 90);
  assert.equal(r.hasNext, false);
});

test('paginate clamps an over-range page to the last page (stale URL)', () => {
  const r = paginate(items, 999, 25);
  assert.equal(r.page, 4);
  assert.deepEqual(r.pageItems, items.slice(75, 100));
});

test('paginate clamps a sub-1 / non-finite page to 1', () => {
  assert.equal(paginate(items, 0, 25).page, 1);
  assert.equal(paginate(items, -5, 25).page, 1);
  assert.equal(paginate(items, NaN, 25).page, 1);
});

test('paginate empty list → one page, no items, zero from/to', () => {
  const r = paginate([], 1, 25);
  assert.equal(r.pageCount, 1);
  assert.equal(r.total, 0);
  assert.equal(r.from, 0);
  assert.equal(r.to, 0);
  assert.equal(r.hasPrev, false);
  assert.equal(r.hasNext, false);
  assert.deepEqual(r.pageItems, []);
});

test('paginate coerces a bad page size to the default', () => {
  const r = paginate(items, 1, 0);
  assert.equal(r.pageSize, DEFAULT_PAGE_SIZE);
});

test('paginate does not mutate the input array', () => {
  const src = [...items];
  paginate(src, 2, 10);
  assert.deepEqual(src, items);
});

// ─── clampPage / clampPageSize ─────────────────────────────────────────────────
test('clampPage bounds into [1, pageCount]', () => {
  assert.equal(clampPage(5, 3), 3);
  assert.equal(clampPage(-1, 3), 1);
  assert.equal(clampPage(2, 3), 2);
  assert.equal(clampPage(1, 0), 1); // pageCount 0 → min 1
});

test('clampPageSize rejects junk, keeps positive ints', () => {
  assert.equal(clampPageSize(50), 50);
  assert.equal(clampPageSize(0), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(-3), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(NaN), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(0, 10), 10);
});

// ─── pageRange ─────────────────────────────────────────────────────────────────
test('pageRange lists every page when small', () => {
  assert.deepEqual(pageRange(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageRange(3, 7), [1, 2, 3, 4, 5, 6, 7]);
});

test('pageRange collapses right side near the start', () => {
  const r = pageRange(2, 20);
  assert.equal(r[0], 1);
  assert.equal(r[r.length - 1], 20);
  assert.ok(r.includes(ELLIPSIS));
  // No left ellipsis: it should start with a contiguous run.
  assert.deepEqual(r.slice(0, 4), [1, 2, 3, 4]);
});

test('pageRange collapses left side near the end', () => {
  const r = pageRange(19, 20);
  assert.equal(r[0], 1);
  assert.equal(r[1], ELLIPSIS);
  assert.equal(r[r.length - 1], 20);
});

test('pageRange shows both ellipses in the middle', () => {
  const r = pageRange(10, 20);
  assert.deepEqual(r, [1, ELLIPSIS, 9, 10, 11, ELLIPSIS, 20]);
});

test('pageRange always includes first, last, and current', () => {
  for (const [p, c] of [
    [1, 50],
    [25, 50],
    [50, 50],
    [3, 4],
  ] as const) {
    const r = pageRange(p, c);
    assert.ok(r.includes(1), `has first (p=${p} c=${c})`);
    assert.ok(r.includes(c), `has last (p=${p} c=${c})`);
    assert.ok(r.includes(clampPage(p, c)), `has current (p=${p} c=${c})`);
  }
});

test('pageRange never emits an ellipsis hiding a single page', () => {
  // 7 pages, current 4: with siblings=1 the budget shows all 7 rather than "1 … 4 … 7".
  assert.deepEqual(pageRange(4, 7), [1, 2, 3, 4, 5, 6, 7]);
});
