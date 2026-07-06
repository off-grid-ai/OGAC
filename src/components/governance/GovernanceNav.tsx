'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isModuleEnabled } from '@/lib/modules';
import { cn } from '@/lib/utils';
import { SubNav } from '@/components/nav/SubNav';

// Scoped secondary-nav for the Governance family — the compliance officer's job ("prove to a
// regulator this is controlled"). Policy, access, safety, and assurance surfaces read as one
// connected experience instead of scattered tiles. Every tab is a real route (URL-driven,
// deep-linkable) and disabled modules drop out. Mirrors InsightsNav.

interface Tab {
  id: Parameters<typeof isModuleEnabled>[0];
  label: string;
  route: string;
}

// Grouped by the compliance sub-question, in the order posture is assessed: what's enforced, what
// keeps data safe, and what's provable to an auditor.
const GROUPS: { heading: string; tabs: Tab[] }[] = [
  {
    heading: 'Enforce',
    tabs: [
      { id: 'control', label: 'Control', route: '/control' },
      { id: 'policy', label: 'Policy', route: '/policy' },
      { id: 'access', label: 'Access', route: '/access' },
    ],
  },
  {
    heading: 'Protect',
    tabs: [
      { id: 'guardrails', label: 'Guardrails', route: '/guardrails' },
      { id: 'secrets', label: 'Secrets', route: '/secrets' },
    ],
  },
  {
    heading: 'Prove',
    tabs: [
      { id: 'regulatory', label: 'Regulatory', route: '/regulatory' },
      { id: 'provenance', label: 'Provenance', route: '/provenance' },
    ],
  },
];

export function GovernanceNav() {
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
