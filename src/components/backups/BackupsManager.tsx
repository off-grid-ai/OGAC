'use client';

import {
  Archive,
  ArrowCounterClockwise,
  CloudArrowUp,
  Clock,
  Copy,
  Database,
  Play,
  Trash,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
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
import { formatAge, formatBytes } from '@/lib/backups-view';

interface BackupRow {
  name: string;
  timestampMs: number | null;
  ageMs: number | null;
  sizeBytes: number;
  offBox: boolean;
  withinRetention: boolean;
}

interface ScheduleStatus {
  label: string;
  scheduled: boolean;
  detail: string;
  controllable: boolean;
}

interface BackupsPayload {
  error: string | null;
  running: boolean;
  schedule: ScheduleStatus;
  config: {
    retentionDays: number;
    backupRoot: string;
    offBoxTarget: string | null;
    staleAfterHours: number;
  };
  count: number;
  countWithinRetention: number;
  totalSizeBytes: number;
  latest: BackupRow | null;
  latestAgeMs: number | null;
  stale: boolean;
  offBoxEnabled: boolean;
  offBoxReplicatedCount: number;
  rows: BackupRow[];
}

interface RunResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  outputTail: string;
  error?: string;
}

interface RestorePlanItem {
  file: string;
  sizeBytes: number;
  target: string;
  command: string | null;
}

interface RestoreInspection {
  ok: boolean;
  name: string;
  plan: RestorePlanItem[];
  error?: string;
}

// A "confirm" dialog is a navigational place → drive it from the URL (?confirm=delete:<name> |
// confirm=prune) so Back closes it and it's deep-linkable, per the console's nav standard.
function useConfirm() {
  const router = useRouter();
  const params = useSearchParams();
  const value = params.get('confirm');
  const open = useCallback(
    (v: string) => {
      const next = new URLSearchParams(params.toString());
      next.set('confirm', v);
      router.push(`?${next.toString()}`);
    },
    [params, router],
  );
  const close = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete('confirm');
    const qs = next.toString();
    router.push(qs ? `?${qs}` : '?');
  }, [params, router]);
  return { value, open, close };
}

// The restore inspector is a navigational place → drive it from ?restore=<name> so Back closes it
// and it's deep-linkable, same as the confirm dialogs.
function useRestoreParam() {
  const router = useRouter();
  const params = useSearchParams();
  const name = params.get('restore');
  const open = useCallback(
    (v: string) => {
      const next = new URLSearchParams(params.toString());
      next.set('restore', v);
      router.push(`?${next.toString()}`);
    },
    [params, router],
  );
  const close = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete('restore');
    const qs = next.toString();
    router.push(qs ? `?${qs}` : '?');
  }, [params, router]);
  return { name, open, close };
}

