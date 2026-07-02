'use client';

import { Gauge, Plus, Pulse } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Budget {
  id: string;
  subject: string;
  period: string;
  allocatedTokens: number;
  tokens: number;
  usd: number;
  requests: number;
  remaining: number;
  pctUsed: number;
  projectedMonthly: number;
}

const PERIODS = ['monthly', 'weekly', 'daily'] as const;
const num = (n: number) => n.toLocaleString();
const usd = (n: number) => `$${n.toFixed(2)}`;

// Colour the usage bar: emerald under 80%, amber 80–100%, red over budget.
function barColor(pct: number): string {
  if (pct > 100) return 'text-red-500';
  if (pct > 80) return 'text-amber-500';
  return 'text-primary';
}

function IssueBudgetForm({ onDone }: { onDone: () => void }) {
  const [subject, setSubject] = useState('');
  const [allocated, setAllocated] = useState('');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('monthly');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const allocatedTokens = Number(allocated);
    if (!subject.trim() || !Number.isFinite(allocatedTokens) || allocatedTokens <= 0) {
      toast.error('Enter a subject and a token allocation.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/finops/budgets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), allocatedTokens, period }),
      });
      if (res.status === 403) {
        toast.error('Admins only.');
        return;
      }
      if (!res.ok) {
        toast.error('Failed to set budget.');
        return;
      }
      toast.success('Budget saved.');
      setSubject('');
      setAllocated('');
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Subject (user id or org:name)
        </Label>
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="ada@acme.co or org:acme"
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Allocated tokens
        </Label>
        <Input
          type="number"
          value={allocated}
          onChange={(e) => setAllocated(e.target.value)}
          placeholder="1000000"
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Period</Label>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as (typeof PERIODS)[number])}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-xs"
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <Button onClick={submit} disabled={busy} className="gap-1.5">
        <Plus className="size-4" />
        Issue / adjust
      </Button>
    </div>
  );
}

// Token budgets — issue + monitor per-user / per-org token allocations. Polls
// /api/v1/finops/budgets (15s), which meters live usage from the gateway's OpenSearch history.
// Usage bar goes amber over 80% and red over budget; projected monthly cost extrapolates the
// window's spend. The issue form POSTs (admin-gated server-side).
export function TokenBudgets() {
  const [rows, setRows] = useState<Budget[]>([]);

  const load = async () => {
    try {
      const r = await fetch('/api/v1/finops/budgets', { cache: 'no-store' });
      const d = (await r.json()) as { data?: Budget[] };
      setRows(d.data ?? []);
    } catch {
      /* keep last snapshot */
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  async function remove(id: string) {
    await fetch(`/api/v1/finops/budgets/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Gauge className="size-4 text-primary" />
          Token budgets · {rows.length}
        </CardTitle>
        <span className="flex items-center gap-1.5 text-xs text-primary">
          <Pulse className="size-3.5 animate-pulse" />
          live
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <IssueBudgetForm onDone={load} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead className="text-right">Allocated</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead className="w-44">Usage</TableHead>
              <TableHead className="text-right">Proj. monthly</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs text-foreground">{b.subject}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {num(b.allocatedTokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {num(b.tokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {num(b.remaining)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={Math.min(b.pctUsed, 100)} className="flex-1" />
                      <span className={`text-xs font-medium ${barColor(b.pctUsed)}`}>
                        {b.pctUsed}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-primary">
                    {usd(b.projectedMonthly)}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => remove(b.id)}
                      className="text-xs text-muted-foreground hover:text-red-500"
                      title="Delete budget"
                    >
                      ✕
                    </button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                  No budgets issued yet. Use the form above to cap a user or org.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <p className="text-[10px] text-muted-foreground">
          Usage is metered live from the gateway&apos;s call history (attributed per user via the{' '}
          <code className="font-mono">x-offgrid-user</code> header). Projected monthly cost
          extrapolates the current window&apos;s spend.
        </p>
      </CardContent>
    </Card>
  );
}
