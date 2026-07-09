'use client';

import { Clock, CurrencyInr, Lightning, TrendUp } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type AppRoi, formatHours, formatInr } from '@/lib/roi';

// ─── Per-app ROI card — the value story for ONE app ────────────────────────────────────────────────
// Shows the four headline numbers (real runs, est. hours saved, est. ₹ value, ACTUAL AI cost) and the
// resulting net, then an editable panel for the two ESTIMATES that drive it. Estimates are labelled as
// such throughout so nobody mistakes them for measured facts. The form PUTs to
// /api/v1/admin/apps/[id]/roi and refreshes the row from the response.

interface Props {
  appId: string;
  initial: AppRoi;
  /** The org-default estimates in effect, shown as the "inherited" hint when the app has no override. */
  orgDefault: { minutesSavedPerRun: number; loadedCostPerHour: number } | null;
  /** Whether the app currently has its OWN override (vs inheriting the org default). */
  hasOverride: boolean;
}

function Metric({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  estimate,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  tone?: 'good' | 'bad' | 'default';
  estimate?: boolean;
}) {
  const toneClass =
    tone === 'good' ? 'text-primary' : tone === 'bad' ? 'text-destructive' : 'text-foreground';
  return (
    <div className="rounded-md border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {estimate ? (
          <span className="rounded bg-amber-500/10 px-1 py-0.5 font-medium text-amber-600">
            estimate
          </span>
        ) : (
          <span className="rounded bg-primary/10 px-1 py-0.5 font-medium text-primary">actual</span>
        )}
        {sub}
      </div>
    </div>
  );
}

export function AppRoiCard({ appId, initial, orgDefault, hasOverride }: Props) {
  const [roi, setRoi] = useState<AppRoi>(initial);
  const [override, setOverride] = useState(hasOverride);
  const [mins, setMins] = useState(String(initial.minutesSavedPerRun));
  const [rate, setRate] = useState(String(initial.loadedCostPerHour));
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  async function save(clear: boolean) {
    setSaving(true);
    try {
      const body = clear
        ? { minutesSavedPerRun: null, loadedCostPerHour: null }
        : { minutesSavedPerRun: Number(mins), loadedCostPerHour: Number(rate) };
      const res = await fetch(`/api/v1/admin/apps/${appId}/roi`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'save failed');
      setRoi(json.roi);
      setMins(String(json.roi.minutesSavedPerRun));
      setRate(String(json.roi.loadedCostPerHour));
      setOverride(!clear);
      setEditing(false);
      toast.success(clear ? 'Reverted to org default' : 'ROI estimate saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  const netTone = roi.netValue >= 0 ? 'good' : 'bad';

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-sm">Return on investment</CardTitle>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            What this automation is worth this period: real runs and actual AI cost, against an
            <span className="font-medium text-amber-600"> estimate</span> of the manual time each run
            replaces. Estimates are yours to set — they are clearly labelled and never presented as
            measured facts.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Close' : 'Edit estimate'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            icon={Lightning}
            label="Runs completed"
            value={roi.runsCompleted.toLocaleString('en-IN')}
            sub="successful runs this period"
            estimate={false}
          />
          <Metric
            icon={Clock}
            label="Hours saved"
            value={formatHours(roi.hoursSaved)}
            sub={`${roi.minutesSavedPerRun} min saved / run`}
            estimate
          />
          <Metric
            icon={CurrencyInr}
            label="Value of time saved"
            value={formatInr(roi.grossValue)}
            sub={`@ ${formatInr(roi.loadedCostPerHour)}/hr loaded cost`}
            estimate
          />
          <Metric
            icon={CurrencyInr}
            label="AI cost"
            value={formatInr(roi.actualAiCost)}
            sub="actual gateway spend"
            estimate={false}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-3">
            <TrendUp className="size-5 text-primary" />
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Net value (est.)
              </div>
              <div
                className={`text-2xl font-semibold tabular-nums ${
                  netTone === 'good' ? 'text-primary' : 'text-destructive'
                }`}
              >
                {formatInr(roi.netValue)}
              </div>
            </div>
          </div>
          {roi.roiMultiple !== null ? (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Value per ₹ of AI cost
              </div>
              <div className="text-2xl font-semibold tabular-nums text-foreground">
                {roi.roiMultiple}×
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No AI cost recorded this period.</div>
          )}
        </div>

        {editing ? (
          <div className="space-y-3 rounded-md border border-border p-4">
            <p className="text-xs text-muted-foreground">
              {override
                ? 'This app has its own estimate. '
                : orgDefault
                  ? 'Inheriting the org default. Set an override below. '
                  : 'Using the built-in default. Set an override below. '}
              These are <span className="font-medium text-amber-600">estimates</span> — set them from
              how long the task took your team by hand.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="roi-mins">Minutes saved per run</Label>
                <Input
                  id="roi-mins"
                  type="number"
                  min={1}
                  value={mins}
                  onChange={(e) => setMins(e.target.value)}
                />
                {orgDefault ? (
                  <p className="text-xs text-muted-foreground">
                    Org default: {orgDefault.minutesSavedPerRun} min
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="roi-rate">Loaded cost per hour (₹)</Label>
                <Input
                  id="roi-rate"
                  type="number"
                  min={1}
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
                {orgDefault ? (
                  <p className="text-xs text-muted-foreground">
                    Org default: {formatInr(orgDefault.loadedCostPerHour)}/hr
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={saving} onClick={() => save(false)}>
                {saving ? 'Saving…' : 'Save estimate'}
              </Button>
              {override ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => save(true)}
                >
                  Revert to org default
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
