import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Shared band wrapper for every scoped secondary-nav (Workspace / Build / Data / Insights /
// Governance). The secondary-nav strip is its own zone — a distinct, on-brand surface band that
// separates it from both the top page header and the content below — so it reads as a deliberate
// navigation plane instead of blending into the page.
//
// Styling lives here ONCE so the five tab strips can't drift. Each nav passes its <nav>…tabs as
// children; this component owns the band: the secondary surface tint (`bg-muted/40` → the tiered
// `--og-surface-light` token, one step off the page background in both themes), a bottom border,
// and comfortable padding. A negative horizontal margin equal to the console <main> padding (p-6)
// plus matching inner padding lets the band bleed to the content edges so it reads as a full-width
// strip, while the tabs stay aligned with the page content below. The active-tab emerald treatment
// stays on the tabs themselves.
export function SubNav({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        '-mx-6 -mt-6 border-b border-border bg-muted/40 px-6 py-3',
        className,
      )}
    >
      {children}
    </div>
  );
}
