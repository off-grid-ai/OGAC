import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beamGradientCoordinates,
  buildBeamPath,
  clampCurvature,
  relativeCenter,
  type Rect,
} from '../src/lib/motion/beam-geometry.ts';

// Pure geometry behind the AnimatedBeam primitive. Proven with plain rectangles (no DOM), so the
// curve/path maths is verifiable without a browser: the beam that draws "data moving from A to B" in
// the gateway/fleet/pipeline topologies is only correct if these produce the right relative points
// and path string.

const container: Rect = { left: 100, top: 50, width: 400, height: 300 };

test('relativeCenter: rect centre is expressed relative to the container origin', () => {
  const node: Rect = { left: 140, top: 90, width: 20, height: 20 };
  // absolute centre (150,100) minus container origin (100,50) => (50,50)
  assert.deepEqual(relativeCenter(node, container), { x: 50, y: 50 });
});

test('buildBeamPath: zero curvature draws a straight quadratic (mid on the line)', () => {
  const path = buildBeamPath({ x: 0, y: 100 }, { x: 200, y: 100 }, 0);
  assert.equal(path, 'M 0,100 Q 100,100 200,100');
});

test('buildBeamPath: positive curvature lifts the control point up (smaller y)', () => {
  const path = buildBeamPath({ x: 0, y: 100 }, { x: 200, y: 100 }, 40);
  // midY = 100 - 40 = 60
  assert.equal(path, 'M 0,100 Q 100,60 200,100');
});

test('beamGradientCoordinates: forward sweeps 0->1, reverse flips to 1->0', () => {
  assert.deepEqual(beamGradientCoordinates(false), { x1: 0, x2: 1 });
  assert.deepEqual(beamGradientCoordinates(true), { x1: 1, x2: 0 });
});

test('clampCurvature: clamps into band and defends against non-finite input', () => {
  assert.equal(clampCurvature(500, 200), 200);
  assert.equal(clampCurvature(-500, 200), -200);
  assert.equal(clampCurvature(30, 200), 30);
  assert.equal(clampCurvature(Number.POSITIVE_INFINITY), 0);
});
