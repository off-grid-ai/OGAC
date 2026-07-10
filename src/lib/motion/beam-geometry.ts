// Pure geometry for the AnimatedBeam primitive (src/components/ui/animated-beam.tsx). The beam draws
// a curved SVG connector between two DOM rects (a "from" node and a "to" node) inside a container,
// then sweeps an emerald gradient along it to show data MOVING between two things (gateway -> node,
// source -> collection, pipeline stage -> stage). All the maths — rect-to-relative-point, the
// quadratic control point for the curve, the path string — is here: zero DOM, so it is unit-testable
// with plain rectangles. The component only measures rects (I/O) and feeds them in.

/** A minimal rectangle shape (the fields we use from getBoundingClientRect). */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A point in the container's local SVG coordinate space. */
export interface Point {
  x: number;
  y: number;
}

/** The centre of `rect` expressed relative to `container`'s top-left. */
export function relativeCenter(rect: Rect, container: Rect): Point {
  return {
    x: rect.left - container.left + rect.width / 2,
    y: rect.top - container.top + rect.height / 2,
  };
}

/**
 * Build the quadratic-bezier path connecting two points, bowed by `curvature` px. A positive
 * curvature lifts the midpoint UP (negative y) so parallel beams in a topology fan out and read as
 * distinct flows rather than overlapping straight lines. Curvature 0 yields a straight line.
 */
export function buildBeamPath(from: Point, to: Point, curvature = 0): string {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2 - curvature;
  return `M ${from.x},${from.y} Q ${midX},${midY} ${to.x},${to.y}`;
}

/**
 * The gradient stop coordinates for the sweeping highlight, as x1/x2 fractions the component maps to
 * a moving <linearGradient>. `reverse` flips the sweep direction (to -> from) so a bidirectional
 * link (request out, response back) can render two beams travelling opposite ways.
 */
export function beamGradientCoordinates(reverse: boolean): { x1: number; x2: number } {
  return reverse ? { x1: 1, x2: 0 } : { x1: 0, x2: 1 };
}

/** Clamp curvature to a sane band so a mis-passed value can't produce a wild loop. */
export function clampCurvature(curvature: number, max = 200): number {
  if (!Number.isFinite(curvature)) return 0;
  return Math.max(-max, Math.min(max, curvature));
}
