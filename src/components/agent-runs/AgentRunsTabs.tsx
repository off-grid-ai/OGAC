'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AgentRunsManager } from '@/components/agent-runs/AgentRunsManager';
import { DurableExecutionsPanel } from '@/components/agent-runs/DurableExecutionsPanel';
import { SchedulesPanel } from '@/components/agent-runs/SchedulesPanel';
import type { RunSummaryRow, RunsSummary } from '@/lib/agent-runs';

// URL-driven panel switcher (?panel=runs|executions|schedules). The recorded run history is the
// default; the durable-executions + schedules panels are the Temporal-side surfaces. Navigation
// lives in the URL so Back steps between panels and each is deep-linkable.
type Panel = 'runs' | 'executions' | 'schedules';
const PANELS: { id: Panel; label: string }[] = [
  { id: 'runs', label: 'Run history' },
  { id: 'executions', label: 'Durable executions' },
  { id: 'schedules', label: 'Schedules' },
];

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
  const raw = params.get('panel');
  const panel: Panel = raw === 'executions' || raw === 'schedules' ? raw : 'runs';

  const select = useCallback(
    (id: Panel) => {
      const next = new URLSearchParams(params.toString());
      if (id === 'runs') next.delete('panel');
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

      {panel === 'runs' ? (
        <AgentRunsManager runs={runs} statusCounts={statusCounts} totalRuns={totalRuns} />
      ) : panel === 'executions' ? (
        <DurableExecutionsPanel />
      ) : (
        <SchedulesPanel />
      )}
    </div>
  );
}
