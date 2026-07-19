import type { CSSProperties } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// On-brand loading skeletons for the console's `loading.tsx` route fallbacks. Composed from the
// shared `Skeleton` primitive (which pulses, and goes static under prefers-reduced-motion), so every
// streamed navigation shows an immediate, layout-shaped placeholder instead of a blank screen or a
// bare spinner. Full-width by default (the console is desktop-first) and honest — a shimmer of the
// real layout, never fake data.
//
// These are the building blocks; each route group's loading.tsx assembles the pieces to mirror its
// own page shape (header + stat band + a grid or a table). Kept presentational and prop-driven so a
// group can dial the column/row counts to its real layout without copy-pasting markup.

/** Page title + subtitle + optional right-aligned action button placeholder. */
export function SkeletonPageHeader({ action = true }: Readonly<{ action?: boolean }>) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-2.5">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {action ? <Skeleton className="h-9 w-32 shrink-0" /> : null}
    </div>
  );
}

/** A horizontal band of stat tiles — mirrors the `grid grid-cols-2 lg:grid-cols-4` stat rows. */
export function SkeletonStatBand({ count = 4 }: Readonly<{ count?: number }>) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card
          key={i}
          className="gap-3 border-border/60 p-5 [&_[data-slot=skeleton]]:[animation-delay:calc(var(--og-motion-micro)*var(--skeleton-phase))]"
          style={{ '--skeleton-phase': i % 4 } as CSSProperties}
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-20" />
        </Card>
      ))}
    </div>
  );
}

/** A responsive grid of card placeholders — the default IA for entity collections. */
export function SkeletonCardGrid({
  count = 6,
  className,
}: Readonly<{
  count?: number;
  className?: string;
}>) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Card
          key={i}
          className="gap-4 border-border/60 p-5 [&_[data-slot=skeleton]]:[animation-delay:calc(var(--og-motion-micro)*var(--skeleton-phase))]"
          style={{ '--skeleton-phase': i % 4 } as CSSProperties}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/** A full-width table placeholder — mirrors list surfaces rendered as rows. */
export function SkeletonTable({ rows = 8, cols = 5 }: Readonly<{ rows?: number; cols?: number }>) {
  return (
    <Card className="gap-0 overflow-hidden border-border/60 p-0">
      <div className="flex items-center gap-4 border-b bg-muted/40 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className={cn('h-3.5', i === 0 ? 'w-40' : 'w-24')} />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className={cn('h-4', c === 0 ? 'w-40' : 'w-24')} />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** A large detail panel placeholder — for `[id]` detail routes (header + meta + body blocks). */
export function SkeletonDetailBody() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card
            key={i}
            className="gap-3 border-border/60 p-5 [&_[data-slot=skeleton]]:[animation-delay:calc(var(--og-motion-micro)*var(--skeleton-phase))]"
            style={{ '--skeleton-phase': i % 4 } as CSSProperties}
          >
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </Card>
        ))}
      </div>
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card
            key={i}
            className="gap-3 border-border/60 p-5 [&_[data-slot=skeleton]]:[animation-delay:calc(var(--og-motion-micro)*var(--skeleton-phase))]"
            style={{ '--skeleton-phase': (i + 3) % 4 } as CSSProperties}
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-3 w-24" />
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * Convenience full-page skeleton: header + stat band + card grid, the shape of most console list
 * pages. Route groups whose pages are table- or detail-shaped compose the pieces directly instead.
 */
export function PageSkeleton({
  stats = 4,
  cards = 8,
  action = true,
}: Readonly<{
  stats?: number;
  cards?: number;
  action?: boolean;
}>) {
  return (
    <div className="w-full space-y-5" aria-busy="true" aria-live="polite">
      <SkeletonPageHeader action={action} />
      {stats > 0 ? <SkeletonStatBand count={stats} /> : null}
      <SkeletonCardGrid count={cards} />
    </div>
  );
}
