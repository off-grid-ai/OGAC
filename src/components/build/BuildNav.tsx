'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SubNav } from '@/components/nav/SubNav';
import { isModuleEnabled } from '@/lib/modules';
import { cn } from '@/lib/utils';

// ─── BuildNav — the Build family's scoped secondary-nav (Builder Epic #118: ONE Studio) ───────────
//
// The founder's brief: "agent and studio should become one." There is now ONE front door — Studio —
// that lists every app (an agent is just a 1-step app). "New app" always opens the guided builder.
// You then OPERATE apps: watch app runs (screens 3–4) or read outcomes (screen 5). Individual apps
// open their OWN surface (/apps/<id>) with the five lifecycle tabs rendered by AppLifecycleNav — so
// on those paths this global band is suppressed to avoid two stacked nav bands.
//
// Each tab is a real route (URL-driven, deep-linkable) and disabled modules drop out. The app
// surfaces (/studio, /apps/runs, /apps/reports) have no module id of their own — their pages gate on
// `studio`/`agents` — so their tabs show iff those modules are enabled, and the nav never links to a
// 404. Mirrors DataNav / InsightsNav.

interface Tab {
  gate: Parameters<typeof isModuleEnabled>[0];
  label: string;
  route: string;
}

const GROUPS: { heading: string; tabs: Tab[] }[] = [
  {
    heading: 'Build',
    // ONE Studio front door — lists all apps + agents; "New app" opens the guided builder.
    tabs: [
      { gate: 'studio', label: 'Studio', route: '/studio' },
      { gate: 'brain', label: 'Brain', route: '/brain' },
    ],
  },
  {
    heading: 'Operate',
    tabs: [
      // Global app runs — every app's runs in one list; open one to watch it (3) or review it (4).
      { gate: 'studio', label: 'App runs', route: '/apps/runs' },
      // Durable agent jobs (Temporal) — re-run / cancel / schedule.
      { gate: 'agent-runs', label: 'Jobs', route: '/agent-runs' },
      // Outcomes over time across all app runs (screen 5).
      { gate: 'studio', label: 'Reports', route: '/apps/reports' },
    ],
  },
];

// A per-app detail shell path — /apps/<id> or /apps/<id>/<tab> — where <id> is an app id (NOT one of
// the global-list segments `runs` / `reports`). On these paths AppLifecycleNav owns the band, so the
// global Build band suppresses itself.
function isAppShellPath(pathname: string): boolean {
  const m = pathname.match(/^\/apps\/([^/]+)/);
  if (!m) return false;
  const seg = m[1];
  return seg !== 'runs' && seg !== 'reports';
}

// Longest-prefix match so /apps/runs highlights "App runs" and /apps/reports highlights "Reports".
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

  // Per-app surfaces render their own scoped band (AppLifecycleNav); don't double up.
  if (isAppShellPath(pathname)) return null;

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
