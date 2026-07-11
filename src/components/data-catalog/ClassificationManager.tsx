'use client';

import { Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DataClassificationRow } from '@/db/schema';
import { CLASSIFICATION_LEVELS } from '@/lib/data-classification';

const LEVEL_TONE: Record<string, string> = {
  public: 'bg-muted text-muted-foreground',
  internal: 'bg-primary/10 text-primary',
  confidential: 'bg-amber-500/10 text-amber-600',
  restricted: 'bg-destructive/10 text-destructive',
};

// Full CRUD over an asset's classification rows. Set/upsert a level + PII tags for the asset default
// (no column) or a specific column; delete a row. Every write hits the API then refreshes.
export function ClassificationManager({
  assetId,
  initial,
}: Readonly<{
  assetId: string;
  initial: DataClassificationRow[];
}>) {
  const router = useRouter();
  const [column, setColumn] = useState('');
  const [level, setLevel] = useState('internal');
  const [pii, setPii] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const piiTags = pii.split(',').map((s) => s.trim()).filter(Boolean);
      const res = await fetch(`/api/v1/admin/data-assets/${assetId}/classifications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ column: column.trim() || null, level, piiTags }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'failed');
      toast.success('Classification saved');
      setColumn('');
      setPii('');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/data-classifications/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      toast.success('Classification removed');
      router.refresh();
    } catch {
      toast.error('Failed to remove');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="h-full shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Classification</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing rows. */}
        {initial.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No classification set yet. Add an asset-level default (leave column blank) or classify a
            specific column below.
          </p>
        ) : (
          <div className="space-y-2">
            {initial.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-foreground">{c.column ?? 'asset default'}</span>
                  <Badge className={LEVEL_TONE[c.level] ?? LEVEL_TONE.internal}>{c.level}</Badge>
                  {c.piiTags.length > 0 ? (
                    <Badge className="bg-destructive/10 text-destructive">{c.piiTags.join(', ')}</Badge>
                  ) : null}
                </div>
                <Button size="sm" variant="ghost" onClick={() => remove(c.id)} disabled={busy}>
                  <Trash className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add / update form. */}
        <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Column (blank = asset default)</Label>
            <Input value={column} onChange={(e) => setColumn(e.target.value)} placeholder="e.g. pan_number" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Level</Label>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {CLASSIFICATION_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">PII tags (comma-separated)</Label>
            <Input value={pii} onChange={(e) => setPii(e.target.value)} placeholder="PAN, AADHAAR, EMAIL" />
          </div>
          <div className="sm:col-span-2">
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Set classification'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
