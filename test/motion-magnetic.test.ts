import assert from 'node:assert/strict';
import { test } from 'node:test';
import { magneticOffset, NO_OFFSET } from '@/lib/motion/magnetic';

const BOX = { halfWidth: 100, halfHeight: 40 };

test('magneticOffset: at centre there is no pull', () => {
  assert.deepEqual(magneticOffset({ dx: 0, dy: 0, ...BOX }), NO_OFFSET);
});

test('magneticOffset: inside the radius eases toward the pointer, capped by strength', () => {
  const o = magneticOffset({ dx: 50, dy: 0, ...BOX, strength: 0.3 });
  // Pull is in the pointer's direction and a fraction of the offset.
  assert.ok(o.x > 0 && o.x < 50, 'x pulls toward pointer but less than the full offset');
  assert.equal(o.y, 0);
});

test('magneticOffset: falls off to zero at the radius edge (no boundary jump)', () => {
  // radiusFactor 1.6 → edge at dx = 160 on the x axis.
  const nearEdge = magneticOffset({ dx: 159, dy: 0, ...BOX, radiusFactor: 1.6 });
  assert.ok(nearEdge.x > 0 && nearEdge.x < 1, 'pull is tiny just inside the edge');
  assert.deepEqual(
    magneticOffset({ dx: 160, dy: 0, ...BOX, radiusFactor: 1.6 }),
    NO_OFFSET,
    'at the edge the pull is zero',
  );
});

test('magneticOffset: outside the radius there is no pull', () => {
  assert.deepEqual(magneticOffset({ dx: 500, dy: 500, ...BOX }), NO_OFFSET);
});

test('magneticOffset: a degenerate (zero-size) box never pulls', () => {
  assert.deepEqual(magneticOffset({ dx: 10, dy: 10, halfWidth: 0, halfHeight: 0 }), NO_OFFSET);
});

test('magneticOffset: stronger strength pulls further', () => {
  const weak = magneticOffset({ dx: 40, dy: 0, ...BOX, strength: 0.2 });
  const strong = magneticOffset({ dx: 40, dy: 0, ...BOX, strength: 0.5 });
  assert.ok(strong.x > weak.x);
});
