'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AgentRunsManager } from '@/components/agent-runs/AgentRunsManager';
import { DurableExecutionsPanel } from '@/components/agent-runs/DurableExecutionsPanel';
import { SchedulesPanel } from '@/components/agent-runs/SchedulesPanel';
import type { RunSummaryRow, RunsSummary } from '@/lib/agent-runs';

// URL-driven panel switcher (?panel=jobs|runs|schedules). The Jobs (durable-executions) surface is
// the DEFAULT + first tab — the operator's live view of what's running now, at what state, and
// where rerun/cancel live. Run history is the recorded DB timeline; Schedules are recurring fires.
// Navigation lives in the URL so Back steps between panels and each is deep-linkable.
//
// `panel=executions` stays accepted as a legacy alias for `jobs` so old deep links don't break.
type Panel = 'jobs' | 'runs' | 'schedules';
const PANELS: { id: Panel; label: string }[] = [
  { id: 'jobs', label: 'Jobs' },
  { id: 'runs', label: 'Run history' },
  { id: 'schedules', label: 'Schedules' },
];

function resolvePanel(raw: string | null): Panel {
  if (raw === 'runs' || raw === 'schedules') return raw;
  // 'executions' is the legacy alias for the Jobs panel; empty/unknown → Jobs (the default).
  return 'jobs';
}

export function AgentRunsTabs({
  runs,
  statusCounts,
  totalRuns,
}: {
  runs: RunSummaryRow[];
  statusCounts: RunsSummary['statusCounts'];
  totalRuns: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const panel = resolvePanel(params.get('panel'));

  const select = useCallback(
    (id: Panel) => {
      const next = new URLSearchParams(params.toString());
      if (id === 'jobs') next.delete('panel');
      else next.set('panel', id);
      // Switching panels resets panel-local nav params so we don't carry a stale detail id across.
      for (const k of ['run', 'wf', 'new', 'status']) next.delete(k);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border text-sm">
        {PANELS.map((p) => (
          <button
            key={p.id}
            onClick={() => select(p.id)}
            className={`-mb-px border-b-2 px-3 py-2 ${
              panel === p.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {panel === 'jobs' ? (
        <DurableExecutionsPanel />
      ) : panel === 'runs' ? (
        <AgentRunsManager runs={runs} statusCounts={statusCounts} totalRuns={totalRuns} />
      ) : (
        <SchedulesPanel />
      )}
    </div>
  );
}
