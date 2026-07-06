'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SubNav } from '@/components/nav/SubNav';
import { isModuleEnabled } from '@/lib/modules';
import { cn } from '@/lib/utils';

// Scoped secondary-nav for the Build family — ONE builder, not two surfaces. The founder's brief:
// "agent and studio should become one" — a Studio app can do everything an agent can, and an agent
// is just a one-step app. So the IA reads as a single builder: you author/manage APPS (the front
// door lists apps + agents together; "New" always opens the guided builder at /studio/new), then
// you OPERATE them — watch multi-step app runs (screens 3–4), inspect durable jobs, and read
// outcomes (screen 5).
//
// Each tab is a real route (URL-driven, deep-linkable) and disabled modules drop out. The app
// surfaces (/studio, /apps/runs, /apps/reports) have no module id of their own — their pages gate on
// `studio` — so their tabs are shown iff `studio` is enabled, and the nav never links to a 404.
// Mirrors DataNav / InsightsNav.

interface Tab {
  gate: Parameters<typeof isModuleEnabled>[0];
  label: string;
  route: string;
}

const GROUPS: { heading: string; tabs: Tab[] }[] = [
  {
    heading: 'Build',
    tabs: [
      // The front door: apps + agents, one roster, one "New" → the guided builder.
      { gate: 'agents', label: 'Apps', route: '/agents' },
      // The advanced authoring surface: visual canvas + saved assistant templates.
      { gate: 'studio', label: 'Studio', route: '/studio' },
    ],
  },
  {
    heading: 'Operate',
    tabs: [
      // Multi-step app runs — watch one execute live (screen 3) or open one paused for review (4).
      { gate: 'studio', label: 'App runs', route: '/apps/runs' },
      // Durable agent jobs (Temporal) — re-run / cancel / schedule.
      { gate: 'agent-runs', label: 'Jobs', route: '/agent-runs' },
      // Outcomes over time across app runs (screen 5).
      { gate: 'studio', label: 'Reports', route: '/apps/reports' },
    ],
  },
];

// Longest-prefix match so /apps/runs highlights "App runs" (not a shorter tab) and /apps/reports
// highlights "Reports" — both live under /apps but are distinct tabs. Falls back to exact match or a
// `${route}/` prefix per tab.
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

export function BuildNav() {
  const pathname = usePathname();
  const active = activeRoute(pathname);

  return (
    <SubNav>
      <nav className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {GROUPS.map((group, gi) => {
          const tabs = group.tabs.filter((t) => isModuleEnabled(t.gate));
          if (tabs.length === 0) return null;
          return (
            <div key={group.heading} className="flex items-center gap-1">
              {gi > 0 ? <span className="mx-1.5 h-4 w-px bg-border" aria-hidden /> : null}
              <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground/50">
                {group.heading}
              </span>
              {tabs.map((t) => {
                const isActive = active === t.route;
                return (
                  <Link
                    key={t.route}
                    href={t.route}
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
            </div>
          );
        })}
      </nav>
    </SubNav>
  );
}
