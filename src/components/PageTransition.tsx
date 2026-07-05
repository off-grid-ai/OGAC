'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

// Route-level entrance. Keying the wrapper on the pathname re-mounts it on every
// navigation, which replays the `og-page-enter` animation (fade + subtle rise) — so
// every module page, and every route-based section-nav tab change (the navs are just
// `<Link>`s per route), cross-fades in from one place instead of per-page code.
//
// Motion is defined entirely in CSS (`og-page-enter` in globals.css), which is disabled
// under `prefers-reduced-motion: reduce`, so this honors the opt-out with no JS branch.
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // h-full so the wrapper is transparent to the layout height chain — full-height pages
  // (Chat, etc.) rely on h-full resolving against <main>; without it the wrapper collapses
  // to content height and leaves a void below. The animation is transform/opacity only.
  return (
    <div key={pathname} className="og-page-enter h-full">
      {children}
    </div>
  );
}
