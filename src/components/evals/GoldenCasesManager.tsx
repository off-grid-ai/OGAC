'use client';

import { PencilSimple, Play, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { Textarea } from '@/components/ui/textarea';
import { evalEngineLabel } from '@/lib/eval-engine-label';

interface GoldenCase {
  id: string;
  name: string;
  query: string;
  expected: string;
  suite: string;
}

type Draft = { id?: string; name: string; query: string; expected: string; suite: string };

const EMPTY_DRAFT: Draft = { name: '', query: '', expected: '', suite: 'golden' };
const RUN_ENGINES = ['golden', 'promptfoo', 'ragas'] as const;

export function GoldenCasesManager() {
  const router = useRouter();
  const params = useSearchParams();
  const [cases, setCases] = useState<GoldenCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<GoldenCase | null>(null);
  const [running, setRunning] = useState(false);

  const panel = params.get('panel'); // 'new-goldencase' | 'edit-goldencase' | null
  const editId = params.get('id');

  // Which create/edit panel is open lives in the URL — Back closes it, links are shareable.
  const setPanel = useCallback(
    (next: { panel: string; id?: string } | null) => {
      const p = new URLSearchParams(params.toString());
      if (next) {
        p.set('panel', next.panel);
        if (next.id) p.set('id', next.id);
        else p.delete('id');
      } else {
        p.delete('panel');
        p.delete('id');
      }
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  const load = useCallback(async () => {
    const r = await fetch('/api/v1/admin/golden-cases');
    if (r.ok) setCases((await r.json()).data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Derive the form draft from the URL: seed a fresh draft for create, hydrate from the row for
  // edit, and clear when the panel closes — so open/close state is the URL, not local state.
  useEffect(() => {
    if (panel === 'new-goldencase') {
      setDraft((d) => (d && !d.id ? d : { ...EMPTY_DRAFT }));
    } else if (panel === 'edit-goldencase' && editId) {
      const c = cases.find((x) => x.id === editId);
      if (c) {
        setDraft((d) =>
          d && d.id === c.id
            ? d
            : { id: c.id, name: c.name, query: c.query, expected: c.expected, suite: c.suite },
        );
      }
    } else {
      setDraft(null);
    }
  }, [panel, editId, cases]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    const payload = {
      name: draft.name,
      query: draft.query,
      expected: draft.expected,
      suite: draft.suite,
    };
    const r = draft.id
      ? await fetch(`/api/v1/admin/golden-cases/${draft.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/v1/admin/golden-cases', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (r.ok) {
      toast.success(draft.id ? 'Case updated' : 'Case added');
      setPanel(null);
      void load();
    } else {
      const e = await r.json().catch(() => null);
      toast.error(e?.error ?? 'Could not save case');
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const r = await fetch(`/api/v1/admin/golden-cases/${pendingDelete.id}`, { method: 'DELETE' });
    setPendingDelete(null);
    if (r.ok) {
      toast.success('Case deleted');
      void load();
    } else {
      toast.error('Could not delete');
    }
  }

  async function runEvals(engine: string) {
    setRunning(true);
    const r = await fetch('/api/v1/admin/evals/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engine }),
    });
    setRunning(false);
    if (r.ok) {
      const run = await r.json();
      toast.success(
        `Ran ${evalEngineLabel(run.engine)}: ${run.passed}/${run.total} passed (${run.score}%)`,
      );
      router.refresh(); // re-render the server rollup + recent-runs table with the new run
    } else {
      const e = await r.json().catch(() => null);
      toast.error(e?.error ?? 'Eval run failed');
    }
  }

  // Save-button label: mid-save, editing an existing case, or adding a new one.
  let saveButtonLabel: string;
  if (saving) saveButtonLabel = 'Saving…';
  else saveButtonLabel = draft?.id ? 'Save changes' : 'Add case';

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-sm">Golden cases ({cases.length})</CardTitle>
        <div className="flex items-center gap-2">
          {RUN_ENGINES.map((eng) => (
            <Button
              key={eng}
              size="sm"
              variant={eng === 'golden' ? 'default' : 'outline'}
              disabled={running || cases.length === 0}
              onClick={() => runEvals(eng)}
            >
              <Play className="mr-1.5 size-3.5" />
              Run {evalEngineLabel(eng)}
            </Button>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPanel({ panel: 'new-goldencase' })}
          >
            <Plus className="mr-1.5 size-3.5" />
            Add case
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Loading…</p>
        ) : cases.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No golden cases yet. Add one to build the evaluation set.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Query</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Suite</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="max-w-[24ch] truncate text-muted-foreground">
                    {c.query}
                  </TableCell>
                  <TableCell className="max-w-[20ch] truncate text-muted-foreground">
                    {c.expected}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {c.suite}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Edit case"
                        onClick={() => setPanel({ panel: 'edit-goldencase', id: c.id })}
                      >
                        <PencilSimple className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete case"
                        onClick={() => setPendingDelete(c)}
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
      </CardContent>

      {/* Create / edit form — open/close state lives in the URL (?panel=…). */}
      <Sheet open={draft !== null} onOpenChange={(o) => !o && setPanel(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{draft?.id ? 'Edit golden case' : 'Add golden case'}</SheetTitle>
            <SheetDescription>
              A query and the expected source/answer it should surface. Scored offline against the
              gateway.
            </SheetDescription>
          </SheetHeader>
          {draft && (
            <SheetBody>
              <div className="space-y-1.5">
                <Label htmlFor="gc-name">Name</Label>
                <Input
                  id="gc-name"
                  value={draft.name}
                  placeholder="Defaults to the query"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gc-query">Query / input</Label>
                <Textarea
                  id="gc-query"
                  value={draft.query}
                  onChange={(e) => setDraft({ ...draft, query: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gc-expected">Expected</Label>
                <Textarea
                  id="gc-expected"
                  value={draft.expected}
                  onChange={(e) => setDraft({ ...draft, expected: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gc-suite">Suite</Label>
                <Input
                  id="gc-suite"
                  value={draft.suite}
                  placeholder="golden"
                  onChange={(e) => setDraft({ ...draft, suite: e.target.value })}
                />
              </div>
            </SheetBody>
          )}
          <SheetFooter>
            <Button variant="ghost" onClick={() => setPanel(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saveButtonLabel}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation. */}
      <Dialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete golden case?</DialogTitle>
            <DialogDescription>
              “{pendingDelete?.name}” will be removed from the evaluation set. This cannot be undone.
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
