import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statRailClasses } from '../src/lib/stat-rail.ts';

// Pure class-string builder for the mobile stat RAIL. No IO. We assert the contract that matters:
// mobile is a horizontal scroll rail, desktop reverts to the prior grid at the chosen breakpoint,
// and every class is a complete literal (Tailwind v4 JIT can only see whole strings).

test('defaults: mobile rail + lg:grid-cols-4', () => {
  const c = statRailClasses();
  // Mobile is a horizontal, scrolling, snapping rail with a hidden scrollbar.
  assert.match(c, /\bflex\b/);
  assert.match(c, /\boverflow-x-auto\b/);
  assert.match(c, /\bsnap-x\b/);
  assert.match(c, /\[scrollbar-width:none\]/);
  assert.match(c, /\[&::-webkit-scrollbar\]:hidden/);
  // Children are fixed-min-width, non-shrinking, snap-aligned so the band is one compact row.
  assert.match(c, /\[&>\*\]:min-w-\[8\.5rem\]/);
  assert.match(c, /\[&>\*\]:shrink-0/);
  // Desktop default: grid returns at lg, 4-up.
  assert.match(c, /\blg:grid\b/);
  assert.match(c, /\blg:grid-cols-4\b/);
  // Rail affordances are neutralised at the breakpoint (desktop == prior layout).
  assert.match(c, /\blg:snap-none\b/);
  assert.match(c, /\blg:overflow-visible\b/);
  assert.match(c, /\blg:mx-0\b/);
  assert.match(c, /\blg:\[&>\*\]:min-w-0\b/);
});

test('honours breakpoint and column count', () => {
  const c = statRailClasses('sm', 4);
  assert.match(c, /\bsm:grid\b/);
  assert.match(c, /\bsm:grid-cols-4\b/);
  assert.match(c, /\bsm:snap-none\b/);
  // No stray lg classes when sm is chosen.
  assert.doesNotMatch(c, /\blg:/);
});

test('all breakpoint x column combos emit complete literal classes', () => {
  const bps = ['sm', 'md', 'lg'] as const;
  const cols = [2, 3, 4] as const;
  for (const at of bps) {
    for (const n of cols) {
      const c = statRailClasses(at, n);
      // The exact column literal must be present verbatim (no interpolated fragments).
      assert.ok(c.includes(`${at}:grid-cols-${n}`), `${at}/${n} missing grid-cols literal`);
      assert.ok(c.includes(`${at}:grid`), `${at}/${n} missing grid switch`);
      // Never emit a broken/partial token.
      assert.doesNotMatch(c, /grid-cols-undefined|:grid-cols-\s/);
    }
  }
});
