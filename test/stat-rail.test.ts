import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  statRailClasses,
  statRailItemClasses,
  type StatRailBreakpoint,
  type StatRailCols,
} from '../src/lib/stat-rail.ts';

// Unit tests for the PURE StatRail class builder — NO mocks, no I/O. Every breakpoint × col arm is
// asserted for BOTH the mobile-rail base (horizontal scroll) and the desktop-grid restore, so the
// full literal class strings the Tailwind JIT depends on are locked in.

const ALL_AT: StatRailBreakpoint[] = ['sm', 'md', 'lg', 'xl'];
const ALL_COLS: StatRailCols[] = [2, 3, 4, 6];

test('statRailClasses always includes the mobile horizontal-scroll rail base', () => {
  for (const at of ALL_AT) {
    for (const cols of ALL_COLS) {
      const c = statRailClasses(at, cols);
      assert.ok(c.includes('flex'), `${at}/${cols} missing flex`);
      assert.ok(c.includes('overflow-x-auto'), `${at}/${cols} missing overflow-x-auto`);
      assert.ok(c.includes('gap-3'), `${at}/${cols} missing gap-3`);
    }
  }
});

test('statRailClasses restores the exact desktop grid at each breakpoint × col count', () => {
  for (const at of ALL_AT) {
    for (const cols of ALL_COLS) {
      const c = statRailClasses(at, cols);
      assert.ok(c.includes(`${at}:grid`), `${at}/${cols} missing ${at}:grid`);
      assert.ok(c.includes(`${at}:grid-cols-${cols}`), `${at}/${cols} missing grid-cols`);
      assert.ok(
        c.includes(`${at}:overflow-x-visible`),
        `${at}/${cols} missing overflow restore`,
      );
    }
  }
});

test('statRailClasses covers the new cols:6 arm (mobile rail + desktop 6-col restore)', () => {
  for (const at of ALL_AT) {
    const c = statRailClasses(at, 6);
    assert.ok(c.includes('overflow-x-auto'), `${at}/6 mobile rail`);
    assert.ok(c.includes(`${at}:grid-cols-6`), `${at}/6 restore`);
  }
});

test("statRailClasses covers the new at:'xl' arm (mobile rail + xl restore) for every col count", () => {
  for (const cols of ALL_COLS) {
    const c = statRailClasses('xl', cols);
    assert.ok(c.includes('overflow-x-auto'), `xl/${cols} mobile rail`);
    assert.ok(c.includes('xl:grid'), `xl/${cols} grid`);
    assert.ok(c.includes(`xl:grid-cols-${cols}`), `xl/${cols} restore`);
    assert.ok(c.includes('xl:overflow-x-visible'), `xl/${cols} overflow restore`);
  }
});

test('statRailClasses defaults to at="sm", cols=3', () => {
  assert.equal(statRailClasses(), statRailClasses('sm', 3));
});

test('statRailItemClasses floors width on mobile and clears it at the restore breakpoint', () => {
  for (const at of ALL_AT) {
    const c = statRailItemClasses(at);
    assert.ok(c.includes('min-w-[9rem]'), `${at} missing mobile min-width`);
    assert.ok(c.includes('shrink-0'), `${at} missing mobile shrink-0`);
    assert.ok(c.includes(`${at}:min-w-0`), `${at} missing restore clear`);
    assert.ok(c.includes(`${at}:shrink`), `${at} missing restore shrink`);
  }
});

test("statRailItemClasses covers the new at:'xl' arm", () => {
  const c = statRailItemClasses('xl');
  assert.equal(c, 'min-w-[9rem] shrink-0 xl:min-w-0 xl:shrink');
});

test('statRailItemClasses defaults to at="sm"', () => {
  assert.equal(statRailItemClasses(), statRailItemClasses('sm'));
});
