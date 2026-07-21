'use client';

import { ArrowsClockwise, Clock, PencilSimple, Warning } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CRON_PRESETS,
  SYNC_MODE_CHOICES,
  TIME_UNITS,
  type ConnectionDetail,
  type ScheduleType,
  type SyncModeChoice,
} from '@/lib/airbyte-schedule-model';
import { panelHref, withPanelParams } from '@/lib/url-panel';

const SYNC_MODE_LABEL: Record<SyncModeChoice, string> = {
  full_refresh_overwrite: 'Full refresh · overwrite',
  full_refresh_append: 'Full refresh · append',
  incremental_append: 'Incremental · append',
  incremental_dedup: 'Incremental · dedup + history',
};

// Full management surface for ONE Airbyte connection's schedule, per-stream sync modes, and state
// reset. Nav lives in the URL (?panel=edit-schedule | reset) so Back closes a dialog and every
// action is deep-linkable — never local useState for a navigational position. Every write goes to
// the governed /api/v1/admin/data/airbyte routes; the pure model validates before Airbyte sees it.
export function ConnectionScheduleManager({
  connection,
}: Readonly<{ connection: ConnectionDetail }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const panel = params.get('panel');

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* Schedule card. */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Clock className="size-4 text-muted-foreground" /> Schedule
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setPanel('edit-schedule')}>
            <PencilSimple className="size-4" /> Edit
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge className="bg-primary/10 text-primary">{connection.scheduleType}</Badge>
            <span className="text-muted-foreground">{connection.scheduleLabel}</span>
          </div>
          {connection.scheduleType === 'cron' && connection.cronTimeZone ? (
            <p className="text-xs text-muted-foreground">Timezone: {connection.cronTimeZone}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Reset-state card. */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <ArrowsClockwise className="size-4 text-muted-foreground" /> Replication state
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Clear saved state so the next sync re-reads every record from scratch. Use after a schema
            change or a bad incremental cursor.
          </p>
          <Button size="sm" variant="outline" onClick={() => setPanel('reset')}>
            Reset state
          </Button>
        </CardContent>
      </Card>

      {/* Streams + per-stream sync mode. */}
      <Card className="shadow-sm xl:col-span-3">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Streams &amp; sync modes</CardTitle>
        </CardHeader>
        <CardContent>
          {connection.streams.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              This connection has no configured streams.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stream</TableHead>
                    <TableHead>Cursor</TableHead>
                    <TableHead>Primary key</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Sync mode</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connection.streams.map((s) => (
                    <TableRow key={`${s.namespace ?? ''}.${s.name}`}>
                      <TableCell className="font-medium">
                        {s.name}
                        {s.cdc ? (
                          <Badge className="ml-2 bg-amber-500/10 text-amber-600">CDC</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {s.cursorField?.join(', ') || '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {s.primaryKey?.map((k) => k.join('.')).join(', ') || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-muted text-muted-foreground">
                          {SYNC_MODE_LABEL[s.syncMode]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <StreamModeSelect
                          connectionId={connection.connectionId}
                          stream={s.name}
                          current={s.syncMode}
                          onDone={() => router.refresh()}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ScheduleDialog
        open={panel === 'edit-schedule'}
        connection={connection}
        onOpenChange={(o) => !o && setPanel(null)}
        onDone={() => {
          setPanel(null);
          router.refresh();
        }}
      />
      <ResetDialog
        open={panel === 'reset'}
        connection={connection}
        onOpenChange={(o) => !o && setPanel(null)}
        onDone={() => {
          setPanel(null);
          router.refresh();
        }}
      />
    </div>
  );
}

// A styled native select — the repo has no Select primitive; native <select> keeps the per-row
// control simple and accessible. Changing the value PATCHes the sync mode immediately.
function StreamModeSelect({
  connectionId,
  stream,
  current,
  onDone,
}: Readonly<{
  connectionId: string;
  stream: string;
  current: SyncModeChoice;
  onDone: () => void;
}>) {
  const [busy, setBusy] = useState(false);

  async function change(mode: SyncModeChoice) {
    if (mode === current || busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/admin/data/airbyte/connections/${connectionId}/sync-mode`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ stream, mode }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        toast.success(`${stream}: sync mode updated`);
        onDone();
      } else {
        toast.error(body.error || 'Could not change sync mode');
      }
    } catch {
      toast.error('Could not change sync mode');
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      aria-label={`Sync mode for ${stream}`}
      className="rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-50"
      value={current}
      disabled={busy}
      onChange={(e) => change(e.target.value as SyncModeChoice)}
    >
      {SYNC_MODE_CHOICES.map((m) => (
        <option key={m} value={m}>
          {SYNC_MODE_LABEL[m]}
        </option>
      ))}
    </select>
  );
}

function ScheduleDialog({
  open,
  connection,
  onOpenChange,
  onDone,
}: Readonly<{
  open: boolean;
  connection: ConnectionDetail;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}>) {
  const [type, setType] = useState<ScheduleType>(connection.scheduleType);
  const [units, setUnits] = useState(String(connection.intervalUnits ?? 24));
  const [timeUnit, setTimeUnit] = useState(connection.intervalTimeUnit ?? 'hours');
  const [cron, setCron] = useState(connection.cronExpression ?? '0 0 2 * * ?');
  const [tz, setTz] = useState(connection.cronTimeZone ?? 'UTC');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setType(connection.scheduleType);
      setUnits(String(connection.intervalUnits ?? 24));
      setTimeUnit(connection.intervalTimeUnit ?? 'hours');
      setCron(connection.cronExpression ?? '0 0 2 * * ?');
      setTz(connection.cronTimeZone ?? 'UTC');
    }
  }, [open, connection]);

  async function save() {
    setBusy(true);
    try {
      const payload =
        type === 'manual'
          ? { type }
          : type === 'basic'
            ? { type, units: Number(units), timeUnit }
            : { type, cronExpression: cron, cronTimeZone: tz };
      const res = await fetch(
        `/api/v1/admin/data/airbyte/connections/${connection.connectionId}/schedule`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        toast.success('Schedule updated');
        onDone();
      } else {
        toast.error(body.error || 'Could not update the schedule');
      }
    } catch {
      toast.error('Could not update the schedule');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit schedule</DialogTitle>
          <DialogDescription>
            How often Airbyte replicates {connection.name}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sched-type">Cadence</Label>
            <select
              id="sched-type"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as ScheduleType)}
            >
              <option value="manual">Manual (triggered only)</option>
              <option value="basic">Interval</option>
              <option value="cron">Cron (Quartz)</option>
            </select>
          </div>

          {type === 'basic' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sched-units">Every</Label>
                <Input
                  id="sched-units"
                  type="number"
                  min={1}
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sched-unit">Unit</Label>
                <select
                  id="sched-unit"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={timeUnit}
                  onChange={(e) => setTimeUnit(e.target.value)}
                >
                  {TIME_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          {type === 'cron' ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="sched-cron">Cron expression</Label>
                <Input
                  id="sched-cron"
                  value={cron}
                  className="font-mono"
                  onChange={(e) => setCron(e.target.value)}
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {CRON_PRESETS.map((p) => (
                    <button
                      key={p.expression}
                      type="button"
                      className="rounded border border-input px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                      onClick={() => setCron(p.expression)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sched-tz">Timezone</Label>
                <Input id="sched-tz" value={tz} onChange={(e) => setTz(e.target.value)} />
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({
  open,
  connection,
  onOpenChange,
  onDone,
}: Readonly<{
  open: boolean;
  connection: ConnectionDetail;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}>) {
  const [busy, setBusy] = useState(false);

  async function reset() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/admin/data/airbyte/connections/${connection.connectionId}/reset`,
        { method: 'POST' },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        toast.success('Replication state reset — next sync re-reads everything');
        onDone();
      } else {
        toast.error(body.error || 'Reset failed');
      }
    } catch {
      toast.error('Reset failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Warning className="size-5 text-amber-500" /> Reset replication state?
          </DialogTitle>
          <DialogDescription>
            The next sync of {connection.name} will re-read every record from the source. This can be
            slow and expensive for large sources. The data already in the warehouse is not deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={reset} disabled={busy}>
            {busy ? 'Resetting…' : 'Reset state'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
