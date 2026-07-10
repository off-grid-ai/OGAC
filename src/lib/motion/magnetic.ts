// Pure geometry for a "magnetic" hover-intent control: as the pointer approaches an element, the
// element eases a small distance TOWARD the pointer (transform only), giving the CTA a sense of
// intent -  it reaches for you. Zero IO, unit-testable; the .tsx reads the element rect and applies
// the returned translate. Reduced motion is honored by the caller returning {0,0} (see identity).

export interface MagneticInput {
  /** Pointer position relative to the element's centre, in px. */
  dx: number;
  dy: number;
  /** Half-extent of the element (px) -  the pull is measured against the element's own size. */
  halfWidth: number;
  halfHeight: number;
  /** Fraction of the offset the element travels (0..1). Small by design -  restraint. */
  strength?: number;
  /** Beyond this multiple of the half-extent the pull is zero (pointer is too far to matter). */
  radiusFactor?: number;
}

export interface Offset {
  x: number;
  y: number;
}

export const NO_OFFSET: Offset = { x: 0, y: 0 };

/**
 * The translate to apply. Inside the active radius the element eases toward the pointer by
 * `strength` of the offset; outside it, it rests. The pull also falls off linearly with distance so
 * there is no jump at the radius boundary.
 */
export function magneticOffset({
  dx,
  dy,
  halfWidth,
  halfHeight,
  strength = 0.3,
  radiusFactor = 1.6,
}: MagneticInput): Offset {
  const rx = halfWidth * radiusFactor;
  const ry = halfHeight * radiusFactor;
  if (rx <= 0 || ry <= 0) return NO_OFFSET;

  // Normalised distance from centre (1 == at the radius edge). Outside the ellipse: no pull.
  const norm = Math.hypot(dx / rx, dy / ry);
  if (norm >= 1) return NO_OFFSET;

  const falloff = 1 - norm; // linear ease to zero at the edge
  return { x: dx * strength * falloff, y: dy * strength * falloff };
}
