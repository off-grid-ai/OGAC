'use client';

import { Plus, Prohibit, Stack, Tag } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Marquez delete capability, mirrored from lineage-writer.ts MARQUEZ_CAPABILITIES — surfaced
// honestly to the operator rather than faked. (Client can't import server env-gated modules cleanly,
// so the reason string is duplicated here as UI copy.)
const DELETE_BLOCKED_REASON =
  'Marquez has no delete endpoint — its lineage graph is an append-only audit trail. ' +
  'Stale edges age out of the read window; they cannot be removed via the API.';

interface Props {
  namespaces: string[];
  datasets: string[];
  jobs: string[];
  activeNamespace: string | null;
}

// Curation controls for the Marquez lineage graph: create a namespace, declare + apply tags to
// datasets/jobs. The "tag a dataset" modal is a navigational place driven by `?curate=<dataset>`
// so Back closes it and the URL is shareable. Delete is shown but disabled with its reason.
export function LineageCurate({ namespaces, datasets, jobs, activeNamespace }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const curateDataset = params.get('curate');

  const openCurate = useCallback(
    (dataset: string) => {
      const next = new URLSearchParams(params.toString());
      next.set('curate', dataset);
      router.push(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );
  const closeCurate = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete('curate');
    router.push(next.toString() ? `?${next.toString()}` : '?', { scroll: false });
  }, [params, router]);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Stack className="size-4 text-primary" />
          Curate lineage
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Create namespaces and tag datasets/jobs in Marquez. Namespace + tag writes are real
          (Marquez REST). Entity deletion is unavailable — the graph is append-only.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <CreateNamespaceForm onDone={() => router.refresh()} />
        <DeclareTagForm onDone={() => router.refresh()} />

        {/* Datasets — click to tag; delete disabled + explained. */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Datasets ({datasets.length})
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {datasets.length ? (
              datasets.map((d) => (
                <span key={d} className="inline-flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={() => openCurate(d)}
                  >
                    <Tag className="size-3" />
                    {d}
                  </Button>
                  <button
                    type="button"
                    disabled
                    title={DELETE_BLOCKED_REASON}
                    className="cursor-not-allowed text-muted-foreground/40"
                  >
                    <Prohibit className="size-3.5" />
                  </button>
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No datasets in this namespace.</span>
            )}
          </div>
        </div>

        <TagJobForm jobs={jobs} namespace={activeNamespace} onDone={() => router.refresh()} />

        {namespaces.length ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Namespaces
            </span>
            {namespaces.map((n) => (
              <Badge
                key={n}
                variant={n === activeNamespace ? 'secondary' : 'outline'}
                className="text-[10px]"
              >
                {n}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>

      <TagDatasetDialog
        open={Boolean(curateDataset)}
        dataset={curateDataset}
        namespace={activeNamespace}
        onClose={closeCurate}
        onDone={() => {
          closeCurate();
          router.refresh();
        }}
      />
    </Card>
  );
}

function CreateNamespaceForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) {
      toast.error('Namespace name required.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/lineage/namespaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), ownerName: owner.trim() || undefined }),
      });
      if (res.status === 403) return void toast.error('Admins only.');
      if (!res.ok) return void toast.error('Failed to create namespace.');
      toast.success('Namespace created.');
      setName('');
      setOwner('');
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          New namespace
        </Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="offgrid-console"
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Owner (optional)
        </Label>
        <Input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="platform-team"
          className="font-mono text-xs"
        />
      </div>
      <Button onClick={submit} disabled={busy} className="gap-1.5">
        <Plus className="size-4" />
        Create
      </Button>
    </div>
  );
}

function DeclareTagForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) {
      toast.error('Tag name required.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/lineage/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'declare', name: name.trim(), description: desc.trim() }),
      });
      if (res.status === 403) return void toast.error('Admins only.');
      if (!res.ok) return void toast.error('Failed to declare tag.');
      toast.success('Tag declared.');
      setName('');
      setDesc('');
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Declare tag
        </Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="pii"
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Description (optional)
        </Label>
        <Input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="contains personal data"
          className="text-xs"
        />
      </div>
      <Button onClick={submit} disabled={busy} variant="outline" className="gap-1.5">
        <Tag className="size-4" />
        Declare
      </Button>
    </div>
  );
}

function TagJobForm({
  jobs,
  namespace,
  onDone,
}: {
  jobs: string[];
  namespace: string | null;
  onDone: () => void;
}) {
  const [job, setJob] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!namespace || !job || !tag.trim()) {
      toast.error('Pick a job and enter a tag.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/lineage/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'tag-job', namespace, job, tag: tag.trim() }),
      });
      if (res.status === 403) return void toast.error('Admins only.');
      if (!res.ok) return void toast.error('Failed to tag job.');
      toast.success('Job tagged.');
      setTag('');
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Tag a job
        </Label>
        <select
          value={job}
          onChange={(e) => setJob(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs"
        >
          <option value="">Select job…</option>
          {jobs.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Tag</Label>
        <Input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="pii"
          className="font-mono text-xs"
        />
      </div>
      <Button onClick={submit} disabled={busy} variant="outline" className="gap-1.5">
        <Tag className="size-4" />
        Apply
      </Button>
    </div>
  );
}

function TagDatasetDialog({
  open,
  dataset,
  namespace,
  onClose,
  onDone,
}: {
  open: boolean;
  dataset: string | null;
  namespace: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);

  async function apply(action: 'tag-dataset' | 'untag-dataset') {
    if (!namespace || !dataset || !tag.trim()) {
      toast.error('Enter a tag.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/lineage/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, namespace, dataset, tag: tag.trim() }),
      });
      if (res.status === 403) return void toast.error('Admins only.');
      if (!res.ok) return void toast.error('Failed.');
      toast.success(action === 'tag-dataset' ? 'Dataset tagged.' : 'Tag removed.');
      setTag('');
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Tag dataset · {dataset}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Tag name
            </Label>
            <Input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="pii"
              className="font-mono text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => apply('tag-dataset')} disabled={busy} className="flex-1 gap-1.5">
              <Tag className="size-4" />
              Apply tag
            </Button>
            <Button
              onClick={() => apply('untag-dataset')}
              disabled={busy}
              variant="outline"
              className="flex-1"
            >
              Remove tag
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
