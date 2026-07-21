'use client';

import { ArrowCounterClockwise, GitDiff, NotePencil, X } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { contractRows, diffSnapshots, type DiffKind } from '@/lib/pipeline-version';
import { panelHref, withPanelParams } from '@/lib/url-panel';

const SELECT = 'h-9 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm';

export interface PipelineVersionData {
  id: string;
  version: number;
  note: string;
  label: string;
  createdAt: string | null;
  createdBy: string;
  snapshot: Record<string, unknown>;
}

export interface PipelineVersionsManagerData {
  pipelineId: string;
  pipelineName: string;
  currentVersion: number;
  isAdmin: boolean;
  versions: PipelineVersionData[];
}

function fmt(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

const DIFF_TONE: Record<DiffKind, string> = {
  added: 'text-primary',
  removed: 'text-destructive',
  changed: 'text-amber-600 dark:text-amber-400',
  unchanged: 'text-muted-foreground',
};

// PipelineVersionsManager — the full version-management surface: browse the immutable history, open
// any version's FULL frozen governance contract, DIFF two versions, ANNOTATE a version with a label,
// and roll a prior version back to active. Every navigational position (selected version `v`, compare
// target `cmp`, open dialog `panel`) lives in the URL so Back is coherent + views are deep-linkable.
export function PipelineVersionsManager({ data }: Readonly<{ data: PipelineVersionsManagerData }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);

  const versions = data.versions;
  const newest = versions[0]?.version ?? data.currentVersion;
  const selectedV = Number(params.get('v')) || newest;
  const cmpV = Number(params.get('cmp')) || 0;
  const panel = params.get('panel');

  const selected = useMemo(
    () => versions.find((v) => v.version === selectedV) ?? versions[0] ?? null,
    [versions, selectedV],
  );
  const compareWith = useMemo(
    () => (cmpV ? versions.find((v) => v.version === cmpV) ?? null : null),
    [versions, cmpV],
  );

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const qs = withPanelParams(params.toString(), updates);
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  // Diff is computed PURELY in the client (no I/O). from = older, to = newer, so the diff reads
  // forward in time regardless of which side the operator picked.
  const diff = useMemo(() => {
    if (!selected || !compareWith) return null;
    const older = selected.version <= compareWith.version ? selected : compareWith;
    const newer = selected.version <= compareWith.version ? compareWith : selected;
    return { older, newer, ...diffSnapshots(older.snapshot, newer.snapshot) };
  }, [selected, compareWith]);

  async function submitAnnotate(label: string) {
    if (!selected || busy) return;
    setBusy(true);
    const res = await fetch(
      `/api/v1/admin/pipelines/${data.pipelineId}/versions/${selected.version}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label }),
      },
    );
    setBusy(false);
    if (res.ok) {
      toast.success(`v${selected.version} ${label ? 'labelled' : 'label cleared'}`);
      setParams({ panel: null });
      router.refresh();
    } else {
      const b = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(b?.error ?? 'Failed to save label');
    }
  }

  async function submitRollback(detail: string) {
    if (!selected || busy) return;
    setBusy(true);
    const res = await fetch(`/api/v1/admin/pipelines/${data.pipelineId}/rollback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toVersion: selected.version, detail }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Rolled back to v${selected.version} — now live`);
      setParams({ panel: null, v: null, cmp: null });
      router.refresh();
    } else {
      const b = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(b?.error ?? 'Rollback failed');
    }
  }

  const canRollback = data.isAdmin && selected != null && selected.version < data.currentVersion;

  return (
    <div className="w-full space-y-4">
      <div>
        <h2 className="text-base font-medium text-foreground">Version history</h2>
        <p className="text-sm text-muted-foreground">
          Immutable snapshots — every publish, edit, and rollback froze the full governance contract.
          Current version: <span className="font-medium text-foreground">v{data.currentVersion}</span>.
          Select a version to inspect its contract, compare two versions, or roll a prior version back
          to active.
        </p>
      </div>

      {versions.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No versions recorded yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
          {/* ── version list ── */}
          <div className="space-y-2">
            {versions.map((v) => {
              const isSelected = selected?.version === v.version;
              const isCurrent = v.version === data.currentVersion;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setParams({ v: String(v.version), cmp: null })}
                  className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/40 hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Badge variant="outline">v{v.version}</Badge>
                      {isCurrent ? (
                        <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px]">
                          live
                        </Badge>
                      ) : null}
                      <span className="text-xs capitalize text-muted-foreground">{v.note}</span>
                    </span>
                    <span className="text-[10px] text-muted-foreground">{fmt(v.createdAt)}</span>
                  </div>
                  {v.label ? (
                    <div className="mt-1 truncate text-xs font-medium text-primary" title={v.label}>
                      {v.label}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* ── detail / diff panel ── */}
          {selected ? (
            <Card className="shadow-sm">
              {diff ? (
                <>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <GitDiff className="size-4" />
                      Diff · v{diff.older.version} → v{diff.newer.version}
                      <Badge variant="outline" className="text-[10px]">
                        {diff.changedCount} change{diff.changedCount === 1 ? '' : 's'}
                      </Badge>
                    </CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => setParams({ cmp: null })}>
                      <X className="size-4" /> Exit compare
                    </Button>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-1 pr-3 font-medium">Field</th>
                          <th className="py-1 pr-3 font-medium">v{diff.older.version}</th>
                          <th className="py-1 pr-3 font-medium">v{diff.newer.version}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diff.changes.map((c) => (
                          <tr
                            key={c.field}
                            className={`border-t border-border/50 ${c.kind !== 'unchanged' ? 'bg-muted/30' : ''}`}
                          >
                            <td className="py-1.5 pr-3 align-top text-foreground">{c.label}</td>
                            <td className="py-1.5 pr-3 align-top text-muted-foreground">{c.from}</td>
                            <td className={`py-1.5 pr-3 align-top ${DIFF_TONE[c.kind]}`}>
                              {c.to}
                              {c.kind !== 'unchanged' ? (
                                <span className="ml-1 text-[10px] uppercase opacity-70">{c.kind}</span>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </>
              ) : (
                <>
                  <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Badge variant="outline">v{selected.version}</Badge>
                        <span className="capitalize text-muted-foreground">{selected.note}</span>
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {fmt(selected.createdAt)}
                        {selected.createdBy ? ` · ${selected.createdBy}` : ''}
                      </p>
                      {selected.label ? (
                        <p className="mt-1 text-xs font-medium text-primary">{selected.label}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {versions.length > 1 ? (
                        <select
                          aria-label="Compare with version"
                          className={SELECT}
                          value=""
                          onChange={(e) => e.target.value && setParams({ cmp: e.target.value })}
                        >
                          <option value="">Compare with…</option>
                          {versions
                            .filter((v) => v.version !== selected.version)
                            .map((v) => (
                              <option key={v.id} value={v.version}>
                                v{v.version}
                              </option>
                            ))}
                        </select>
                      ) : null}
                      {data.isAdmin ? (
                        <Button size="sm" variant="outline" onClick={() => setParams({ panel: 'annotate' })}>
                          <NotePencil className="size-4" /> Annotate
                        </Button>
                      ) : null}
                      {canRollback ? (
                        <Button size="sm" onClick={() => setParams({ panel: 'rollback' })}>
                          <ArrowCounterClockwise className="size-4" /> Roll back to this
                        </Button>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <tbody>
                        {contractRows(selected.snapshot).map((r) => (
                          <tr key={r.field} className="border-t border-border/50">
                            <td className="w-40 py-1.5 pr-3 align-top uppercase tracking-wide text-muted-foreground">
                              {r.label}
                            </td>
                            <td className="py-1.5 align-top text-foreground">{r.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </>
              )}
            </Card>
          ) : null}
        </div>
      )}

      {selected ? (
        <>
          <AnnotateDialog
            open={panel === 'annotate'}
            version={selected.version}
            initial={selected.label}
            busy={busy}
            onClose={() => setParams({ panel: null })}
            onSubmit={submitAnnotate}
          />
          <RollbackDialog
            open={panel === 'rollback'}
            version={selected.version}
            currentVersion={data.currentVersion}
            pipelineName={data.pipelineName}
            busy={busy}
            onClose={() => setParams({ panel: null })}
            onSubmit={submitRollback}
          />
        </>
      ) : null}
    </div>
  );
}

function AnnotateDialog({
  open,
  version,
  initial,
  busy,
  onClose,
  onSubmit,
}: Readonly<{
  open: boolean;
  version: number;
  initial: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (label: string) => void;
}>) {
  const [label, setLabel] = useState(initial);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Annotate v{version}</DialogTitle>
          <DialogDescription>
            Label this frozen version for the team — e.g. &ldquo;RBI-cleared&rdquo; or &ldquo;pre-monsoon
            baseline&rdquo;. Clear the field to remove the label.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="version-label">Label</Label>
          <Input
            id="version-label"
            maxLength={80}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="RBI-cleared baseline"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(label.trim())} disabled={busy}>
            Save label
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RollbackDialog({
  open,
  version,
  currentVersion,
  pipelineName,
  busy,
  onClose,
  onSubmit,
}: Readonly<{
  open: boolean;
  version: number;
  currentVersion: number;
  pipelineName: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (detail: string) => void;
}>) {
  const [detail, setDetail] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roll back to v{version}?</DialogTitle>
          <DialogDescription>
            This restores the full governance contract frozen at v{version} onto
            &ldquo;{pipelineName}&rdquo; and publishes it as the new live version (the current v
            {currentVersion} stays in history). The rollback is recorded with your reason and audited.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rollback-reason">Reason (recorded in history)</Label>
          <Textarea
            id="rollback-reason"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Why are you rolling back? e.g. v12 loosened the PII masking overlay."
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(detail.trim())} disabled={busy}>
            <ArrowCounterClockwise className="size-4" /> Roll back &amp; publish v{version}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
