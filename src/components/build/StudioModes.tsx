'use client';

import { ChatCircleDots, SlidersHorizontal } from '@phosphor-icons/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppBuilder } from '@/components/build/AppBuilder';
import type { ConnectorOption } from '@/components/data-domains/DomainFormPanel';
import { StudioForge } from '@/components/studio/StudioForge';
import type { OrgContextSummary } from '@/lib/org-context';

// ─── Studio — ONE builder, two views (App + Forge unified) ────────────────────────────────────────
// App and Forge were the same product wearing two coats. This is the single front door with a mode
// toggle: CHAT (Forge — describe it conversationally, fast draft) and BUILD (the guided/visual step
// builder — precise editing + the pipeline/data/model bindings). Both produce the SAME governed app
// and save to the same place; a user drafts in Chat and refines in Build, or stays in whichever fits.
// The mode lives in ?mode so it's shareable and Back-able.

type Mode = 'chat' | 'build';

export function StudioModes({
  summary,
  domains,
  agents,
  connectors,
  pipelines,
}: Readonly<{
  summary: OrgContextSummary;
  domains: { id: string; label: string }[];
  agents: { id: string; name: string }[];
  connectors: ConnectorOption[];
  pipelines: { id: string; name: string }[];
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const mode: Mode = params.get('mode') === 'chat' ? 'chat' : 'build';

  const setMode = (m: Mode) => {
    const next = new URLSearchParams(params.toString());
    next.set('mode', m);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const tabs: { id: Mode; label: string; hint: string; icon: typeof ChatCircleDots }[] = [
    { id: 'chat', label: 'Chat', hint: 'Describe it and refine by chatting', icon: ChatCircleDots },
    { id: 'build', label: 'Build', hint: 'Guided steps + data/pipeline bindings', icon: SlidersHorizontal },
  ];

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
        {tabs.map((t) => {
          const active = mode === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setMode(t.id)}
              title={t.hint}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 active:scale-95 ${
                active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <t.icon weight={active ? 'fill' : 'regular'} className="size-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {mode === 'chat' ? (
        <StudioForge summary={summary} pipelineOptions={pipelines} />
      ) : (
        <AppBuilder
          summary={summary}
          domains={domains}
          agents={agents}
          connectors={connectors}
          pipelines={pipelines}
        />
      )}
    </div>
  );
}
