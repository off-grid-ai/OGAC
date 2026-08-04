'use client';

import { Plus, TrendUp, TrendDown, Minus, Trash, ChartLine } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// Shapes mirror evidently-projects-store's DriftProjectListItem (kept local for a lean bundle).
export interface ProjectCardData {
  id: string;
  name: string;
  description: string;
  dataset: string;
  driftThreshold: number;
  signal: {
    reportCount: number;
    latest: { status: 'drift' | 'warning' | 'stable'; driftPct: number | null; startedAt: string } | null;
    direction: 'up' | 'down' | 'flat';
    breaches: number;
    peakPct: number;
  };
}

const STATUS_CLASS: Record<'drift' | 'warning' | 'stable', string> = {
  stable: 'bg-primary/10 text-primary',
  warning: 'bg-muted text-foreground',
  drift: 'bg-destructive/10 text-destructive',
};

function DirectionBadge({ d }: Readonly<{ d: 'up' | 'down' | 'flat' }>) {
  if (d === 'up') {
    return (
      <span className="inline-flex items-center gap-1 text-destructive">
        <TrendUp className="size-3.5" /> rising
      </span>
    );
  }
  if (d === 'down') {
    return (
      <span className="inline-flex items-center gap-1 text-primary">
        <TrendDown className="size-3.5" /> easing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Minus className="size-3.5" /> flat
    </span>
  );
}

function ProjectCard({
  p,
  onDelete,
}: Readonly<{ p: ProjectCardData; onDelete: (p: ProjectCardData) => void }>) {
  return (
    <Card className="flex flex-col shadow-sm transition-colors hover:border-primary/40">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="min-w-0">
          {/* truncate has to sit on the TEXT, not on a box whose child is a flex row: an overflowing
              flex child is hard-clipped with no ellipsis, which cut "Loan underwriting drift" off
              mid-word and gave the reader no sign that a word was missing. */}
          <CardTitle className="text-sm">
            <Link
              href={`/solutions/quality/drift-monitoring/${p.id}`}
              className="flex min-w-0 items-center gap-2 hover:text-primary"
              title={p.name}
            >
              <ChartLine className="size-4 shrink-0 text-primary" />
              {/* Wrap, don't truncate. A project's NAME is the one thing the card exists to tell you,
                  and at a quarter of the grid's width "Loan underwriti…" tells you nothing. Two lines
                  cost a few pixels of card height; a cut-off name costs the reader the card. */}
              <span className="line-clamp-2 break-words">{p.name}</span>
            </Link>
          </CardTitle>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {p.dataset || 'no dataset label'}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {Math.round(p.driftThreshold * 100)}% line
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-xs text-muted-foreground">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg text-foreground">{p.signal.reportCount}</div>
            <div className="text-[10px] uppercase tracking-wide">reports</div>
          </div>
          <div>
            <div className="text-lg text-foreground">{p.signal.breaches}</div>
            <div className="text-[10px] uppercase tracking-wide">breaches</div>
          </div>
          <div>
            <div className="text-lg text-foreground">{p.signal.peakPct}%</div>
            <div className="text-[10px] uppercase tracking-wide">peak</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {p.signal.latest ? (
            <Badge variant="secondary" className={STATUS_CLASS[p.signal.latest.status]}>
              latest: {p.signal.latest.status}
              {p.signal.latest.driftPct === null ? '' : ` ${p.signal.latest.driftPct}%`}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              no runs yet
            </Badge>
          )}
          <DirectionBadge d={p.signal.direction} />
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/solutions/quality/drift-monitoring/${p.id}`}>Open</Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(p)}
            aria-label={`Delete ${p.name}`}
          >
            <Trash className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NewProjectSheet({
  open,
  onOpenChange,
  onSaved,
}: Readonly<{ open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }>) {
  const [name, setName] = useState('');
  const [dataset, setDataset] = useState('');
  const [description, setDescription] = useState('');
  const [threshold, setThreshold] = useState('25');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await fetch('/api/v1/admin/quality/drift-projects', {
      method: 'POST',
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
      toast.success('Monitoring project created');
      setName('');
      setDataset('');
      setDescription('');
      setThreshold('25');
      onOpenChange(false);
      onSaved();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to create project');
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New monitoring project"
      description="Group your drift reports under a named project and set the breach line that flags drift over time."
      footer={
        <Button onClick={save} disabled={busy} className="w-full">
          Create project
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="dp-name">Project name</Label>
          <Input
            id="dp-name"
            placeholder="Fraud scoring drift"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dp-dataset">Dataset / pipeline (optional)</Label>
          <Input
            id="dp-dataset"
            placeholder="transactions"
            value={dataset}
            onChange={(e) => setDataset(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dp-threshold">Breach threshold (% drift share)</Label>
          <Input
            id="dp-threshold"
            type="number"
            min={0}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            A reporting bucket whose mean drift share reaches this is flagged as a breach. 25% matches
            the default drift verdict.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dp-desc">Description (optional)</Label>
          <Textarea
            id="dp-desc"
            placeholder="What this project watches and why."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </FormSheet>
  );
}

// Full-width projects surface: a grid of project cards (each links to its detail) + a URL-driven New
// sheet. Delete is confirm-gated; create/edit go through the admin routes.
export function DriftMonitoringProjects({ projects }: Readonly<{ projects: ProjectCardData[] }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-project';

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  const onDelete = useCallback(
    async (p: ProjectCardData) => {
      if (!confirm(`Delete the "${p.name}" monitoring project? Its report history stays; only the project is removed.`)) {
        return;
      }
      const res = await fetch(`/api/v1/admin/quality/drift-projects/${p.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`"${p.name}" deleted`);
        router.refresh();
      } else {
        toast.error('Failed to delete project');
      }
    },
    [router],
  );

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start justify-between gap-4">
        {/* No <h1> here. The console layout already titles this page "Drift monitoring" with its own
            description, so this component was printing the same heading a second line below the first.
            What it keeps is the part the short layout description does not say: what a project IS. */}
        <p className="max-w-3xl text-sm text-muted-foreground">
          A project groups the drift reports for one dataset or pipeline, keeps them in time order, and
          charts drift share against your breach line — so a slide shows up as a trend rather than as
          one alarming one-off check.
        </p>
        <Button size="sm" onClick={() => setPanel('new-project')}>
          <Plus className="size-4" />
          New project
        </Button>
      </div>

      {projects.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No monitoring projects yet. Create one to start tracking drift over time.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} onDelete={onDelete} />
          ))}
        </div>
      )}

      <NewProjectSheet
        open={open}
        onOpenChange={(o) => !o && setPanel(null)}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
