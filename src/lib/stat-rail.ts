// Pure class-string logic for the mobile stat RAIL primitive (see components/ui/StatRail.tsx).
//
// The founder's mobile rule: a band of stat cards must NOT collapse into a tall single-column
// stack (more vertical scroll = worse). On mobile it becomes a compact HORIZONTAL rail that
// scrolls sideways with snap; from the chosen breakpoint up it reverts to the EXACT desktop grid
// that shipped before, so wide screens are unchanged.
//
// This is a zero-IO, unit-testable string builder. The React wrapper just applies its output.
//
// IMPORTANT (Tailwind v4): every returned class must appear as a COMPLETE literal in source so the
// JIT scanner emits it — no runtime-interpolated class fragments (`${at}:grid-cols-${n}` would be
// dropped). Hence the full-string lookup tables below.

export type StatRailBreakpoint = 'sm' | 'md' | 'lg';

/** How many columns the restored desktop grid uses. */
export type StatRailCols = 2 | 3 | 4;

// Mobile rail: a horizontal flex track, snap, scrollbar hidden, tight gap, negative-margin so the
// cards can bleed to the page padding edge and scroll fully. Reuses the repo's established
// scrollbar-hiding idiom (see ui/cards-carousel.tsx). Each direct child gets a fixed-ish min width,
// never shrinks, and snaps to start — so the band reads as a single compact row within one fold.
const MOBILE_RAIL =
  '-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] ' +
  '[&::-webkit-scrollbar]:hidden [&>*]:min-w-[8.5rem] [&>*]:shrink-0 [&>*]:snap-start';

// At/above the breakpoint the container becomes a grid again and every rail affordance is undone,
// so desktop renders byte-for-byte the prior layout. Full literals, one per breakpoint.
const DESKTOP_RESET: Record<StatRailBreakpoint, string> = {
  sm: 'sm:mx-0 sm:grid sm:snap-none sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:[&>*]:min-w-0 sm:[&>*]:shrink',
  md: 'md:mx-0 md:grid md:snap-none md:gap-4 md:overflow-visible md:px-0 md:pb-0 md:[&>*]:min-w-0 md:[&>*]:shrink',
  lg: 'lg:mx-0 lg:grid lg:snap-none lg:gap-4 lg:overflow-visible lg:px-0 lg:pb-0 lg:[&>*]:min-w-0 lg:[&>*]:shrink',
};

// The column count restored at the breakpoint. Full literals per (breakpoint, cols).
const DESKTOP_COLS: Record<StatRailBreakpoint, Record<StatRailCols, string>> = {
  sm: { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' },
  md: { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' },
  lg: { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' },
};

/**
 * Full container class string for a stat rail.
 *
 * @param at    breakpoint at/above which the desktop grid returns (default 'lg').
 * @param cols  columns in the restored desktop grid (default 4).
 */
export function statRailClasses(at: StatRailBreakpoint = 'lg', cols: StatRailCols = 4): string {
  return `${MOBILE_RAIL} ${DESKTOP_RESET[at]} ${DESKTOP_COLS[at][cols]}`;
}
