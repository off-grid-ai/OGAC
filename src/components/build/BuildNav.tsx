'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SubNav } from '@/components/nav/SubNav';
import { isModuleEnabled } from '@/lib/modules';
import { cn } from '@/lib/utils';

// Scoped secondary-nav for the Build family — the "author and operate your agents" plane. Studio
// and Agents overlap conceptually (Studio *authors* an assistant; Agents *lists and runs* the
// resulting definitions), so they live under one section reached in the order work actually flows:
// build one (Studio) → manage the roster (Agents) → watch executions (Runs). Every tab is a real
// route (URL-driven, deep-linkable) and disabled modules drop out. Mirrors DataNav / InsightsNav.

interface Tab {
  id: Parameters<typeof isModuleEnabled>[0];
  label: string;
  route: string;
}

const GROUPS: { heading: string; tabs: Tab[] }[] = [
  {
    heading: 'Build',
    tabs: [
      { id: 'agents', label: 'Agents', route: '/agents' },
      { id: 'studio', label: 'Studio', route: '/studio' },
    ],
  },
  {
    heading: 'Operate',
    tabs: [
      { id: 'agent-runs', label: 'Runs', route: '/agent-runs' },
      { id: 'reports', label: 'Reports', route: '/apps/reports' },
    ],
  },
];

export function BuildNav() {
  const pathname = usePathname();

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
    </SubNav>
  );
}