export function BackupsManager({ initial }: { initial: BackupsPayload }) {
  const [data, setData] = useState<BackupsPayload>(initial);
  const [busy, setBusy] = useState<null | 'run' | 'prune' | 'delete'>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restore, setRestore] = useState<RestoreInspection | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const confirm = useConfirm();
  const restoreParam = useRestoreParam();

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/admin/backups');
      if (r.ok) setData((await r.json()) as BackupsPayload);
    } catch {
      /* keep last-known */
    }
  }, []);

  // Reflect server-side "running" into the button on mount / when a confirm closes.
  useEffect(() => {
    void reload();
  }, [reload]);

  // Fetch the (non-destructive) restore plan whenever ?restore=<name> is set.
  useEffect(() => {
    const name = restoreParam.name;
    if (!name) {
      setRestore(null);
      return;
    }
    let cancelled = false;
    setRestoreLoading(true);
    setRestore(null);
    (async () => {
      try {
        const r = await fetch(`/api/v1/admin/backups/${encodeURIComponent(name)}/restore`);
        const body = (await r.json()) as RestoreInspection;
        if (!cancelled) setRestore(body);
      } catch (e) {
        if (!cancelled) setRestore({ ok: false, name, plan: [], error: (e as Error).message });
      } finally {
        if (!cancelled) setRestoreLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restoreParam.name]);

  const runBackup = async () => {
    setBusy('run');
    setActionError(null);
    setRunResult(null);
    try {
      const r = await fetch('/api/v1/admin/backups', { method: 'POST' });
      const body = (await r.json()) as Partial<RunResult> & { error?: string };
      if (r.status === 409) {
        setActionError('A backup is already running.');
      } else if (typeof body.exitCode === 'undefined' && body.error) {
        // Route-level failure (spawn error), no run captured.
        setActionError(body.error);
      } else {
        setRunResult(body as RunResult);
      }
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
      void reload();
    }
  };

  const deleteBackup = async (name: string) => {
    setBusy('delete');
    setActionError(null);
    try {
      const r = await fetch(`/api/v1/admin/backups/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        const b = (await r.json()) as { error?: string };
        setActionError(b.error ?? 'Delete failed.');
      }
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
      confirm.close();
      void reload();
    }
  };

  const prune = async () => {
    setBusy('prune');
    setActionError(null);
    try {
      const r = await fetch('/api/v1/admin/backups/prune', { method: 'POST' });
      const b = (await r.json()) as { deleted: string[]; failed: unknown[] };
      if (b.failed?.length) setActionError(`Pruned ${b.deleted.length}, ${b.failed.length} failed.`);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
      confirm.close();
      void reload();
    }
  };

  const { config, latest, schedule } = data;
  const prunableCount = data.rows.filter((r) => r.timestampMs !== null && !r.withinRetention).length;

  const confirmDeleteName = confirm.value?.startsWith('delete:')
    ? confirm.value.slice('delete:'.length)
    : null;
  const confirmPrune = confirm.value === 'prune';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Archive className="size-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Backups &amp; DR</h1>
            <p className="text-sm text-muted-foreground">
              Manage the on-prem backup job — run a backup now, prune aged dumps, and check the
              nightly schedule. Backups live on S1 ({config.backupRoot}).
            </p>
          </div>
        </div>
        <Button onClick={runBackup} disabled={busy !== null || data.running} className="gap-2">
          <Play className="size-4" weight="fill" />
          {busy === 'run' || data.running ? 'Running…' : 'Run backup now'}
        </Button>
      </div>

      {actionError ? (
        <Card className="border-destructive/40 bg-destructive/5 shadow-sm">
          <CardContent className="py-3 text-xs text-destructive">{actionError}</CardContent>
        </Card>
      ) : null}

      {runResult ? (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              Last run{' '}
              <Badge
                variant="secondary"
                className={
                  runResult.ok ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
                }
              >
                {runResult.ok ? 'ok' : `exit ${runResult.exitCode ?? runResult.signal ?? 'error'}`}
              </Badge>
              <span className="text-[10px] font-normal text-muted-foreground">
                {Math.round(runResult.durationMs / 1000)}s
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {runResult.error ? (
              <p className="mb-2 text-xs text-destructive">{runResult.error}</p>
            ) : null}
            <pre className="max-h-48 overflow-auto rounded bg-muted/40 p-3 text-[11px] text-muted-foreground whitespace-pre-wrap">
              {runResult.outputTail || '(no output captured)'}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      {data.error ? (
        <Card className="shadow-sm">
          <CardContent className="py-8 text-center text-xs text-destructive">
            Backup directory unreadable: {data.error}
          </CardContent>
        </Card>
      ) : null}

      {data.stale ? (
        <Card className="border-destructive/40 bg-destructive/5 shadow-sm">
          <CardContent className="flex items-center gap-3 py-4">
            <Warning className="size-5 shrink-0 text-destructive" />
            <div className="text-sm text-foreground">
              <span className="font-semibold text-destructive">Backup overdue.</span>{' '}
              {latest
                ? `Most recent backup is ${formatAge(data.latestAgeMs)} — older than the ${config.staleAfterHours}h threshold.`
                : `No backups found in ${config.backupRoot}.`}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Summary tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          icon={<Clock className="size-4" />}
          label="Latest backup"
          value={latest ? formatAge(data.latestAgeMs) : '—'}
          sub={latest?.name ?? 'none'}
        />
        <SummaryTile
          icon={<Database className="size-4" />}
          label="Total size"
          value={formatBytes(data.totalSizeBytes)}
          sub={`${data.count} dump${data.count === 1 ? '' : 's'}`}
        />
        <SummaryTile
          icon={<Archive className="size-4" />}
          label="Within retention"
          value={`${data.countWithinRetention}`}
          sub={`${config.retentionDays}-day window`}
        />
        <SummaryTile
          icon={<CloudArrowUp className="size-4" />}
          label="Off-box replication"
          value={data.offBoxEnabled ? 'Enabled' : 'Disabled'}
          sub={data.offBoxEnabled ? (config.offBoxTarget ?? '') : 'no peer configured'}
        />
      </div>

      {/* Schedule status */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <Badge
              variant="secondary"
              className={
                schedule.scheduled
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground'
              }
            >
              {schedule.scheduled ? 'scheduled' : 'not scheduled'}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">{schedule.label}</span>
          </div>
          <p className="text-xs text-muted-foreground">{schedule.detail}</p>
          {!schedule.controllable ? (
            <p className="text-[10px] text-muted-foreground/70">
              Enable/disable is not controllable from the console (launchd needs host context) —
              status only. Manage the plist on S1.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Backups table */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">Backups</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                {data.count} total
              </Badge>
              <Button
                variant="outline"
                size="xs"
                disabled={busy !== null || prunableCount === 0}
                onClick={() => confirm.open('prune')}
                className="gap-1"
              >
                <Trash className="size-3" />
                Prune {prunableCount > 0 ? `(${prunableCount})` : ''}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {data.rows.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">
              No backups found. The nightly job writes timestamped dumps to {config.backupRoot}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-4 font-medium">Backup</th>
                    <th className="py-2 pr-4 font-medium">Age</th>
                    <th className="py-2 pr-4 font-medium">Size</th>
                    <th className="py-2 pr-4 font-medium">Retention</th>
                    <th className="py-2 pr-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.name} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-4 font-mono text-foreground">{r.name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{formatAge(r.ageMs)}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{formatBytes(r.sizeBytes)}</td>
                      <td className="py-2 pr-4">
                        {r.withinRetention ? (
                          <Badge variant="secondary" className="bg-primary/10 text-primary">
                            kept
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            aged out
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={busy !== null}
                            onClick={() => restoreParam.open(r.name)}
                            className="gap-1"
                          >
                            <ArrowCounterClockwise className="size-3" />
                            Restore
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={busy !== null}
                            onClick={() => confirm.open(`delete:${r.name}`)}
                            className="gap-1 text-destructive hover:text-destructive"
                          >
                            <Trash className="size-3" />
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Restore inspector — NON-destructive: shows the dump files + the exact command to run on
          S1 during a maintenance window. The console does NOT run a destructive restore from a
          button (it overwrites a live DB). Driven by ?restore=<name> (URL, not a modal). */}
      {restoreParam.name ? (
        <Card className="border-amber-500/40 bg-amber-500/5 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ArrowCounterClockwise className="size-4" />
                Restore from <span className="font-mono">{restoreParam.name}</span>
              </CardTitle>
              <Button variant="outline" size="xs" onClick={restoreParam.close}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3">
              <Warning className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p className="text-xs text-foreground">
                <span className="font-semibold">Restore overwrites a live database and is not
                run from the console.</span>{' '}
                Restore is destructive and irreversible — run the command(s) below on S1 during a
                maintenance window, after confirming the target is safe to overwrite. Take a fresh
                backup first.
              </p>
            </div>
            {restoreLoading ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Inspecting dump…</p>
            ) : restore && !restore.ok ? (
              <p className="py-4 text-center text-xs text-destructive">
                {restore.error ?? 'Could not inspect this backup.'}
              </p>
            ) : restore && restore.plan.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No dump files found in this backup.
              </p>
            ) : restore ? (
              <div className="space-y-3">
                {restore.plan.map((item) => (
                  <div key={item.file} className="rounded border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-foreground">{item.file}</div>
                        <div className="text-[11px] text-muted-foreground">{item.target}</div>
                      </div>
                      <Badge variant="secondary" className="shrink-0 bg-muted text-muted-foreground">
                        {formatBytes(item.sizeBytes)}
                      </Badge>
                    </div>
                    {item.command ? (
                      <div className="mt-2 flex items-start gap-2">
                        <pre className="flex-1 overflow-x-auto rounded bg-muted/40 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap">
                          {item.command}
                        </pre>
                        <Button
                          variant="outline"
                          size="xs"
                          className="shrink-0 gap-1"
                          onClick={() => {
                            void navigator.clipboard?.writeText(item.command ?? '');
                          }}
                        >
                          <Copy className="size-3" />
                          Copy
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-muted-foreground/70">
                        Unrecognised dump — no known restore command. Restore manually.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Delete confirm */}
      <Dialog open={confirmDeleteName !== null} onOpenChange={(o) => !o && confirm.close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete backup</DialogTitle>
            <DialogDescription>
              Permanently delete <span className="font-mono">{confirmDeleteName}</span> from{' '}
              {config.backupRoot}? This removes the dump files on disk. The off-box copy (if any) is
              not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={confirm.close} disabled={busy === 'delete'}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy === 'delete'}
              onClick={() => confirmDeleteName && deleteBackup(confirmDeleteName)}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Prune confirm */}
      <Dialog open={confirmPrune} onOpenChange={(o) => !o && confirm.close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prune aged backups</DialogTitle>
            <DialogDescription>
              Delete all {prunableCount} backup{prunableCount === 1 ? '' : 's'} older than the{' '}
              {config.retentionDays}-day retention window. Backups still within retention are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={confirm.close} disabled={busy === 'prune'}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy === 'prune'} onClick={prune}>
              {busy === 'prune' ? 'Pruning…' : `Prune ${prunableCount}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-1 py-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-[10px] uppercase tracking-wide">{label}</span>
        </div>
        <div className="text-lg font-semibold text-foreground">{value}</div>
        <div className="truncate font-mono text-[10px] text-muted-foreground/70" title={sub}>
          {sub}
        </div>
      </CardContent>
    </Card>
  );
}
