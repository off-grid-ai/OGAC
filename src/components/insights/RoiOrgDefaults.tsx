'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatInr } from '@/lib/roi';

// ─── Org-default ROI estimates editor ──────────────────────────────────────────────────────────────
// Sets the org-wide minutes-saved-per-run and loaded-cost-per-hour that every app inherits unless it
// sets its own override. PUTs to /api/v1/admin/roi. Estimates, clearly labelled.
export function RoiOrgDefaults({
  initial,
}: {
  initial: { minutesSavedPerRun: number; loadedCostPerHour: number };
}) {
  const [mins, setMins] = useState(String(initial.minutesSavedPerRun));
  const [rate, setRate] = useState(String(initial.loadedCostPerHour));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/roi', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          minutesSavedPerRun: Number(mins),
          loadedCostPerHour: Number(rate),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'save failed');
      toast.success('Org ROI defaults saved — reload to recompute the rollup.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Org ROI assumptions</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          The org-wide <span className="font-medium text-amber-600">estimates</span> every app
          inherits unless it sets its own. Set them from typical manual-handling time and a
          fully-loaded staff cost. Current: {initial.minutesSavedPerRun} min/run @{' '}
          {formatInr(initial.loadedCostPerHour)}/hr.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="org-roi-mins">Minutes saved per run</Label>
            <Input
              id="org-roi-mins"
              type="number"
              min={1}
              value={mins}
              onChange={(e) => setMins(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-roi-rate">Loaded cost per hour (₹)</Label>
            <Input
              id="org-roi-rate"
              type="number"
              min={1}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
        </div>
        <Button size="sm" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save defaults'}
        </Button>
      </CardContent>
    </Card>
  );
}
