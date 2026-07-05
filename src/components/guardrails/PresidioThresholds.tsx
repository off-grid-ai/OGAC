'use client';

import { Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Per-entity + global score-threshold editor. The global floor rides on every Presidio /analyze
// request as `score_threshold`; per-entity floors are enforced locally after the analyzer responds.
// PUTs the whole config to /api/v1/admin/guardrails/thresholds, then refreshes the server component.

export interface Thresholds {
  global: number;
  perEntity: Record<string, number>;
}

interface Row {
  entity: string;
  score: number;
}

export function PresidioThresholds({ thresholds }: { thresholds: Thresholds }) {
  const router = useRouter();
  const [global, setGlobal] = useState(thresholds.global);
  const [rows, setRows] = useState<Row[]>(
    Object.entries(thresholds.perEntity).map(([entity, score]) => ({ entity, score })),
  );
  const [busy, setBusy] = useState(false);

  function addRow() {
    setRows((rs) => [...rs, { entity: '', score: 0.5 }]);
  }
  function updateRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function save() {
    setBusy(true);
    const perEntity: Record<string, number> = {};
    for (const r of rows) {
      const key = r.entity.trim().toUpperCase();
      if (key) perEntity[key] = r.score;
    }
    const res = await fetch('/api/v1/admin/guardrails/thresholds', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ global, perEntity }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Thresholds saved');
      router.refresh();
    } else {
      toast.error('Failed to save thresholds');
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Filter out low-confidence detections. The global floor applies to any entity without its own
        threshold; per-entity floors override it. A hit is kept only when its score meets the floor.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="thr-global">Global floor: {global.toFixed(2)}</Label>
        <input
          id="thr-global"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={global}
          onChange={(e) => setGlobal(Number(e.target.value))}
          className="w-full"
        />
      </div>

      <div className="space-y-2">
        <Label>Per-entity overrides</Label>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No per-entity overrides — the global floor applies to everything.
          </p>
        ) : (
          rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={r.entity}
                placeholder="PERSON"
                className="flex-1 font-mono"
                onChange={(e) => updateRow(i, { entity: e.target.value })}
              />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={r.score}
                onChange={(e) => updateRow(i, { score: Number(e.target.value) })}
                className="flex-1"
              />
              <span className="w-10 text-right font-mono text-xs">{r.score.toFixed(2)}</span>
              <Button size="icon" variant="ghost" onClick={() => removeRow(i)} title="Remove">
                <Trash className="size-4" />
              </Button>
            </div>
          ))
        )}
        <Button size="sm" variant="outline" onClick={addRow}>
          <Plus className="size-4" />
          Add entity threshold
        </Button>
      </div>

      <Button onClick={save} disabled={busy}>
        Save thresholds
      </Button>
    </div>
  );
}
