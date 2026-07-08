'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { SubNav } from '@/components/nav/SubNav';
import { cn } from '@/lib/utils';
import { DEFAULT_TOOLS_TAB, normalizeToolsTab, type ToolsTab } from '@/lib/tools-view';

// Scoped secondary-nav for the Tools home (#121). Tabs are ?tab= on the same route — state lives in
// the URL (deep-linkable, Back-coherent — Back steps between tabs, not off the page), never local
// state. Mirrors BrainNav's ?view= treatment so it reads as the same nav plane as the rest.

const TABS: { tab: ToolsTab; label: string }[] = [
  { tab: 'registered', label: 'Registered' },
  { tab: 'catalog', label: 'Catalog' },
  { tab: 'primitives', label: 'Primitives' },
];

export function ToolsNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = normalizeToolsTab(searchParams.get('tab'));

  return (
    <SubNav>
      <nav className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground/50">Tools</span>
        {TABS.map((t) => {
          const isActive = active === t.tab;
          // Reset any tab-scoped params (catalog search/filter) when switching tabs.
          const href = t.tab === DEFAULT_TOOLS_TAB ? pathname : `${pathname}?tab=${t.tab}`;
          return (
            <Link
              key={t.tab}
              href={href}
              scroll={false}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'rounded-md px-2.5 py-1 text-sm transition-colors',
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
    </SubNav>
  );
}
