'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  buildScheduleView,
  SCHEDULE_PRESETS,
  type ScheduleConfig,
  type ScheduleView,
} from '@/lib/app-schedule';

// ─── AppScheduleEditor — the "when does this run on its own?" management surface (Gap #1) ───────────
//
// Full-width, full-CRUD editor for a schedule-triggered app. Before this, picking "Schedule" in the
// builder was a DEAD-END: no cron/timezone form, no next-fire preview, no wiring — a saved schedule
// that never fired. This surface sets cron + timezone + enabled, PATCHes /apps/[id]/schedule (which
// re-registers on the durable runner), and shows a LIVE next-fire preview so the operator sees exactly
// when it will run before saving.
//
// SOLID: all validity + next-fire computation is the PURE app-schedule authority (buildScheduleView) —
// recomputed client-side on every edit for the instant preview, and re-computed server-side on save so
// the two never drift. This component only shapes the form + does the fetch.

function fmtFire(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

export function AppScheduleEditor({
  appId,
  initialView,
}: {
  appId: string;
  initialView: ScheduleView;
}) {
  const router = useRouter();
  const [cron, setCron] = React.useState(initialView.config.cron);
  const [timezone, setTimezone] = React.useState(initialView.config.timezone);
  const [enabled, setEnabled] = React.useState(initialView.config.enabled);
  const [saving, setSaving] = React.useState(false);

  // Live client-side preview from the ONE pure authority — no drift with the server view on save.
  const preview: ScheduleView = React.useMemo(
    () =>
      buildScheduleView(
        appId,
        { cron: cron.trim(), timezone: timezone.trim(), enabled } satisfies ScheduleConfig,
        initialView.runtimeConfigured,
      ),
    [appId, cron, timezone, enabled, initialView.runtimeConfigured],
  );

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/apps/${appId}/schedule`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cron: cron.trim(), timezone: timezone.trim(), enabled }),
      });
      if (res.status === 422) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || 'invalid schedule');
      }
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      toast.success(enabled ? 'Schedule saved — it will fire on the runner' : 'Schedule saved (paused)');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function clearSchedule() {
    if (!confirm('Remove the schedule? The app reverts to on-demand and will not run on its own.')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/apps/${appId}/schedule`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`remove failed (${res.status})`);
      setCron('');
      setEnabled(true);
      toast.success('Schedule removed — the app is on-demand');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── The config (2 cols) ── */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>When does this run?</CardTitle>
              <CardDescription>
                Pick how often this app runs on its own. Choose a preset or enter a cron expression
                (minute hour day month weekday). The times below are computed in the timezone you set.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <Label>Presets</Label>
                <div className="flex flex-wrap gap-2">
                  {SCHEDULE_PRESETS.map((p) => (
                    <button
                      key={p.cron}
                      type="button"
                      onClick={() => setCron(p.cron)}
                      className={
                        'rounded-md border px-2.5 py-1 text-xs transition-colors ' +
                        (cron.trim() === p.cron
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground')
                      }
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cron">Schedule (cron)</Label>
                  <Input
                    id="cron"
                    placeholder="0 9 * * 1"
                    value={cron}
                    onChange={(e) => setCron(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tz">Timezone (IANA)</Label>
                  <Input
                    id="tz"
                    placeholder="UTC"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="enabled" className="text-sm font-medium">
                    Armed
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Off = saved but paused: the schedule is kept but never fires until you re-arm it.
                  </p>
                </div>
                <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save schedule'}
            </Button>
            <Button variant="outline" onClick={clearSchedule} disabled={saving}>
              Remove schedule
            </Button>
          </div>
        </div>

        {/* ── Live preview (1 col) ── */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Next runs</CardTitle>
              <CardDescription>{preview.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!preview.valid ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                  {preview.reason}
                </p>
              ) : !enabled ? (
                <p className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground">
                  Paused — arm the schedule to see upcoming runs.
                </p>
              ) : preview.nextFires.length === 0 ? (
                <p className="text-xs text-muted-foreground">No upcoming runs in the next year.</p>
              ) : (
                <ol className="space-y-2">
                  {preview.nextFires.map((iso, i) => (
                    <li key={iso} className="flex items-baseline gap-2 text-sm">
                      <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                      <span className="tabular-nums text-foreground">{fmtFire(iso)}</span>
                    </li>
                  ))}
                </ol>
              )}

              <div className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground">
                {preview.runtimeConfigured ? (
                  <span>
                    The scheduler is live — a saved, armed schedule fires automatically via the runner.
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-500">
                    Saved schedules are kept but stay dormant until the scheduled-runs service is
                    enabled on this deployment. They will start firing once it is turned on — nothing
                    is lost in the meantime.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
