'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isModuleEnabled } from '@/lib/modules';
import { cn } from '@/lib/utils';

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
      { id: 'observability', label: 'Observability', route: '/observability' },
      { id: 'analytics', label: 'Analytics', route: '/analytics' },
      { id: 'drift', label: 'Drift', route: '/drift' },
    ],
  },
  {
    heading: 'Cost',
    tabs: [
      { id: 'finops', label: 'FinOps', route: '/finops' },
      { id: 'accounting', label: 'Usage & Spend', route: '/accounting' },
      { id: 'reports', label: 'Reports', route: '/reports' },
    ],
  },
  {
    heading: 'Security',
    tabs: [{ id: 'siem', label: 'Security Events', route: '/siem' }],
  },
];

export function InsightsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-border pb-3">
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
              const active = pathname === t.route || pathname.startsWith(`${t.route}/`);
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
  );
}
