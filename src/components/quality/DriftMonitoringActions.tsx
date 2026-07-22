'use client';

import { PencilSimple, Trash } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface EditableProject {
  id: string;
  name: string;
  description: string;
  dataset: string;
  driftThreshold: number;
}

function EditProjectSheet({
  project,
  open,
  onOpenChange,
  onSaved,
}: Readonly<{
  project: EditableProject;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}>) {
  const [name, setName] = useState(project.name);
  const [dataset, setDataset] = useState(project.dataset);
  const [description, setDescription] = useState(project.description);
  const [threshold, setThreshold] = useState(String(Math.round(project.driftThreshold * 100)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/v1/admin/quality/drift-projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        dataset: dataset.trim(),
        description: description.trim(),
        driftThreshold: Number(threshold) / 100,
      }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Project updated');
      onOpenChange(false);
      onSaved();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to update project');
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit monitoring project"
      description="Update the project's name, dataset label, description, or breach threshold."
      footer={
        <Button onClick={save} disabled={busy} className="w-full">
          Save changes
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ep-name">Project name</Label>
          <Input id="ep-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ep-dataset">Dataset / pipeline</Label>
          <Input id="ep-dataset" value={dataset} onChange={(e) => setDataset(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ep-threshold">Breach threshold (% drift share)</Label>
          <Input
            id="ep-threshold"
            type="number"
            min={0}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ep-desc">Description</Label>
          <Textarea
            id="ep-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </FormSheet>
  );
}

// Detail-page actions: edit (sheet), delete (confirm → back to list), and a URL-driven day/hour
// granularity toggle for the trend chart (the server page re-reads `?granularity`).
export function DriftMonitoringActions({ project }: Readonly<{ project: EditableProject }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [editing, setEditing] = useState(false);
  const granularity = params.get('granularity') === 'hour' ? 'hour' : 'day';

  const setGranularity = useCallback(
    (g: 'day' | 'hour') => {
      const next = new URLSearchParams(params.toString());
      next.set('granularity', g);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const onDelete = useCallback(async () => {
    if (!confirm(`Delete the "${project.name}" monitoring project?`)) return;
    const res = await fetch(`/api/v1/admin/quality/drift-projects/${project.id}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      toast.success(`"${project.name}" deleted`);
      router.push('/solutions/quality/drift-monitoring');
    } else {
      toast.error('Failed to delete project');
    }
  }, [project.id, project.name, router]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="mr-2 inline-flex overflow-hidden rounded-md border">
        <button
          type="button"
          onClick={() => setGranularity('day')}
          className={`px-2.5 py-1 text-xs ${granularity === 'day' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Daily
        </button>
        <button
          type="button"
          onClick={() => setGranularity('hour')}
          className={`px-2.5 py-1 text-xs ${granularity === 'hour' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Hourly
        </button>
      </div>
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        <PencilSimple className="size-4" /> Edit
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={onDelete}
      >
        <Trash className="size-4" /> Delete
      </Button>
      <EditProjectSheet
        project={project}
        open={editing}
        onOpenChange={setEditing}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
