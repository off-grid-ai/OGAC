'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AskPanel } from '@/components/copilot/AskPanel';
import { SuggestControlsTool } from '@/components/copilot/SuggestControlsTool';
import { SuggestExpectationsTool } from '@/components/copilot/SuggestExpectationsTool';

// The Ops Copilot surface. Full-width: the ask/answer column fills the page, an anomalies-at-a-glance
// rail sits beside it on wide screens, and the self-service tools (suggest guardrails+evals, generate
// data-quality expectations) live under a URL-driven tab so each is deep-linkable and Back-coherent.

interface FlaggedAnomaly {
  metric: string;
  label: string;
  value: number;
  baseline: number;
  deviation: number;
  direction: 'spike' | 'dip';
  severity: 'warning' | 'critical';
}

type ToolTab = 'ask' | 'controls' | 'expectations';

const TABS: { id: ToolTab; label: string; blurb: string }[] = [
  { id: 'ask', label: 'Ask', blurb: 'Ask the copilot about your platform' },
  { id: 'controls', label: 'Suggest controls', blurb: 'Guardrails + evals for a new pipeline' },
  { id: 'expectations', label: 'Data-quality checks', blurb: 'Expectations from a table schema' },
];

export function CopilotConsole({ anomalies }: { anomalies: FlaggedAnomaly[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = (params.get('tool') as ToolTab) || 'ask';

  const setTab = useCallback(
    (id: ToolTab) => {
      const next = new URLSearchParams(params.toString());
      if (id === 'ask') next.delete('tool');
      else next.set('tool', id);
      router.push(`${pathname}${next.toString() ? `?${next.toString()}` : ''}`);
    },
    [params, pathname, router],
  );

  return (
    <div className="space-y-6">
      {/* URL-driven tool nav */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={active === t.id ? 'page' : undefined}
            className={cn(
              '-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors',
              active === t.id
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === 'ask' ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <AskPanel />
          <AnomalyRail anomalies={anomalies} />
        </div>
      ) : active === 'controls' ? (
        <SuggestControlsTool />
      ) : (
        <SuggestExpectationsTool />
      )}
    </div>
  );
}

function AnomalyRail({ anomalies }: { anomalies: FlaggedAnomaly[] }) {
  return (
    <Card className="h-fit shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Anomalies right now</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Points that deviate from the metric&apos;s own recent behaviour — not a fixed threshold.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {anomalies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No anomalies detected in the recent cost series. This updates as traffic accrues.
          </p>
        ) : (
          anomalies.map((a, i) => (
            <div key={`${a.metric}-${a.label}-${i}`} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium capitalize text-foreground">{a.metric}</span>
                <Badge
                  variant="secondary"
                  className={
                    a.severity === 'critical'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-amber-500/10 text-amber-600'
                  }
                >
                  {a.direction} · {a.severity}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {a.label}: {a.value} vs baseline {a.baseline} ({Math.abs(a.deviation)}σ)
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
