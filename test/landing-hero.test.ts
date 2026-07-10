import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeShotIndex,
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
