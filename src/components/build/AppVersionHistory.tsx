'use client';

import { ArrowCounterClockwise, CaretDown, CaretRight, ClockCounterClockwise } from '@phosphor-icons/react/dist/ssr';
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
import { explainResponse } from '@/lib/api-failure';
import type { AppChange } from '@/lib/app-version-diff';
import { relativeTime } from '@/lib/workspace-grid';

interface VersionRow {
  id: string;
  version: number;
  note: string;
  createdAt: string;
  createdBy: string;
  isFirst: boolean;
  changes: AppChange[];
}

// ─── App version history — compare, and roll back ──────────────────────────────────────────────────
//
// ROADMAP §10 Flow 7: an operator investigating a failed run "compares with previous versions" and then
// "rolls out or rolls back". Pipelines had both; apps had neither, and an app run is what an operator is
// usually investigating.
//
// What makes this usable rather than a list of numbers: each row states WHAT CHANGED in the operator's
// language ("Instructions rewritten on Draft Notice (412 → 690 characters)"), computed by the pure
// diff. And a rollback APPENDS a new version rather than rewinding history — nothing is un-happened,
// which is the only honest way to record a reversal in a system of record.
export function AppVersionHistory({ appId }: Readonly<{ appId: string }>) {
  const router = useRouter();
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [current, setCurrent] = useState(0);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<VersionRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/admin/apps/${appId}/versions`);
    if (!res.ok) {
      // A failed read must never render as "no versions" — that reads as "this app has no history".
      setError((await explainResponse(res, 'read this app’s history')).message);
      setRows([]);
      return;
    }
    const body = await res.json();
    setRows(body.data ?? []);
    setCurrent(body.currentVersion ?? 0);
    setError(null);
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function rollback(row: VersionRow) {
    setBusy(true);
    const res = await fetch(`/api/v1/admin/apps/${appId}/versions/${row.version}`, {
      method: 'POST',
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Rolled back to v${row.version}`, {
        description: 'A new version was recorded — the history still shows every state.',
      });
      setConfirm(null);
      await load();
      router.refresh();
      return;
    }
    const failure = await explainResponse(res, `roll back to v${row.version}`);
    (failure.refusal ? toast.info : toast.error)(failure.message);
  }

  function toggle(version: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  }

  return (
    <>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClockCounterClockwise className="size-4" /> Version history
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Every saved change to this app, what it changed, and a way back to any of them. A rollback
            is recorded as a new version — nothing is erased.
          </p>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              {error}
            </p>
          ) : rows === null ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No versions recorded yet. The next save will start this app&apos;s history.
            </p>
          ) : (
            <ol className="space-y-2">
              {rows.map((row) => {
                const isCurrent = row.version === current;
                const expanded = open.has(row.version);
                return (
                  <li
                    key={row.id}
                    className={
                      isCurrent
                        ? 'rounded-md border border-primary/40 bg-primary/5 p-3'
                        : 'rounded-md border border-border p-3'
                    }
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggle(row.version)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        aria-expanded={expanded}
                      >
                        {row.changes.length ? (
                          expanded ? (
                            <CaretDown className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <CaretRight className="size-3.5 shrink-0 text-muted-foreground" />
                          )
                        ) : (
                          <span className="w-3.5 shrink-0" />
                        )}
                        <span className="shrink-0 font-mono text-xs font-semibold">v{row.version}</span>
                        <span className="min-w-0 flex-1 truncate text-xs">{row.note}</span>
                      </button>
                      {isCurrent ? (
                        <Badge variant="secondary" className="bg-primary/10 text-primary">
                          current
                        </Badge>
                      ) : (
                        <Button
                          size="xs"
                          variant="outline"
                          className="gap-1"
                          onClick={() => setConfirm(row)}
                        >
                          <ArrowCounterClockwise className="size-3" /> Roll back
                        </Button>
                      )}
                    </div>
                    <div className="mt-1 pl-6 text-[11px] text-muted-foreground">
                      {relativeTime(row.createdAt)}
                      {row.createdBy ? ` · ${row.createdBy}` : ''}
                      {row.changes.length
                        ? ` · ${row.changes.length} change${row.changes.length === 1 ? '' : 's'}`
                        : ''}
                    </div>
                    {expanded && row.changes.length ? (
                      <ul className="mt-2 space-y-1 pl-6">
                        {row.changes.map((c) => (
                          <li
                            key={`${c.kind}-${c.stepId ?? ''}-${c.summary}`}
                            className="flex items-start gap-2 text-xs"
                          >
                            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/60" />
                            <span>{c.summary}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roll back to v{confirm?.version}?</DialogTitle>
            <DialogDescription>
              This restores the steps, instructions, bindings and trigger as they were at v
              {confirm?.version}. It takes effect on the app&apos;s NEXT run — runs already in flight are
              untouched. A new version is recorded, so you can roll forward again.
            </DialogDescription>
          </DialogHeader>
          {confirm?.changes.length ? (
            <div className="rounded-md border border-border p-3">
              <p className="mb-1.5 text-xs font-medium">That version&apos;s own changes were:</p>
              <ul className="space-y-1">
                {confirm.changes.map((c) => (
                  <li key={c.summary} className="text-xs text-muted-foreground">
                    · {c.summary}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => confirm && rollback(confirm)} disabled={busy}>
              {busy ? 'Rolling back…' : `Roll back to v${confirm?.version}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
