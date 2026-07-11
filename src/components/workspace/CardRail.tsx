import { cn } from '@/lib/utils';
import { normalizeChildren, railKey } from '@/lib/workspace-rail';

// Workspace-scoped responsive card layout (Knowledge / Projects / Prompts lists).
//
// Mobile (< sm): a DENSE HORIZONTAL RAIL — children lay out in a single row that scrolls sideways
// with scroll-snap, so the list stays inside the fold instead of becoming a tall vertical stack
// (the founder's mobile principle: minimize vertical scroll, fold-aware real estate). Each child is
// pinned to a readable min-width; the rail scrolls inside its OWN overflow-x container so the page
// body never scrolls horizontally.
//
// Desktop (>= sm): the normal responsive grid, UNCHANGED — the same tokened grid every workspace
// list already used (2 / 3 / 4 columns as the viewport widens).
//
// This is the single source of truth for that "grid on desktop, rail on mobile" behavior so the
// three list surfaces don't each re-derive it. Presentation only — no state, no logic. NOTE: kept in
// the workspace/ folder (not ui/) on purpose so it can't collide with a generic rail another agent
// may add under components/ui; if both land, we dedupe at review.
//
// Uses `flex-none basis-*` on the RAIL, and lets the GRID own sizing — so a child needs no per-call
// width class. On the rail, children are sized here via a wrapping span; in the grid they pass
// through untouched.
export function CardRail({
  children,
  className,
  itemClassName,
}: Readonly<{
  children: React.ReactNode;
  className?: string;
  /** Extra classes applied to each rail item wrapper on mobile (e.g. a wider min-width). */
  itemClassName?: string;
}>) {
  const items = normalizeChildren(children);
  return (
    <>
      {/* Mobile rail — horizontal, scroll-snap, own overflow container. Hidden at sm+. */}
      <div
        className={cn(
          'flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 sm:hidden',
          // edge padding so the first/last card isn't flush to the viewport edge
          '-mx-1 px-1',
          className,
        )}
      >
        {items.map((child, i) => (
          <div
            key={railKey(child, i)}
            className={cn('w-[78%] max-w-[20rem] flex-none snap-start', itemClassName)}
          >
            {child as React.ReactNode}
          </div>
        ))}
      </div>

      {/* Desktop grid — the original tokened responsive grid, unchanged. Hidden below sm. */}
      <div
        className={cn(
          'hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
