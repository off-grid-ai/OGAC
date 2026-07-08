'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isModuleEnabled } from '@/lib/modules';
import { cn } from '@/lib/utils';
import { SubNav } from '@/components/nav/SubNav';

// Scoped secondary-nav for the Insights family — observability, analytics, drift, finops, reports,
// and security events are one operator job ("is my AI healthy, safe, and what's it costing?").
// Rendering this at the top of each of those pages turns six disconnected tiles into one connected
// surface: the operator moves between siblings without a trip back to the sidebar. Every tab is a
// real route (URL-driven, deep-linkable, history-aware — per the navigation rule), and disabled
// modules drop out so a deployment only shows what it bought.

interface Tab {
  id: Parameters<typeof isModuleEnabled>[0];
  label: string;
  route: string;
}

// Grouped by the sub-question each answers, in the order an operator triages: health first, then
// cost, then security.
const GROUPS: { heading: string; tabs: Tab[] }[] = [
  {
    heading: 'Health',
    tabs: [
      { id: 'observability', label: 'Observability', route: '/insights' },
      { id: 'analytics', label: 'Analytics', route: '/insights/analytics' },
      { id: 'drift', label: 'Drift', route: '/insights/drift' },
    ],
  },
  {
    heading: 'Cost',
    tabs: [
      { id: 'finops', label: 'FinOps', route: '/insights/finops' },
      { id: 'accounting', label: 'Usage & Spend', route: '/insights/accounting' },
      { id: 'reports', label: 'Reports', route: '/insights/reports' },
    ],
  },
  {
    heading: 'Security',
    tabs: [
      { id: 'siem', label: 'Security Events', route: '/insights/siem' },
      { id: 'audit', label: 'Audit Log', route: '/insights/audit' },
    ],
  },
];

// Longest-prefix match so nested paths light only their own tab, not the /insights Observability
// landing tab (which is a prefix of every Insights route).
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

export function InsightsNav() {
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
