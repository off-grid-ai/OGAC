'use client';

import { PencilSimple, Play, Trash } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { evalEngineLabel } from '@/lib/eval-engine-label';

interface EvalDef {
  id: string;
  name: string;
  templateId: string;
  metric: string;
  engine: string;
  direction: 'higher-better' | 'lower-better';
  threshold: number;
  suite: string;
  description: string;
}

interface MetricScore {
  metric: string;
  value: number;
  threshold: number;
  direction: string;
  pass: boolean;
  engine: string;
}

interface RunResult {
  run: { id: string; score: number; total: number; passed: number };
  metrics: MetricScore[];
  computedBy: string;
}

// Full CRUD for saved eval definitions + RUN with per-metric results. The parent passes a `reloadKey`
// bump (incremented after a template is applied) to trigger a reload. URL-panel state is kept simple
// here (local edit/delete dialogs) since the catalog owns the primary add flow.
export function EvalDefsManager({ reloadKey }: Readonly<{ reloadKey: number }>) {
  const router = useRouter();
  const [defs, setDefs] = useState<EvalDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EvalDef | null>(null);
  const [editing, setEditing] = useState<EvalDef | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastRun, setLastRun] = useState<{ defId: string; result: RunResult } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/v1/admin/eval-defs');
    if (r.ok) setDefs((await r.json()).data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  async function run(def: EvalDef) {
    setRunning(def.id);
    setLastRun(null);
    const r = await fetch(`/api/v1/admin/eval-defs/${def.id}/run`, { method: 'POST' });
    setRunning(null);
    if (r.ok) {
      const result: RunResult = await r.json();
      setLastRun({ defId: def.id, result });
      toast.success(
        `${def.name}: ${result.run.passed}/${result.run.total} passed (${result.run.score}%, ${evalEngineLabel(result.computedBy)})`,
      );
      router.refresh();
    } else {
      const e = await r.json().catch(() => null);
      toast.error(e?.error ?? 'Eval run failed');
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    const r = await fetch(`/api/v1/admin/eval-defs/${editing.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: editing.name,
        metric: editing.metric,
        engine: editing.engine,
        direction: editing.direction,
        threshold: editing.threshold,
        suite: editing.suite,
        description: editing.description,
      }),
    });
    setSaving(false);
    if (r.ok) {
      toast.success('Eval updated');
      setEditing(null);
      void load();
    } else {
      const e = await r.json().catch(() => null);
      toast.error(e?.error ?? 'Could not save');
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const r = await fetch(`/api/v1/admin/eval-defs/${pendingDelete.id}`, { method: 'DELETE' });
    setPendingDelete(null);
    if (r.ok) {
      toast.success('Eval deleted');
      void load();
    } else {
      toast.error('Could not delete');
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Your evals ({defs.length})</CardTitle>
        <p className="text-xs text-muted-foreground">
          Saved evaluators. Run one to score the golden set against its metric and threshold.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : defs.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No evals yet. Apply a template above to create your first evaluator.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Metric</TableHead>
                <TableHead>Checker</TableHead>
                <TableHead>Pass at</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {defs.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/solutions/quality/evaluators/${encodeURIComponent(d.id)}`}
                      className="hover:text-primary hover:underline"
                    >
                      {d.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {d.metric}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {evalEngineLabel(d.engine)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {d.direction === 'higher-better' ? '≥' : '≤'} {Math.round(d.threshold * 100)}%
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={running !== null}
                        onClick={() => run(d)}
                      >
                        <Play className="mr-1 size-3" />
                        {running === d.id ? 'Running…' : 'Run'}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Edit eval"
                        onClick={() => setEditing({ ...d })}
                      >
                        <PencilSimple className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete eval"
                        onClick={() => setPendingDelete(d)}
                      >
                        <Trash className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Per-metric results of the most recent run in this session. */}
        {lastRun && (
          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                Last run · {lastRun.result.run.score}% · {evalEngineLabel(lastRun.result.computedBy)}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {lastRun.result.run.id}
              </span>
            </div>
            <Progress value={lastRun.result.run.score} className="h-1.5" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Metric</TableHead>
                  <TableHead className="text-xs">Score</TableHead>
                  <TableHead className="text-xs">Threshold</TableHead>
                  <TableHead className="text-xs">Checker</TableHead>
                  <TableHead className="text-xs">Verdict</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lastRun.result.metrics.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{m.metric}</TableCell>
                    <TableCell className="text-xs">{Math.round(m.value * 100)}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.direction === 'higher-better' ? '≥' : '≤'} {Math.round(m.threshold * 100)}%
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {evalEngineLabel(m.engine)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          m.pass
                            ? 'bg-primary/10 text-[10px] text-primary'
                            : 'bg-destructive/10 text-[10px] text-destructive'
                        }
                      >
                        {m.pass ? 'pass' : 'fail'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Edit — name, threshold, description. */}
      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit eval</SheetTitle>
            <SheetDescription>
              Adjust the pass threshold and label. Metric + checker come from the template.
            </SheetDescription>
          </SheetHeader>
          {editing && (
            <SheetBody>
              <div className="space-y-1.5">
                <Label htmlFor="ed-name">Name</Label>
                <Input
                  id="ed-name"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ed-threshold">
                  Pass threshold ({editing.direction === 'higher-better' ? '≥' : '≤'}{' '}
                  {Math.round(editing.threshold * 100)}%)
                </Label>
                <Input
                  id="ed-threshold"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={editing.threshold}
                  onChange={(e) =>
                    setEditing({ ...editing, threshold: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-1 rounded-md border border-border bg-muted/20 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Metric</span>
                  <span className="font-mono">{editing.metric}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Checker</span>
                  <span>{evalEngineLabel(editing.engine)}</span>
                </div>
              </div>
            </SheetBody>
          )}
          <SheetFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation. */}
      <Dialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete eval?</DialogTitle>
            <DialogDescription>
              “{pendingDelete?.name}” will be removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
