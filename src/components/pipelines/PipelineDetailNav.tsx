'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ScrollableTabs } from '@/components/build/ScrollableTabs';
import { SubNav } from '@/components/nav/SubNav';
import { activeTabForPath, pipelineTabs } from '@/lib/pipeline-detail';

// ─── PipelineDetailNav — the per-pipeline scoped SubNav band (mirrors AppLifecycleNav) ────────────
//
// A Pipeline is the governed chokepoint; opening one gives its own surface with the governance +
// telemetry tabs. Every saved pipeline lives under /pipelines/<id>; this renders the tabs (Overview ·
// Gateway & Routing · Policy · Guardrails · Quality · Drift · Observability · Audit · Cost · API ·
// Versions), each a real deep-linkable route scoped to the pipeline id. Tab selection is URL-driven
// (activeTabForPath, the pure resolver in pipeline-detail.ts) so Back walks the tabs — never useState.
export function PipelineDetailNav({ pipelineId, name }: Readonly<{ pipelineId: string; name: string }>) {
  const pathname = usePathname();
  const tabs = pipelineTabs(pipelineId);
  const active = activeTabForPath(pathname, pipelineId) ?? 'overview';
  const activeHint = tabs.find((t) => t.tab === active)?.hint ?? '';

  return (
    <SubNav>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href="/build/pipelines"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Pipelines
          </Link>
          <span className="text-muted-foreground/40" aria-hidden>
            /
          </span>
          <span className="truncate text-sm font-medium text-foreground" title={name}>
            {name}
          </span>
        </div>
        <ScrollableTabs
          aria-label="Pipeline sections"
          tabs={tabs.map((t) => ({ key: t.tab, label: t.label, href: t.href }))}
          active={active}
        />
        {activeHint ? <p className="text-[11px] text-muted-foreground">{activeHint}</p> : null}
      </div>
    </SubNav>
  );
}
