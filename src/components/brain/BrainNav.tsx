'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { SubNav } from '@/components/nav/SubNav';
import {
  type BrainView,
  DEFAULT_BRAIN_VIEW,
  normalizeBrainView,
} from '@/lib/brain-view';
import { cn } from '@/lib/utils';

// Tab types/helpers now live in the server-safe @/lib/brain-view so the server page can import
// normalizeBrainView without crossing the RSC boundary. Re-exported for existing importers.
export { BRAIN_VIEWS } from '@/lib/brain-view';
export { type BrainView, DEFAULT_BRAIN_VIEW, normalizeBrainView };

// Scoped secondary-nav for Brain — the "ingestion → retrieval (RAG)" plane. Brain is ONE page
// whose long section stack is organised into switchable views, unlike global collection navigation
// route) each tab here is a `?view=` on the same route. State lives in the URL (deep-linkable,
// Back-coherent — Back steps between views, not off the page), never local state.
// Ordered by how the pipeline actually flows: route a query → search the RAG index → curate the
// knowledge feeding it → version prompts → measure quality with evals.
// Uses the scoped detail-navigation band so it reads as
// the same nav plane as the rest of the console.
//
// IA-nav-dedup: two concepts used to be double-listed across the nav; each now has ONE home.
//   • Tools — the canonical Tools hub is Build → Tools (#121). Brain's `?view=tools` is only a
//     read-only mirror of that same registry (the view even says "reads the same registry managed
//     under Build → Tools" and links there), so it is no longer advertised as a Brain nav TAB — the
//     duplicate "Tools" label is gone. `tools` stays a valid BrainView so the existing deep-link
//     `?view=tools` still resolves and renders the mirror; it just isn't a tab you land on here.
//   • Knowledge — the sidebar's "Knowledge" row (/workspace/knowledge, the org-wide "Ask Your Org"
//     KB used to ground chat) is a DIFFERENT store from Brain's agent-RAG index. To stop the
//     "Knowledge" LABEL from appearing twice in the nav, this group is headed "Retrieval" (the RAG
//     plane) rather than "Knowledge". The store dedup itself was done in #134; this fixes the NAV.

interface Tab {
  view: BrainView;
  label: string;
}

const GROUPS: { heading: string; tabs: Tab[] }[] = [
  {
    heading: 'Route',
    tabs: [{ view: 'router', label: 'Router' }],
  },
  {
    heading: 'Retrieval',
    tabs: [
      { view: 'retrieval', label: 'Retrieval' },
      { view: 'knowledge', label: 'Agent knowledge base' },
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
