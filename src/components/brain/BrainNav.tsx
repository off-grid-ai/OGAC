'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { SubNav } from '@/components/nav/SubNav';
import {
  BRAIN_VIEWS,
  type BrainView,
  DEFAULT_BRAIN_VIEW,
  normalizeBrainView,
} from '@/lib/brain-view';
import { cn } from '@/lib/utils';

// Tab types/helpers now live in the server-safe @/lib/brain-view so the server page can import
// normalizeBrainView without crossing the RSC boundary. Re-exported for existing importers.
export { BRAIN_VIEWS, type BrainView, DEFAULT_BRAIN_VIEW, normalizeBrainView };

// Scoped secondary-nav for Brain — the "ingestion → retrieval (RAG)" plane. Brain is ONE page
// whose long section stack is organised into switchable views, so unlike DataNav (one tab = one
// route) each tab here is a `?view=` on the same route. State lives in the URL (deep-linkable,
// Back-coherent — Back steps between views, not off the page), never local state.
// Ordered by how the pipeline actually flows: route a query → wire the tools it can reach → search
// the RAG index → curate the knowledge feeding it → version prompts → measure quality with evals.
// Mirrors DataNav / InsightsNav / GovernanceNav: same band + grouped-tab treatment so it reads as
// the same nav plane as the rest of the console.

interface Tab {
  view: BrainView;
  label: string;
}

const GROUPS: { heading: string; tabs: Tab[] }[] = [
  {
    heading: 'Route',
    tabs: [
      { view: 'router', label: 'Router' },
      { view: 'tools', label: 'Tools' },
    ],
  },
  {
    heading: 'Knowledge',
    tabs: [
      { view: 'retrieval', label: 'Retrieval' },
      { view: 'knowledge', label: 'Knowledge base' },
      { view: 'prompts', label: 'Prompts' },
    ],
  },
  {
    heading: 'Quality',
    tabs: [{ view: 'evals', label: 'Evals' }],
  },
];

export function BrainNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = normalizeBrainView(searchParams.get('view') ?? undefined);

  return (
    <SubNav>
      <nav className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {GROUPS.map((group, gi) => (
          <div key={group.heading} className="flex items-center gap-1">
            {gi > 0 ? <span className="mx-1.5 h-4 w-px bg-border" aria-hidden /> : null}
            <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground/50">
              {group.heading}
            </span>
            {group.tabs.map((t) => {
              const isActive = active === t.view;
              const href =
                t.view === DEFAULT_BRAIN_VIEW ? pathname : `${pathname}?view=${t.view}`;
              return (
                <Link
                  key={t.view}
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
          </div>
        ))}
      </nav>
    </SubNav>
  );
}
