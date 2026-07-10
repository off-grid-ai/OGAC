// The single source of truth for "intelligent enterprise" motion timing. Every animated primitive
// and every fan-out surface imports these instead of hardcoding a duration or curve — so the whole
// console breathes on ONE rhythm and a change here retunes everything (DRY). Zero IO: pure tokens +
// pure decisions, unit-testable, safe to import from server or client.

/**
 * Motion durations in SECONDS (the unit `motion`/framer-motion transitions expect). These encode
 * the restraint budget from DESIGN_PHILOSOPHY §7: micro feedback is near-instant, hovers are
 * perceptible-but-quick, reveals are deliberate, and count-ups are the longest because a number
 * settling is the one place slowness reads as "thinking", not lag.
 */
export const DURATION = {
  /** 120ms — micro feedback: press, toggle, checkbox, active-state flips. */
  micro: 0.12,
  /** 240ms — hover elevation, tab underline, focus ring, spotlight follow. */
  hover: 0.24,
  /** 400ms — surface/section reveal, blur-fade entrances, list-item stagger unit. */
  reveal: 0.4,
  /** 900ms — count-up settle and beam sweeps: long enough to read as data resolving. */
  data: 0.9,
} as const;

export type DurationToken = keyof typeof DURATION;

/**
 * Easing curves as cubic-bezier tuples (framer-motion accepts `number[]`). `standard` is the
 * workhorse ease-out; `entrance` decelerates harder for reveals; `emphasized` has a faint
 * overshoot-free settle for numbers/springs. No bounce anywhere — bounce reads as playful.
 */
export const EASE = {
  standard: [0.22, 1, 0.36, 1],
  entrance: [0.16, 1, 0.3, 1],
  emphasized: [0.33, 1, 0.68, 1],
} as const;

export type EaseToken = keyof typeof EASE;

/** The stagger step (seconds) between consecutive items in a list/grid reveal. */
export const STAGGER_STEP = 0.06;

/**
 * The delay (seconds) for the nth item in a staggered reveal, capped so a long list never makes the
 * last row wait seconds to appear — after `maxVisible` items the delay plateaus.
 */
export function staggerDelay(index: number, step = STAGGER_STEP, maxVisible = 12): number {
  const i = Math.max(0, Math.min(index, maxVisible));
  return i * step;
}

/**
 * The governing rule of the whole system: reduced motion is ALWAYS honored. Given the user's
 * preference, return the effective transition duration — 0 when reduced (snap to final state, no
 * animation), the requested token otherwise. Presentation reads the final value instantly; it is
 * never hidden behind an animation that won't play.
 */
export function effectiveDuration(token: DurationToken, prefersReducedMotion: boolean): number {
  return prefersReducedMotion ? 0 : DURATION[token];
}

/**
 * Whether a decorative/looping animation should run at all. Reduced motion disables loops entirely
 * (a repeating beam/pulse is decoration, and decoration must not move when motion is reduced);
 * one-shot reveals instead collapse to duration 0 via effectiveDuration above.
 */
export function shouldAnimateLoop(prefersReducedMotion: boolean): boolean {
  return !prefersReducedMotion;
}
