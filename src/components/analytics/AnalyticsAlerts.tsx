'use client';

import { BellRinging, Pencil, Plus, Pulse } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

const METRICS = ['p50', 'p95', 'totalEvents', 'totalTokens', 'egressRate', 'blockedRate'] as const;
const COMPARATORS = ['gt', 'gte', 'lt', 'lte'] as const;
const CMP_LABEL: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };
const RANGES = ['1d', '7d', '30d', '90d'] as const;

interface Rule {
  id: string;
  name: string;
  metric: string;
  comparator: string;
  threshold: number;
  windowMinutes: number;
  enabled: boolean;
  value?: number;
  firing?: boolean;
}
interface SavedView {
  id: string;
  name: string;
  range: string;
  model: string;
  outcome: string;
}

const blankRule = (): Rule => ({
  id: '',
  name: '',
  metric: 'p95',
  comparator: 'gt',
  threshold: 2000,
  windowMinutes: 15,
  enabled: true,
});

// ─── Rule editor dialog ─────────────────────────────────────────────────────────────────────────
function RuleDialog({
  rule,
  open,
  onClose,
  onSaved,
}: {
  rule: Rule | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Rule>(blankRule());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setDraft(rule ? { ...rule } : blankRule());
  }, [open, rule]);

  async function submit() {
    setBusy(true);
    try {
      const editing = Boolean(draft.id);
      const res = await fetch(
        editing ? `/api/v1/admin/analytics/rules/${draft.id}` : '/api/v1/admin/analytics/rules',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: draft.name,
            metric: draft.metric,
            comparator: draft.comparator,
            threshold: Number(draft.threshold),
            windowMinutes: Number(draft.windowMinutes),
            enabled: draft.enabled,
          }),
        },
      );
      if (res.status === 403) return void toast.error('Admins only.');
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        return void toast.error(d.error ?? 'Failed to save rule.');
      }
      toast.success(editing ? 'Rule updated.' : 'Rule created.');
      onClose();
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{draft.id ? 'Edit alert rule' : 'New alert rule'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Name</Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="p95 latency high"
              className="text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Metric
              </Label>
              <select
                value={draft.metric}
                onChange={(e) => setDraft({ ...draft, metric: e.target.value })}
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
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Comparator
              </Label>
              <select
                value={draft.comparator}
                onChange={(e) => setDraft({ ...draft, comparator: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs"
              >
                {COMPARATORS.map((c) => (
                  <option key={c} value={c}>
                    {CMP_LABEL[c]} ({c})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Threshold
              </Label>
              <Input
                type="number"
                value={draft.threshold}
                onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Window (min)
              </Label>
              <Input
                type="number"
                value={draft.windowMinutes}
                onChange={(e) => setDraft({ ...draft, windowMinutes: Number(e.target.value) })}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {draft.id ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Saved-view create dialog ─────────────────────────────────────────────────────────────────────
function ViewDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [range, setRange] = useState<string>('7d');
  const [model, setModel] = useState('');
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName('');
      setRange('7d');
      setModel('');
      setOutcome('');
    }
  }, [open]);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/analytics/views', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, range, model, outcome }),
      });
      if (res.status === 403) return void toast.error('Admins only.');
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        return void toast.error(d.error ?? 'Failed to save view.');
      }
      toast.success('View saved.');
      onClose();
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New saved view</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="text-xs" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Range</Label>
              <select
                value={range}
                onChange={(e) => setRange(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs"
              >
                {RANGES.map((rg) => (
                  <option key={rg} value={rg}>
                    {rg}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Model</Label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="all"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Outcome</Label>
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs"
              >
                <option value="">all</option>
                <option value="ok">ok</option>
                <option value="redacted">redacted</option>
                <option value="blocked">blocked</option>
              </select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Analytics management layer — alert rules (create/edit/delete + live firing state via "evaluate
// now") and saved views (named presets). The active saved view lives in the URL (?view=<id>), so
// selecting one is a real navigation (Back-coherent, deep-linkable), not local state.
export function AnalyticsAlerts() {
  const router = useRouter();
  const params = useSearchParams();
  const activeView = params.get('view') ?? '';

  const [rules, setRules] = useState<Rule[]>([]);
  const [views, setViews] = useState<SavedView[]>([]);
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; rule: Rule | null }>({
    open: false,
    rule: null,
  });
  const [viewDialog, setViewDialog] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ev, vw] = await Promise.all([
        fetch('/api/v1/admin/analytics/evaluate', { cache: 'no-store' }),
        fetch('/api/v1/admin/analytics/views', { cache: 'no-store' }),
      ]);
      const evd = (await ev.json().catch(() => ({}))) as { data?: Rule[] };
      const vwd = (await vw.json().catch(() => ({}))) as { data?: SavedView[] };
      setRules(evd.data ?? []);
      setViews(vwd.data ?? []);
    } catch {
      /* keep last snapshot */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load]);

  function selectView(id: string) {
    const p = new URLSearchParams(Array.from(params.entries()));
    if (id) p.set('view', id);
    else p.delete('view');
    router.push(`?${p.toString()}`);
  }

  async function removeRule(id: string) {
    if (!confirm('Delete this alert rule?')) return;
    await fetch(`/api/v1/admin/analytics/rules/${id}`, { method: 'DELETE' });
    load();
  }
  async function removeView(id: string) {
    if (!confirm('Delete this saved view?')) return;
    await fetch(`/api/v1/admin/analytics/views/${id}`, { method: 'DELETE' });
    if (activeView === id) selectView('');
    load();
  }

  const firingCount = rules.filter((r) => r.firing).length;

  return (
    <>
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <BellRinging className="size-4 text-primary" />
            Alert rules · {rules.length}
            {firingCount > 0 ? (
              <Badge variant="destructive" className="ml-1">
                {firingCount} firing
              </Badge>
            ) : null}
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-primary">
              <Pulse className="size-3.5 animate-pulse" />
              evaluated live
            </span>
            <Button size="sm" onClick={() => load()} variant="outline">
              Evaluate now
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setRuleDialog({ open: true, rule: null })}
            >
              <Plus className="size-4" />
              Add rule
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.length ? (
                rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-foreground">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.metric} {CMP_LABEL[r.comparator] ?? r.comparator} {r.threshold} · {r.windowMinutes}
                      m
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-foreground">
                      {r.value ?? '—'}
                    </TableCell>
                    <TableCell>
                      {!r.enabled ? (
                        <Badge variant="outline">disabled</Badge>
                      ) : r.firing ? (
                        <Badge variant="destructive">firing</Badge>
                      ) : (
                        <Badge variant="secondary">ok</Badge>
                      )}
                    </TableCell>
                    <TableCell className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setRuleDialog({ open: true, rule: r })}
                        className="text-muted-foreground hover:text-primary"
                        title="Edit rule"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRule(r.id)}
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
                  <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                    No alert rules yet. Add one to watch a metric (e.g. p95 latency &gt; 2000ms over
                    15m).
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm">Saved views · {views.length}</CardTitle>
          <Button size="sm" className="gap-1.5" onClick={() => setViewDialog(true)}>
            <Plus className="size-4" />
            Save view
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => selectView('')}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                activeView ? 'border-input text-muted-foreground' : 'border-primary text-primary'
              }`}
            >
              All traffic
            </button>
            {views.map((v) => (
              <span key={v.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => selectView(v.id)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    activeView === v.id
                      ? 'border-primary text-primary'
                      : 'border-input text-muted-foreground'
                  }`}
                  title={`range ${v.range}, model ${v.model || 'all'}, outcome ${v.outcome || 'all'}`}
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  onClick={() => removeView(v.id)}
                  className="text-xs text-muted-foreground hover:text-red-500"
                  title="Delete view"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Saved views are named filter / time-range presets. The active view lives in the URL
            (?view=…), so it&apos;s deep-linkable and the Back button steps between views.
          </p>
        </CardContent>
      </Card>

      <RuleDialog
        open={ruleDialog.open}
        rule={ruleDialog.rule}
        onClose={() => setRuleDialog({ open: false, rule: null })}
        onSaved={load}
      />
      <ViewDialog open={viewDialog} onClose={() => setViewDialog(false)} onSaved={load} />
    </>
  );
}
