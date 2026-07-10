import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  statRailClasses,
  statRailItemClasses,
  type StatRailBreakpoint,
  type StatRailCols,
} from '@/lib/stat-rail';

// <StatRail> — a band of small stat cards that is a horizontal-scroll rail on mobile and snaps back
// to the exact desktop grid at/above `at`. Wraps each child so it gets a min-width floor on the
// rail (cleared once the grid restores). Desktop density is unchanged — at `at`+ it IS the same
// grid it always was.
//
// Usage: replace `<div className="grid grid-cols-2 ... lg:grid-cols-6">{stats}</div>` with
// `<StatRail at="lg" cols={6}>{stats}</StatRail>`.
export function StatRail({
  at = 'sm',
  cols = 3,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  at?: StatRailBreakpoint;
  cols?: StatRailCols;
}) {
  const itemClasses = statRailItemClasses(at);
  return (
    <div data-slot="stat-rail" className={cn(statRailClasses(at, cols), className)} {...props}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child) ? (
          <div className={itemClasses}>{child}</div>
        ) : (
          child
        ),
      )}
    </div>
  );
}
