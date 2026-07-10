import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  statRailClasses,
  statRailItemClasses,
  type StatRailBreakpoint,
  type StatRailCols,
} from '@/lib/stat-rail';

// <StatRail> — a band of small stat cards that is a horizontal-scroll rail on mobile and snaps back
// to the exact desktop grid at/above `at` (never a tall single-column stack — it scrolls sideways
// and stays within a fold). Wraps each child so it gets a min-width floor on the rail (cleared once
// the grid restores). Desktop density is unchanged — at `at`+ it IS the same grid it always was.
//
// Drop-in for the repeated `<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">…</div>` band:
// pass the same stat Cards / <Stat> tiles as children. All class logic lives in the pure
// `statRailClasses`/`statRailItemClasses` (src/lib/stat-rail.ts) so it's unit-tested; this is thin
// render only. Defaults (`at='lg'`, `cols=4`) match the most common 4-up band so a bare
// `<StatRail>` restores a 4-column grid at lg — callers override for 3/6-col or sm/xl bands.
export function StatRail({
  at = 'lg',
  cols = 4,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  /** Breakpoint at/above which the desktop grid returns. Default 'lg'. */
  at?: StatRailBreakpoint;
  /** Columns in the restored desktop grid. Default 4. */
  cols?: StatRailCols;
}) {
  const itemClasses = statRailItemClasses(at);
  return (
    <div data-slot="stat-rail" className={cn(statRailClasses(at, cols), className)} {...props}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child) ? <div className={itemClasses}>{child}</div> : child,
      )}
    </div>
  );
}
