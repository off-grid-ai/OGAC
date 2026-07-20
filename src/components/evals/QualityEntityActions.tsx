'use client';

import { ArrowClockwise, PencilSimple, Trash } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';

interface EvalDefinition {
  id: string;
  name: string;
  metric: string;
  engine: string;
  direction: 'higher-better' | 'lower-better';
  threshold: number;
  suite: string;
  description: string;
}

interface GoldenCase {
  id: string;
  name: string;
  query: string;
  expected: string;
  suite: string;
}

function useEditPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'edit';
  return {
    router,
    open,
    show: () => router.push(`${pathname}?panel=edit`, { scroll: false }),
    hide: () => router.back(),
  };
}

export function EvalDefinitionActions({ definition }: Readonly<{ definition: EvalDefinition }>) {
  const panel = useEditPanel();
  const [draft, setDraft] = useState(definition);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (panel.open) setDraft(definition);
  }, [definition, panel.open]);

  async function save() {
    setSaving(true);
    const response = await fetch(`/api/v1/admin/eval-defs/${definition.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setSaving(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      toast.error(body?.error ?? 'Could not save evaluator');
      return;
    }
    toast.success('Evaluator updated');
    panel.hide();
    panel.router.refresh();
  }

  async function run() {
    setRunning(true);
    const response = await fetch(`/api/v1/admin/eval-defs/${definition.id}/run`, { method: 'POST' });
    setRunning(false);
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.run?.id) {
      toast.error(body?.error ?? 'Evaluator run failed');
      return;
    }
    toast.success('Evaluator run recorded');
    panel.router.push(`/solutions/quality/runs/${encodeURIComponent(body.run.id)}`);
  }

  async function remove() {
    const response = await fetch(`/api/v1/admin/eval-defs/${definition.id}`, { method: 'DELETE' });
    if (!response.ok) {
      toast.error('Could not delete evaluator');
      return;
    }
    toast.success('Evaluator deleted');
    panel.router.push('/solutions/quality/evaluators');
    panel.router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={panel.show}>
        <PencilSimple className="size-4" />
        Edit
      </Button>
      <Button onClick={() => void run()} disabled={running}>
        <ArrowClockwise className="size-4" />
        {running ? 'Running...' : 'Run evaluator'}
      </Button>
      <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
        <Trash className="size-4" />
        Delete
      </Button>

      <Sheet open={panel.open} onOpenChange={(open) => !open && panel.hide()}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit evaluator</SheetTitle>
            <SheetDescription>
              Change the evaluator label, threshold, suite, and description. The metric and checker
              remain fixed.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-1.5">
              <Label htmlFor="quality-eval-name">Name</Label>
              <Input
                id="quality-eval-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quality-eval-threshold">Threshold (0 to 1)</Label>
              <Input
                id="quality-eval-threshold"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={draft.threshold}
                onChange={(event) =>
                  setDraft({ ...draft, threshold: Number(event.target.value) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quality-eval-suite">Golden suite</Label>
              <Input
                id="quality-eval-suite"
                value={draft.suite}
                onChange={(event) => setDraft({ ...draft, suite: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quality-eval-description">Description</Label>
              <Textarea
                id="quality-eval-description"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button variant="ghost" onClick={panel.hide} disabled={saving}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete evaluator?</DialogTitle>
            <DialogDescription>
              {definition.name} will no longer run or gate a pipeline. Recorded executions remain.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void remove()}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function GoldenCaseActions({ goldenCase }: Readonly<{ goldenCase: GoldenCase }>) {
  const panel = useEditPanel();
  const [draft, setDraft] = useState(goldenCase);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (panel.open) setDraft(goldenCase);
  }, [goldenCase, panel.open]);

  async function save() {
    setSaving(true);
    const response = await fetch(`/api/v1/admin/golden-cases/${goldenCase.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setSaving(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      toast.error(body?.error ?? 'Could not save golden case');
      return;
    }
    toast.success('Golden case updated');
    panel.hide();
    panel.router.refresh();
  }

  async function remove() {
    const response = await fetch(`/api/v1/admin/golden-cases/${goldenCase.id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      toast.error('Could not delete golden case');
      return;
    }
    toast.success('Golden case deleted');
    panel.router.push('/solutions/quality/golden-cases');
    panel.router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={panel.show}>
        <PencilSimple className="size-4" />
        Edit case
      </Button>
      <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
        <Trash className="size-4" />
        Delete
      </Button>

      <Sheet open={panel.open} onOpenChange={(open) => !open && panel.hide()}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit golden case</SheetTitle>
            <SheetDescription>
              Keep the input and expected result specific enough to diagnose a failed execution.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-1.5">
              <Label htmlFor="quality-case-name">Name</Label>
              <Input id="quality-case-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quality-case-query">Input</Label>
              <Textarea id="quality-case-query" value={draft.query} onChange={(event) => setDraft({ ...draft, query: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quality-case-expected">Expected result</Label>
              <Textarea id="quality-case-expected" value={draft.expected} onChange={(event) => setDraft({ ...draft, expected: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quality-case-suite">Suite</Label>
              <Input id="quality-case-suite" value={draft.suite} onChange={(event) => setDraft({ ...draft, suite: event.target.value })} />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button variant="ghost" onClick={panel.hide} disabled={saving}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete golden case?</DialogTitle>
            <DialogDescription>
              {goldenCase.name} will be removed from future executions. Recorded results remain.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void remove()}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

