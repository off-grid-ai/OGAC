'use client';

import { CheckCircle, WarningCircle, Play } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { expectNotNull, type CheckpointVerdict } from '@/lib/data-quality-model';
import { suiteNameForTable } from '@/lib/dataplane-ui';

// "Run data-quality check" panel on the table detail page. The operator picks which columns to
// assert non-null (a sensible, always-supported default suite), then we POST the SAMPLE rows +
// expectations to /api/v1/admin/data-quality/run and render the verdict. Real action against the
// live quality engine — the sample is what's already on-screen, so the check is honest.
export function TableQualityCheck({
  table,
  columns,
  sampleRows,
}: {
  table: string;
  columns: string[];
  sampleRows: Record<string, unknown>[];
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(columns));
  const [verdict, setVerdict] = useState<CheckpointVerdict | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [running, setRunning] = useState(false);

  function toggle(col: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  }

  async function run() {
    if (selected.size === 0) {
      toast.error('Pick at least one column to check');
      return;
    }
    if (sampleRows.length === 0) {
      toast.error('No sample rows to validate — the table returned no data');
      return;
    }
    setRunning(true);
    setVerdict(null);
    try {
      const expectations = [...selected].map((c) => expectNotNull(c));
      const res = await fetch('/api/v1/admin/data-quality/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ suite: suiteNameForTable(table), rows: sampleRows, expectations }),
      });
      const body = (await res.json().catch(() => ({}))) as CheckpointVerdict & { summary?: string; error?: string };
      if (!res.ok) {
        toast.error(body.error || 'Data-quality check failed');
        return;
      }
      setVerdict(body);
      setSummary(body.summary ?? '');
      if (!body.engineReachable) toast.error('Data-quality engine is unreachable');
      else toast[body.success ? 'success' : 'error'](body.summary ?? 'Check complete');
    } catch {
      toast.error('Data-quality check failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Data-quality check</CardTitle>
        <Button size="sm" onClick={run} disabled={running}>
          <Play className="size-4" />
          {running ? 'Running…' : 'Run check'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Validate the sampled rows below. Pick the columns that must never be empty — the check runs
          against this sample and reports a pass/fail verdict.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {columns.map((c) => {
            const on = selected.has(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                  on
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
                aria-pressed={on}
              >
                {c} not null
              </button>
            );
          })}
        </div>

        {verdict ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              {verdict.success && verdict.engineReachable ? (
                <CheckCircle className="size-4 text-primary" weight="fill" />
              ) : (
                <WarningCircle className="size-4 text-destructive" weight="fill" />
              )}
              <span className="text-sm font-medium text-foreground">{summary || 'Check complete'}</span>
            </div>
            {verdict.results.filter((r) => !r.success).length > 0 ? (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {verdict.results
                  .filter((r) => !r.success)
                  .map((r, i) => (
                    <li key={`${r.expectation}-${i}`} className="flex items-center gap-2">
                      <Badge className="bg-destructive/10 text-destructive">{r.expectation}</Badge>
                      <span>{r.detail}</span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                All {verdict.total} expectation{verdict.total === 1 ? '' : 's'} passed on the sample.
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
