'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { BlastRadiusControls, BlastRadiusUsage } from '@/lib/app-run-controls';

// ─── AppControlsEditor — SHADOW MODE + BLAST-RADIUS management surface ─────────────────────────────
//
// Full-width management UI (not a read-only view) for the per-app safety dials that let a cautious
// BFSI operator TRUST an autonomous app before it acts for real:
//   • Kill-switch (enabled)   — disable the app entirely; every run is denied at run start.
//   • Shadow default          — force a DRY-RUN on every run: side-effecting sinks (email/report/
//                               whatsapp) NO-OP and record what they WOULD have done.
//   • Daily run cap           — max runs/day (blank = no cap).
//   • Spend cap               — USD cap, per-day or per-run (blank = no cap).
//
// The pure decision + normalization live in app-run-controls.ts; this component only shapes the form
// and PATCHes /api/v1/admin/apps/[id]/controls. Reset to default DELETEs the row (enabled, live, no caps).

function numOrEmpty(v: number | null | undefined): string {
  return v == null ? '' : String(v);
}
function parseNumOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function AppControlsEditor({
  appId,
  initialControls,
  usage,
}: Readonly<{
  appId: string;
  initialControls: BlastRadiusControls;
  usage: BlastRadiusUsage;
}>) {
  const [enabled, setEnabled] = React.useState(initialControls.enabled);
  const [shadowDefault, setShadowDefault] = React.useState(initialControls.shadowDefault ?? false);
  const [maxRunsPerDay, setMaxRunsPerDay] = React.useState(numOrEmpty(initialControls.maxRunsPerDay));
  const [spendCapUsd, setSpendCapUsd] = React.useState(numOrEmpty(initialControls.spendCapUsd));
  const [spendCapScope, setSpendCapScope] = React.useState<'day' | 'run'>(
    initialControls.spendCapScope ?? 'day',
  );
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/apps/${appId}/controls`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled,
          shadowDefault,
          maxRunsPerDay: parseNumOrNull(maxRunsPerDay),
          spendCapUsd: parseNumOrNull(spendCapUsd),
          spendCapScope,
        }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      toast.success('Safety controls saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function resetDefault() {
    if (!confirm('Clear all safety controls? The app reverts to enabled, live, with no caps.')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/apps/${appId}/controls`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`reset failed (${res.status})`);
      setEnabled(true);
      setShadowDefault(false);
      setMaxRunsPerDay('');
      setSpendCapUsd('');
      setSpendCapScope('day');
      toast.success('Reverted to defaults');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── The dials (2 cols) ── */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Kill-switch & shadow mode</CardTitle>
              <CardDescription>
                Run this app safely before it acts for real. Shadow mode executes every step normally
                but INTERCEPTS side-effecting sinks (email, report, WhatsApp) — they never send; the
                run records exactly what they would have done.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="enabled" className="text-sm font-medium">
                    Enabled
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Off = kill-switch: every run is denied at run start until re-enabled.
                  </p>
                </div>
                <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="shadow" className="text-sm font-medium">
                    Shadow by default (dry-run)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Force every run into shadow mode. Arm it live only once you trust its behaviour.
                  </p>
                </div>
                <Switch id="shadow" checked={shadowDefault} onCheckedChange={setShadowDefault} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Blast radius</CardTitle>
              <CardDescription>
                Cap how far the app can reach in a day. Blank = no cap. A local ($0) run never hits a
                spend cap — only real cloud spend does.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="runs">Max runs per day</Label>
                <Input
                  id="runs"
                  inputMode="numeric"
                  placeholder="no cap"
                  value={maxRunsPerDay}
                  onChange={(e) => setMaxRunsPerDay(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="spend">Spend cap (USD)</Label>
                <Input
                  id="spend"
                  inputMode="decimal"
                  placeholder="no cap"
                  value={spendCapUsd}
                  onChange={(e) => setSpendCapUsd(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="scope">Spend cap scope</Label>
                <select
                  id="scope"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={spendCapScope}
                  onChange={(e) => setSpendCapScope(e.target.value === 'run' ? 'run' : 'day')}
                >
                  <option value="day">Per day (rolling calendar day)</option>
                  <option value="run">Per run (each single run)</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save controls'}
            </Button>
            <Button variant="outline" onClick={resetDefault} disabled={saving}>
              Reset to default
            </Button>
          </div>
        </div>

        {/* ── Live usage (1 col) ── */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Today</CardTitle>
              <CardDescription>Live usage against the caps (UTC day).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-2xl font-semibold tabular-nums">{usage.runsToday}</div>
                <div className="text-xs text-muted-foreground">
                  runs today{maxRunsPerDay ? ` of ${maxRunsPerDay} cap` : ' (no cap)'}
                </div>
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums">
                  ${usage.spentTodayUsd.toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground">
                  spent today{spendCapUsd ? ` of $${spendCapUsd} cap` : ' (no cap)'}
                </div>
              </div>
              <div className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground">
                {enabled ? (
                  shadowDefault ? (
                    <span>Runs are DRY-RUN (shadow): side-effecting steps record but do not send.</span>
                  ) : (
                    <span>Runs are LIVE: side-effecting steps will act for real.</span>
                  )
                ) : (
                  <span className="text-destructive">Disabled — no runs permitted (kill-switch on).</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
