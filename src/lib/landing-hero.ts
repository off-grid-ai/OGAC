// Pure decision for the landing "product tour": which product shot is showing in the top hero, and
// which surface a lightbox is opened on. Both are driven from the URL (?shot=<id>) so the tour is
// deep-linkable and Back-coherent (the nav rule) -  this module turns the raw query value into the
// resolved shot, with zero IO so it is unit-testable and reused by both the hero and the carousel.

export interface TourShot {
  /** Stable id used as the ?shot= URL value and the React key. */
  id: string;
  src: string;
  alt: string;
  label: string;
  caption: string;
}

/**
 * Resolve the shot a given ?shot= value points at. An unknown, empty, or absent value falls back to
 * the default (index 0) -  the tour always shows a real screenshot, never a blank hero.
 */
export function resolveShot(shots: readonly TourShot[], id: string | null | undefined): TourShot {
  if (shots.length === 0) throw new Error('resolveShot: shots must not be empty');
  const found = id ? shots.find((s) => s.id === id) : undefined;
  return found ?? shots[0];
}

/** The index of the resolved shot -  for marking the active card in the rail. */
export function activeShotIndex(shots: readonly TourShot[], id: string | null | undefined): number {
  if (shots.length === 0) return 0;
  const i = id ? shots.findIndex((s) => s.id === id) : -1;
  return i >= 0 ? i : 0;
}

/**
 * The next URL query value when a card is clicked to promote it to the hero. Clicking the shot that
 * is ALREADY the hero clears the selection (returns null → back to default) so the interaction
 * toggles cleanly; any other card returns its id.
 */
export function togglePromoted(
  currentId: string | null | undefined,
  clickedId: string,
): string | null {
  return currentId === clickedId ? null : clickedId;
}

/**
 * The next index when stepping a lightbox/carousel by keyboard arrow or on-screen prev/next.
 * CLAMPED at both ends (no wrap): stepping past the last stays on the last, before the first stays
 * on the first — so the on-screen arrows can be disabled at the bounds and the ←/→ keys never jump
 * the viewer off the ends. Pure (length + index + direction in, index out) so the navigation rule is
 * unit-testable without the DOM. An empty set returns 0.
 */
export function stepIndex(count: number, current: number, dir: 1 | -1): number {
  if (count <= 0) return 0;
  const clamped = Math.max(0, Math.min(current, count - 1));
  return Math.max(0, Math.min(clamped + dir, count - 1));
}

/**
 * The focus-trap decision for a lightbox / modal on a Tab keypress: given the ordered focusable
 * elements and which one currently holds focus, return the element focus should WRAP to (and thus
 * the default should be prevented), or null to let the browser move focus normally. Kept pure (no
 * DOM access, indices only) so the wrap logic is unit-testable without a real focus trap.
 *
 * - Tab on the last element wraps to the first; Shift+Tab on the first wraps to the last.
 * - Any other position returns null (no interception), as does an empty set.
 */
export function nextFocusTarget(
  count: number,
  activeIndex: number,
  shiftKey: boolean,
): 'first' | 'last' | null {
  if (count === 0) return null;
  if (shiftKey && activeIndex === 0) return 'last';
  if (!shiftKey && activeIndex === count - 1) return 'first';
  return null;
}
