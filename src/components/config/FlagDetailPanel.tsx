'use client';

import { Plus, Trash, X } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Variant {
  name: string;
  weight: number;
  weightType?: 'variable' | 'fix';
}

interface FlagDetail {
  key: string;
  enabled: boolean;
  description: string;
  variants: Variant[];
  rolloutPercent: number | null;
  source: 'unleash' | 'native';
}

// Right-side slide-over (NOT a modal) for editing a single flag: description, variant buckets, and
// gradual-rollout percentage. Variants + rollout are Unleash-only; when the backend is the
// first-party store those editors show a "requires Unleash" notice instead. Opening/closing is
// driven by the parent via the ?flag=<key> query param (browser Back closes it).
export function FlagDetailPanel({
  flagKey,
  backend,
  environment,
  onClose,
  onChanged,
}: Readonly<{
  flagKey: string;
  backend: 'unleash' | 'native';
  environment: string | null;
  onClose: () => void;
  onChanged: () => void;
}>) {
  const [detail, setDetail] = useState<FlagDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [desc, setDesc] = useState('');
  const [variants, setVariants] = useState<Variant[]>([]);
  const [rollout, setRollout] = useState<number>(100);
  const [busy, setBusy] = useState(false);
  const unleash = backend === 'unleash';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/v1/admin/flags/${encodeURIComponent(flagKey)}`, {
        cache: 'no-store',
      });
      if (!r.ok) throw new Error('load failed');
      const d = (await r.json()) as FlagDetail;
      setDetail(d);
      setDesc(d.description);
      setVariants(d.variants ?? []);
      setRollout(d.rolloutPercent ?? 100);
    } catch {
      toast.error('Could not load flag detail');
    } finally {
      setLoading(false);
    }
  }, [flagKey]);

  useEffect(() => {
    load();
  }, [load]);

  // Close on Escape — the panel is a navigational position; Escape maps to the same close as Back.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  async function saveDescription() {
    setBusy(true);
    const res = await fetch(`/api/v1/admin/flags/${encodeURIComponent(flagKey)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: desc }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Description saved');
      onChanged();
    } else {
      toast.error('Save failed');
    }
  }

  async function saveVariants() {
    setBusy(true);
    const res = await fetch(`/api/v1/admin/flags/${encodeURIComponent(flagKey)}/variants`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        variants: variants.map((v) => ({ name: v.name, weightType: v.weightType ?? 'variable' })),
      }),
    });
    setBusy(false);
    const d = (await res.json().catch(() => ({}))) as { error?: string; variants?: Variant[] };
    if (res.ok) {
      toast.success('Variants saved');
      if (d.variants) setVariants(d.variants);
      onChanged();
    } else {
      toast.error(d.error ?? 'Variants save failed');
    }
  }

  async function saveRollout() {
    setBusy(true);
    const res = await fetch(`/api/v1/admin/flags/${encodeURIComponent(flagKey)}/rollout`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ percent: rollout }),
    });
    setBusy(false);
    const d = (await res.json().catch(() => ({}))) as { error?: string; percent?: number };
    if (res.ok) {
      toast.success(`Rollout set to ${d.percent ?? rollout}%`);
      onChanged();
    } else {
      toast.error(d.error ?? 'Rollout save failed');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* scrim — click closes; not a modal dialog, just a slide-over */}
      <button
        type="button"
        aria-label="Close panel"
        className="flex-1 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l bg-background shadow-xl"
        role="region"
        aria-label={`Flag ${flagKey}`}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-sm text-foreground">{flagKey}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {unleash ? `Unleash · ${environment ?? 'env'}` : 'first-party store'}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        {loading ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Loading…</div>
        ) : !detail ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Flag not found.</div>
        ) : (
          <div className="space-y-6 p-4">
            {/* Description */}
            <section className="space-y-2">
              <Label htmlFor="fd-desc" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Description
              </Label>
              <Input
                id="fd-desc"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="what this gates"
                className="text-xs"
              />
              <Button size="sm" onClick={saveDescription} disabled={busy}>
                Save description
              </Button>
            </section>

            {/* Variants */}
            <section className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Variants
                </Label>
                {unleash ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setVariants((v) => [...v, { name: '', weight: 0, weightType: 'variable' }])}
                  >
                    <Plus className="size-3.5" /> Add
                  </Button>
                ) : null}
              </div>
              {!unleash ? (
                <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  Variants require a configured Unleash (URL + admin token). The first-party store
                  can't split traffic into weighted buckets.
                </p>
              ) : variants.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No variants. Weights auto-balance to sum 100% across variable buckets.
                </p>
              ) : (
                <div className="space-y-2">
                  {variants.map((v, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={v.name}
                        onChange={(e) =>
                          setVariants((cur) =>
                            cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                          )
                        }
                        placeholder="variant name"
                        className="font-mono text-xs"
                      />
                      <Badge variant="secondary" className="shrink-0 text-muted-foreground">
                        {(v.weight / 10).toFixed(0)}%
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setVariants((cur) => cur.filter((_, j) => j !== i))}
                        aria-label={`Remove variant ${i + 1}`}
                      >
                        <Trash className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {unleash ? (
                <Button size="sm" onClick={saveVariants} disabled={busy}>
                  Save variants
                </Button>
              ) : null}
            </section>

            {/* Gradual rollout */}
            <section className="space-y-3 border-t pt-4">
              <Label htmlFor="fd-rollout" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Gradual rollout
              </Label>
              {!unleash ? (
                <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  Gradual rollout (flexibleRollout strategy) requires a configured Unleash.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <input
                      id="fd-rollout"
                      type="range"
                      min={0}
                      max={100}
                      value={rollout}
                      onChange={(e) => setRollout(Number(e.target.value))}
                      className="flex-1 accent-primary"
                    />
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={rollout}
                      onChange={(e) =>
                        setRollout(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                      }
                      className="w-20 text-xs"
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                  <Button size="sm" onClick={saveRollout} disabled={busy}>
                    Save rollout
                  </Button>
                </>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
