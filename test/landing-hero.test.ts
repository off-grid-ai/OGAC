import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeShotIndex,
  nextFocusTarget,
  stepIndex,
  resolveShot,
  togglePromoted,
  type TourShot,
} from '@/lib/landing-hero';

const SHOTS: TourShot[] = [
  { id: 'studio', src: '/a.png', alt: 'a', label: 'Studio', caption: 'ca' },
  { id: 'route', src: '/b.png', alt: 'b', label: 'Route', caption: 'cb' },
  { id: 'trace', src: '/c.png', alt: 'c', label: 'Trace', caption: 'cc' },
];

test('resolveShot: known id returns that shot', () => {
  assert.equal(resolveShot(SHOTS, 'trace').id, 'trace');
  assert.equal(resolveShot(SHOTS, 'route').src, '/b.png');
});

test('resolveShot: unknown/empty/absent falls back to the first shot', () => {
  assert.equal(resolveShot(SHOTS, 'nope').id, 'studio');
  assert.equal(resolveShot(SHOTS, '').id, 'studio');
  assert.equal(resolveShot(SHOTS, null).id, 'studio');
  assert.equal(resolveShot(SHOTS, undefined).id, 'studio');
});

test('resolveShot: empty list throws (a tour must have shots)', () => {
  assert.throws(() => resolveShot([], 'x'), /must not be empty/);
});

test('activeShotIndex: matches id, else 0', () => {
  assert.equal(activeShotIndex(SHOTS, 'trace'), 2);
  assert.equal(activeShotIndex(SHOTS, 'studio'), 0);
  assert.equal(activeShotIndex(SHOTS, 'nope'), 0);
  assert.equal(activeShotIndex(SHOTS, null), 0);
  assert.equal(activeShotIndex([], 'x'), 0);
});

test('togglePromoted: clicking the current hero clears it, else selects', () => {
  assert.equal(togglePromoted(null, 'route'), 'route');
  assert.equal(togglePromoted('studio', 'route'), 'route');
  assert.equal(togglePromoted('route', 'route'), null, 'clicking the active card toggles off');
  assert.equal(togglePromoted(undefined, 'trace'), 'trace');
});

test('nextFocusTarget: Tab on the last element wraps to the first', () => {
  assert.equal(nextFocusTarget(3, 2, false), 'first');
});

test('nextFocusTarget: Shift+Tab on the first element wraps to the last', () => {
  assert.equal(nextFocusTarget(3, 0, true), 'last');
});

test('nextFocusTarget: interior positions do not intercept (browser moves focus)', () => {
  assert.equal(nextFocusTarget(3, 1, false), null);
  assert.equal(nextFocusTarget(3, 1, true), null);
  assert.equal(nextFocusTarget(3, 0, false), null, 'Tab off the first goes to the second, not wrap');
  assert.equal(nextFocusTarget(3, 2, true), null, 'Shift+Tab off the last goes back one, not wrap');
});

test('nextFocusTarget: an empty focusable set never intercepts', () => {
  assert.equal(nextFocusTarget(0, -1, false), null);
  assert.equal(nextFocusTarget(0, -1, true), null);
});

test('nextFocusTarget: a single focusable element wraps to itself both ways', () => {
  assert.equal(nextFocusTarget(1, 0, false), 'first');
  assert.equal(nextFocusTarget(1, 0, true), 'last');
});

// ── stepIndex — clamped lightbox/carousel navigation (arrow keys + on-screen prev/next) ──────────────
test('stepIndex: steps forward and backward within bounds', () => {
  assert.equal(stepIndex(5, 0, 1), 1);
  assert.equal(stepIndex(5, 2, 1), 3);
  assert.equal(stepIndex(5, 3, -1), 2);
});

test('stepIndex: clamps at both ends (no wrap)', () => {
  assert.equal(stepIndex(5, 4, 1), 4, 'past last stays on last');
  assert.equal(stepIndex(5, 0, -1), 0, 'before first stays on first');
});

test('stepIndex: single-item set never moves', () => {
  assert.equal(stepIndex(1, 0, 1), 0);
  assert.equal(stepIndex(1, 0, -1), 0);
});

test('stepIndex: empty set and out-of-range current are safe', () => {
  assert.equal(stepIndex(0, 0, 1), 0);
  assert.equal(stepIndex(3, 99, 1), 2, 'out-of-range current is clamped first');
  assert.equal(stepIndex(3, -5, -1), 0);
});
