import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  statRailClasses,
  type StatRailBreakpoint,
  type StatRailCols,
} from '@/lib/stat-rail';

// Shared stat-band container. On mobile it's a compact HORIZONTAL snap rail (one row, scrolls
// sideways, stays within a fold — never a tall single-column stack); at/above `at` it reverts to
// the exact responsive grid the band used before, so wide desktop is unchanged.
//
// Drop-in for the repeated `<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">…</div>` band:
// pass the same stat Cards / <Stat> tiles as children. All class logic lives in the pure
// `statRailClasses` (src/lib/stat-rail.ts) so it's unit-tested; this is thin render only.

export function StatRail({
  children,
  at = 'lg',
  cols = 4,
  className,
}: {
  children: ReactNode;
  /** Breakpoint at/above which the desktop grid returns. Default 'lg'. */
  at?: StatRailBreakpoint;
  /** Columns in the restored desktop grid. Default 4. */
  cols?: StatRailCols;
  className?: string;
}) {
  return <div className={cn(statRailClasses(at, cols), className)}>{children}</div>;
}
