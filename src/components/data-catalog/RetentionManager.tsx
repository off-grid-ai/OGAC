'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { RetentionPolicyRow } from '@/db/schema';
import { RETENTION_ACTIONS } from '@/lib/data-retention';

// Full CRUD over an asset's retention policy (one per asset). PUT upserts; DELETE removes. Legal hold
// overrides the window (never auto-purged while held).
export function RetentionManager({
  assetId,
  initial,
}: Readonly<{
  assetId: string;
  initial: RetentionPolicyRow | null;
}>) {
  const router = useRouter();
  const [retainDays, setRetainDays] = useState(initial?.retainDays ?? 0);
  const [action, setAction] = useState(initial?.action ?? 'delete');
  const [legalHold, setLegalHold] = useState(initial?.legalHold ?? false);
  const [note, setNote] = useState(initial?.note ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/data-assets/${assetId}/retention`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retainDays, action, legalHold, note }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'failed');
      toast.success('Retention policy saved');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/data-assets/${assetId}/retention`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      toast.success('Retention policy removed');
      setRetainDays(0);
      setLegalHold(false);
      setNote('');
      router.refresh();
    } catch {
      toast.error('Failed to remove policy');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Retention & disposal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="max-w-2xl text-xs text-muted-foreground">
          Keep this dataset for N days from its last refresh, then dispose of it. 0 = keep
          indefinitely. A legal hold overrides the window and blocks any auto-purge.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Retain (days)</Label>
            <Input
              type="number"
              min={0}
              value={retainDays}
              onChange={(e) => setRetainDays(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Action at expiry</Label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {RETENTION_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Switch checked={legalHold} onCheckedChange={setLegalHold} id="legal-hold" />
            <Label htmlFor="legal-hold" className="text-xs">
              Legal hold
            </Label>
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label className="text-xs">Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. RBI 7-year rule" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save retention policy'}
          </Button>
          {initial ? (
            <Button size="sm" variant="outline" onClick={remove} disabled={busy}>
              Remove policy
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
