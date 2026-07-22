'use client';

import { Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DecisionAggregate, DecisionQuery, OpaDecisionEvent } from '@/lib/opa-audit';

// The decision-log ledger management surface. A LIST of governed decisions with a filter band and an
// aggregate summary; clicking a row opens its full record (input + result + reason + labels) as a
// URL-driven detail panel (?open=<decisionId> — Back-coherent, deep-linkable). Delete purges one
// decision from the ledger (governed retention/erasure) with a confirm step. Filters live in the URL
// (?decision / ?path) so the view is shareable and the server re-queries on change.

const DECISION_TABS: ReadonlyArray<{ key: 'all' | 'allow' | 'deny'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'allow', label: 'Allow' },
  { key: 'deny', label: 'Deny' },
];

export function PolicyAuditDecisionLog({
  decisions,
  aggregate,
  query,
}: Readonly<{
  decisions: OpaDecisionEvent[];
  aggregate: DecisionAggregate;
  query: DecisionQuery;
}>) {
  const router = useRouter();
  const params = useSearchParams();
  const open = params.get('open');

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const current = useMemo(
    () => (open ? decisions.find((d) => d.decisionId === open) : undefined),
    [open, decisions],
  );

  return (
    <div className="w-full space-y-4">
      {/* aggregate band — full-width multi-column */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Decisions" value={aggregate.total} />
        <Stat label="Allowed" value={aggregate.allow} tone="allow" />
        <Stat label="Denied" value={aggregate.deny} tone="deny" />
        <Stat label="Engines" value={Object.keys(aggregate.byEngine).length || 0} />
      </div>

      {/* filter band */}
      <div className="flex flex-wrap items-center gap-2">
        {DECISION_TABS.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={query.decision === t.key ? 'default' : 'outline'}
            onClick={() => setParam('decision', t.key === 'all' ? null : t.key)}
          >
            {t.label}
          </Button>
        ))}
        <input
          type="text"
          defaultValue={query.path}
          placeholder="filter by path…"
          className="ml-auto h-9 rounded-md border bg-background px-3 font-mono text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') setParam('path', (e.target as HTMLInputElement).value || null);
          }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Governed decisions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {decisions.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No decisions recorded yet. Point the policy engine&rsquo;s decision-log stream at{' '}
                <code className="font-mono">/api/v1/admin/policy/decision-logs/ingest</code> to
                capture every governed allow/deny here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Decision</TableHead>
                      <TableHead>Path</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Engine</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {decisions.map((d) => (
                      <TableRow key={d.decisionId} data-state={open === d.decisionId ? 'selected' : undefined}>
                        <TableCell>
                          <button
                            type="button"
                            className="text-left"
                            onClick={() => setParam('open', d.decisionId)}
                          >
                            <Badge variant={d.allow ? 'default' : 'destructive'}>{d.allow ? 'allow' : 'deny'}</Badge>
                          </button>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{d.path}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{d.actor || '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{d.engine}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{d.timestamp || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {current ? (
          <DecisionDetail decision={current} onClose={() => setParam('open', null)} onDeleted={() => {
            setParam('open', null);
            router.refresh();
          }} />
        ) : (
          <Card className="hidden lg:block">
            <CardHeader>
              <CardTitle className="text-sm">Decision detail</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Select a decision to see its full input, result, and matched policy.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: Readonly<{ label: string; value: number; tone?: 'allow' | 'deny' }>) {
  const color =
    tone === 'allow' ? 'text-emerald-500' : tone === 'deny' ? 'text-destructive' : 'text-foreground';
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-2xl ${color}`}>{value}</div>
    </div>
  );
}

function DecisionDetail({
  decision,
  onClose,
  onDeleted,
}: Readonly<{ decision: OpaDecisionEvent; onClose: () => void; onDeleted: () => void }>) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/admin/policy/decision-logs/${encodeURIComponent(decision.decisionId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
      toast.success('Decision purged from the ledger');
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Decision detail</CardTitle>
        <div className="flex items-center gap-2">
          {confirm ? (
            <>
              <Button size="sm" variant="destructive" disabled={busy} onClick={remove}>
                {busy ? 'Purging…' : 'Confirm purge'}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
                <Trash className="size-4" /> Purge
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Close
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Field label="Decision">
          <Badge variant={decision.allow ? 'default' : 'destructive'}>
            {decision.allow ? 'allow' : 'deny'}
          </Badge>
        </Field>
        <Field label="Decision id" mono>
          {decision.decisionId}
        </Field>
        <Field label="Path" mono>
          {decision.path}
        </Field>
        <Field label="Engine">{decision.engine}</Field>
        {decision.actor ? (
          <Field label="Actor" mono>
            {decision.actor}
          </Field>
        ) : null}
        {decision.timestamp ? <Field label="Decided at" mono>{decision.timestamp}</Field> : null}
        {decision.reason ? <Field label="Reason">{decision.reason}</Field> : null}
        <JsonField label="Input" value={decision.input} />
        <JsonField label="Result" value={decision.result} />
        {Object.keys(decision.labels).length ? (
          <JsonField label="OPA labels" value={decision.labels} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  mono,
  children,
}: Readonly<{ label: string; mono?: boolean; children: React.ReactNode }>) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={mono ? 'break-all font-mono text-xs' : ''}>{children}</span>
    </div>
  );
}

function JsonField({ label, value }: Readonly<{ label: string; value: unknown }>) {
  return (
    <div className="space-y-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
        {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
