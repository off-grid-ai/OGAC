'use client';

import { forwardRef } from 'react';

import { BlurFade } from '@/components/ui/blur-fade';
import { cn } from '@/lib/utils';

/**
 * The dashboard depth primitive: a dense, full-width responsive grid where cells can span columns/
 * rows so a dashboard reads as a composed layout, not a uniform tile wall (DESIGN_PHILOSOPHY §9 —
 * fill the width, hierarchy from size). It carries NO motion of its own; entrance is delegated to
 * BlurFade on each cell so the grid respects reduced motion through the shared primitive. Pure
 * presentation — the caller passes the cards.
 */
const BentoGrid = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'grid w-full auto-rows-[minmax(9rem,auto)] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
BentoGrid.displayName = 'BentoGrid';

interface BentoCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Column span at lg+ (1–4). Larger = the surface's primary focus cell. */
  colSpan?: 1 | 2 | 3 | 4;
  /** Row span for a tall cell (e.g. a feed beside short stat cells). */
  rowSpan?: 1 | 2;
  /** Stagger index so cells reveal in reading order. */
  index?: number;
}

// Static maps (not string interpolation) so Tailwind's JIT sees every class literally.
const COL: Record<NonNullable<BentoCardProps['colSpan']>, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
};
const ROW: Record<NonNullable<BentoCardProps['rowSpan']>, string> = {
  1: 'row-span-1',
  2: 'row-span-2',
};

/**
 * A single Bento cell. Reveals with BlurFade (reduced-motion honored there) and lifts subtly on
 * hover. Spans are class-literal so they survive the build. The visual chrome (border, surface) is
 * the console card language; a caller wanting the spotlight primary cell wraps its content in
 * MagicCard.
 */
function BentoCard({
  className,
  colSpan = 1,
  rowSpan = 1,
  index = 0,
  children,
  ...props
}: BentoCardProps) {
  return (
    <BlurFade
      inView
      delay={index * 0.06}
      className={cn(COL[colSpan], ROW[rowSpan], 'min-w-0')}
    >
      <div
        className={cn(
          'group relative h-full overflow-hidden rounded-lg border border-border bg-card p-4',
          'transition-[transform,border-color,box-shadow] duration-200 ease-out',
          'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm',
          'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </BlurFade>
  );
}

export { BentoGrid, BentoCard };
