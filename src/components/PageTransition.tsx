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
  return (
    <div key={pathname} className="og-page-enter">
      {children}
    </div>
  );
}
