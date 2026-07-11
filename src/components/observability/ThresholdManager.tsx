'use client';

import { ArrowCounterClockwise, Bell, Plus } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Rule {
  id: string;
  metric: string;
  op: string;
  value: number;
  severity: string;
}
interface Baseline {
  resetAt: string;
  resetBy: string;
  note: string;
}

const METRICS = ['drift_score', 'eval_pass_rate'] as const;
const OPS = ['gt', 'gte', 'lt', 'lte'] as const;
const OP_TEXT: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };

function AddRuleForm({ onDone }: Readonly<{ onDone: () => void }>) {
  const [metric, setMetric] = useState<(typeof METRICS)[number]>('drift_score');
  const [op, setOp] = useState<(typeof OPS)[number]>('gt');
  const [value, setValue] = useState('');
  const [severity, setSeverity] = useState<'warning' | 'critical'>('warning');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      toast.error('Value must be between 0 and 1.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/observability/thresholds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metric, op, value: v, severity }),
      });
      if (res.status === 403) return void toast.error('Admins only.');
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        return void toast.error(d.error ?? 'Failed to add rule.');
      }
      toast.success('Alert rule added.');
      setValue('');
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto_auto_auto_auto]">
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Metric</Label>
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value as (typeof METRICS)[number])}
          className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs"
        >
          {METRICS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Op</Label>
        <select
          value={op}
          onChange={(e) => setOp(e.target.value as (typeof OPS)[number])}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-xs"
        >
          {OPS.map((o) => (
            <option key={o} value={o}>
              {OP_TEXT[o]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Value</Label>
        <Input
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0.3"
          className="w-24 font-mono text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Severity</Label>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as 'warning' | 'critical')}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-xs"
        >
          <option value="warning">warning</option>
          <option value="critical">critical</option>
        </select>
      </div>
      <Button onClick={submit} disabled={busy} className="gap-1.5">
        <Plus className="size-4" />
        Add rule
      </Button>
    </div>
  );
}

// Alert threshold rules + drift baseline reset — the console-owned settings operators tune here.
// Polls the rules list; the reset marker shows when the drift baseline was last reset and by whom.
// Nav-free (a settings panel, not a place), but Add/Delete drive real POST/DELETE routes.
export function ThresholdManager() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [note, setNote] = useState('');
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [rt, bt] = await Promise.all([
        fetch('/api/v1/admin/observability/thresholds', { cache: 'no-store' }),
        fetch('/api/v1/admin/observability/baseline', { cache: 'no-store' }),
      ]);
      const rd = (await rt.json()) as { data?: Rule[] };
      const bd = (await bt.json()) as { baseline?: Baseline | null };
      setRules(rd.data ?? []);
      setBaseline(bd.baseline ?? null);
    } catch {
      /* keep last snapshot */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    await fetch(`/api/v1/admin/observability/thresholds/${id}`, { method: 'DELETE' });
    load();
  }

  async function resetBaseline() {
    setResetting(true);
    try {
      const res = await fetch('/api/v1/admin/observability/baseline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: note.trim() }),
      });
      if (res.status === 403) return void toast.error('Admins only.');
      if (!res.ok) return void toast.error('Reset failed.');
      toast.success('Drift baseline reset.');
      setNote('');
      load();
    } finally {
      setResetting(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Bell className="size-4 text-primary" />
          Alert thresholds &amp; baseline
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Fire alerts when a drift score or eval pass-rate crosses a bound. Reset the drift baseline
          after a deliberate model/prompt change so the next window measures against fresh reference.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <AddRuleForm onDone={load} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length ? (
              rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs text-foreground">{r.metric}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {OP_TEXT[r.op] ?? r.op} {r.value}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        r.severity === 'critical'
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-amber-500/10 text-amber-600'
                      }
                    >
                      {r.severity}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      className="text-xs text-muted-foreground hover:text-red-500"
                      title="Delete rule"
                    >
                      ✕
                    </button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                  No alert rules yet. Add one above.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Reset drift baseline
            </Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="reason (e.g. switched to claude-opus)"
              className="text-xs"
            />
            {baseline ? (
              <p className="text-[10px] text-muted-foreground">
                Last reset {baseline.resetAt.slice(0, 16).replace('T', ' ')}
                {baseline.resetBy ? ` by ${baseline.resetBy}` : ''}
                {baseline.note ? ` — ${baseline.note}` : ''}
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground">Baseline never reset.</p>
            )}
          </div>
          <Button onClick={resetBaseline} disabled={resetting} variant="outline" className="gap-1.5">
            <ArrowCounterClockwise className={resetting ? 'size-4 animate-spin' : 'size-4'} />
            Reset baseline
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
