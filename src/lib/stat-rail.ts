// PURE StatRail class builder — ZERO imports, ZERO I/O, fully unit-testable.
//
// A "stat rail" is a band of small stat cards. On a phone there isn't room for a 3–6 column grid,
// so below the restore breakpoint the band becomes a single horizontal-scroll row (each card keeps
// a sane min-width and the row scrolls sideways — no vertical stack that eats the fold). At and
// above the breakpoint it snaps back to the exact desktop grid it always was, so desktop density is
// untouched.
//
// This module only computes class strings — the <StatRail> wrapper (src/components/ui/StatRail.tsx)
// applies them. Every class is written as a FULL LITERAL string (no runtime interpolation into the
// class name) so the Tailwind v4 JIT can statically see and emit each utility.

// How many columns the band restores to on desktop.
export type StatRailCols = 2 | 3 | 4 | 6;

// The breakpoint at which the rail stops scrolling and becomes the desktop grid.
export type StatRailBreakpoint = 'sm' | 'md' | 'lg' | 'xl';

// Mobile rail (below the restore breakpoint): a horizontal flex row that scrolls sideways. Each
// direct child is given a floor width via the wrapper; here we own the scroll container + gap.
const RAIL_BASE = 'flex gap-3 overflow-x-auto';

// The grid columns to restore at each breakpoint × col count. Full literal strings only.
const GRID_RESTORE: Record<StatRailBreakpoint, Record<StatRailCols, string>> = {
  sm: {
    2: 'sm:grid sm:grid-cols-2 sm:gap-3 sm:overflow-x-visible',
    3: 'sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-x-visible',
    4: 'sm:grid sm:grid-cols-4 sm:gap-3 sm:overflow-x-visible',
    6: 'sm:grid sm:grid-cols-6 sm:gap-3 sm:overflow-x-visible',
  },
  md: {
    2: 'md:grid md:grid-cols-2 md:gap-3 md:overflow-x-visible',
    3: 'md:grid md:grid-cols-3 md:gap-3 md:overflow-x-visible',
    4: 'md:grid md:grid-cols-4 md:gap-3 md:overflow-x-visible',
    6: 'md:grid md:grid-cols-6 md:gap-3 md:overflow-x-visible',
  },
  lg: {
    2: 'lg:grid lg:grid-cols-2 lg:gap-3 lg:overflow-x-visible',
    3: 'lg:grid lg:grid-cols-3 lg:gap-3 lg:overflow-x-visible',
    4: 'lg:grid lg:grid-cols-4 lg:gap-3 lg:overflow-x-visible',
    6: 'lg:grid lg:grid-cols-6 lg:gap-3 lg:overflow-x-visible',
  },
  xl: {
    2: 'xl:grid xl:grid-cols-2 xl:gap-3 xl:overflow-x-visible',
    3: 'xl:grid xl:grid-cols-3 xl:gap-3 xl:overflow-x-visible',
    4: 'xl:grid xl:grid-cols-4 xl:gap-3 xl:overflow-x-visible',
    6: 'xl:grid xl:grid-cols-6 xl:gap-3 xl:overflow-x-visible',
  },
};

// Per-item min-width floor for the mobile rail so cards don't collapse — cleared once the grid
// restores (the grid sizes columns itself). Full literal strings only.
const ITEM_MIN_WIDTH: Record<StatRailBreakpoint, string> = {
  sm: 'min-w-[9rem] shrink-0 sm:min-w-0 sm:shrink',
  md: 'min-w-[9rem] shrink-0 md:min-w-0 md:shrink',
  lg: 'min-w-[9rem] shrink-0 lg:min-w-0 lg:shrink',
  xl: 'min-w-[9rem] shrink-0 xl:min-w-0 xl:shrink',
};

// Classes for the RAIL CONTAINER: horizontal scroll on mobile, restored to a `cols`-column grid at
// and above `at`. `at` defaults to 'sm', `cols` to 3.
export function statRailClasses(at: StatRailBreakpoint = 'sm', cols: StatRailCols = 3): string {
  return `${RAIL_BASE} ${GRID_RESTORE[at][cols]}`;
}

// Classes for EACH ITEM in the rail: a min-width floor on mobile, cleared at/above `at` so the grid
// column sizing takes over. `at` defaults to 'sm'.
export function statRailItemClasses(at: StatRailBreakpoint = 'sm'): string {
  return ITEM_MIN_WIDTH[at];
}
