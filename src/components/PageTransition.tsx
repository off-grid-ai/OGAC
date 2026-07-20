'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// Route-level entrance. Keying the wrapper on the pathname re-mounts it on every
// navigation, which replays the `og-page-enter` animation — a calm, opacity-only 120ms
// cross-fade (NO vertical rise) — so every module page, and every route-based section-nav
// tab change (the navs are just `<Link>`s per route), fades in from one place instead of
// per-page code. Opacity-only + short on purpose: a rise here replayed on every nav and,
// stacked with per-card/row entrances, read as a glitchy shimmer.
//
// Motion is defined entirely in CSS (`og-page-enter` in globals.css), which is disabled
// under `prefers-reduced-motion: reduce`, so this honors the opt-out with no JS branch.
export function PageTransition({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  // h-full so the wrapper is transparent to the layout height chain — full-height pages
  // (Chat, etc.) rely on h-full resolving against <main>; without it the wrapper collapses
  // to content height and leaves a void below. The animation is opacity-only (no transform).
  return (
    <div
      key={pathname}
      data-og-shell="route"
      className="og-page-enter h-full min-h-0 w-full min-w-0"
    >
      {children}
    </div>
  );
}
