'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

// ─── ScrollableTabs — the shared build-detail tab rail (MOBILE BATCH M4) ──────────────────────────
//
// The per-app lifecycle band and the per-pipeline detail band both render a long row of tab links.
// With `flex flex-wrap` those rows collapse into several STACKED rows on a narrow phone (the pipeline
// band has 10+ tabs), eating vertical space and reading as broken. This one component owns the rail
// so both bands can't drift (DRY): on mobile it is a single HORIZONTAL-SCROLL row (no wrap, momentum
// scroll, scroll-snap, hidden scrollbar) with the active tab auto-scrolled into view; on desktop
// (md+) it wraps exactly as before so nothing changes for operators on wide screens.
//
// Tap targets are ≥44px tall on touch (`min-h-11`) while staying compact visually on desktop.

export interface ScrollableTabItem {
  /** Stable key + the value compared against `active`. */
  key: string;
  label: string;
  href: string;
}

export function ScrollableTabs({
  tabs,
  active,
  className,
  'aria-label': ariaLabel,
}: Readonly<{
  tabs: ScrollableTabItem[];
  active: string;
  className?: string;
  'aria-label'?: string;
}>) {
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  // Pull the active tab into view on the mobile rail so an off-screen selection is never hidden.
  // `nearest`/`inline` avoids yanking the whole page — it only nudges the horizontal scroller.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        // Mobile: one non-wrapping row that scrolls sideways inside its own box (the page body never
        // scrolls). Desktop: revert to the original wrapping flow.
        'flex items-center gap-1 overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        'snap-x snap-mandatory md:flex-wrap md:overflow-visible md:snap-none',
        className,
      )}
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            ref={isActive ? activeRef : undefined}
            href={t.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex min-h-11 shrink-0 snap-start items-center whitespace-nowrap rounded-md px-2.5 text-sm transition-colors md:min-h-0 md:py-1',
              isActive
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
