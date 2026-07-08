'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isModuleEnabled } from '@/lib/modules';
import { cn } from '@/lib/utils';
import { SubNav } from '@/components/nav/SubNav';

// Scoped secondary-nav for the Data family — the "harness your internal intelligence" plane
// (the builder/data persona). Reads in the flow order data actually moves: connect a source →
// ingest it → make it retrievable → trace where an answer came from. Every tab is a real route
// (URL-driven, deep-linkable) and disabled modules drop out. Mirrors InsightsNav / GovernanceNav.

interface Tab {
  id: Parameters<typeof isModuleEnabled>[0];
  label: string;
  route: string;
}

const GROUPS: { heading: string; tabs: Tab[] }[] = [
  {
    heading: 'Sources',
    tabs: [
      { id: 'integrations', label: 'Integrations', route: '/data/integrations' },
      { id: 'data', label: 'Connectors', route: '/data' },
      // Tool catalog moved to Build → Tools → Catalog (#121); /tool-catalog now redirects there.
      { id: 'data-domains', label: 'Data domains', route: '/data/domains' },
    ],
  },
  {
    heading: 'Retrieve',
    tabs: [{ id: 'retrieval', label: 'Retrieval', route: '/data/retrieval' }],
  },
  {
    heading: 'Trace',
    tabs: [{ id: 'lineage', label: 'Lineage', route: '/data/lineage' }],
  },
];

// Longest-prefix match so nested paths (e.g. /data/integrations) light only their own tab and not
// the /data Connectors landing tab, which is a prefix of every Data route.
function activeRoute(pathname: string): string | null {
  let best: string | null = null;
  for (const g of GROUPS) {
    for (const t of g.tabs) {
      if (pathname === t.route || pathname.startsWith(`${t.route}/`)) {
        if (!best || t.route.length > best.length) best = t.route;
      }
    }
  }
  return best;
}

export function DataNav() {
  const pathname = usePathname();
  const activeR = activeRoute(pathname);

  return (
    <SubNav>
      <nav className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {GROUPS.map((group, gi) => {
        const tabs = group.tabs.filter((t) => isModuleEnabled(t.id));
        if (tabs.length === 0) return null;
        return (
          <div key={group.heading} className="flex items-center gap-1">
            {gi > 0 ? <span className="mx-1.5 h-4 w-px bg-border" aria-hidden /> : null}
            <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground/50">
              {group.heading}
            </span>
            {tabs.map((t) => {
              const active = activeR === t.route;
              return (
                <Link
                  key={t.id}
                  href={t.route}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-sm transition-colors',
                    active
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        );
        })}
      </nav>
    </SubNav>
  );
}
