'use client';

import { Plus, X } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { ModelBrowser, useModelCatalog } from '@/components/gateway/ModelPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { ModelSpec } from '@/lib/model-catalog';

const ACTIONS = ['local', 'cloud', 'block'] as const;

export function AddRoutingRuleButton() {
  const router = useRouter();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-routing';

  const setOpen = useCallback(
    (next: boolean) => {
      const p = new URLSearchParams(params.toString());
      if (next) p.set('panel', 'new-routing');
      else p.delete('panel');
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  const [name, setName] = useState('');
  const [attribute, setAttribute] = useState('data_class');
  const [value, setValue] = useState('');
  const [action, setAction] = useState<(typeof ACTIONS)[number]>('local');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);

  // The model comes from the curated catalog (reconciled against the live fleet), not free text —
  // so a rule can only target a real, known model id. `block` needs no model, so the picker only
  // shows for local/cloud.
  const { models, loading, error } = useModelCatalog();
  const picked: ModelSpec | undefined = models.find((m) => m.id === model);

  async function create() {
    if (!name.trim() || !value.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/routing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, attribute, operator: 'eq', value, action, model }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Added "${name}"`);
      setName('');
      setValue('');
      setModel('');
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to add rule');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add rule
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add a routing rule</SheetTitle>
            <SheetDescription>
              If a request&apos;s attribute matches, it routes to the chosen target. Cloud is
              leashed by the org egress switch.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="r-name">Name</Label>
                <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="r-attr">Attribute</Label>
                  <Input
                    id="r-attr"
                    value={attribute}
                    onChange={(e) => setAttribute(e.target.value)}
                    placeholder="data_class | task | cost"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="r-val">Equals</Label>
                  <Input
                    id="r-val"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="pii | longcontext | low"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Route to</Label>
                <div className="flex gap-2">
                  {ACTIONS.map((a) => (
                    <Button
                      key={a}
                      type="button"
                      size="sm"
                      variant={action === a ? 'default' : 'outline'}
                      onClick={() => setAction(a)}
                    >
                      {a}
                    </Button>
                  ))}
                </div>
              </div>

              {action !== 'block' ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Model</Label>
                    {picked ? (
                      <button
                        type="button"
                        onClick={() => setModel('')}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                        clear
                      </button>
                    ) : null}
                  </div>
                  {picked ? (
                    <div className="flex items-center justify-between rounded-md border border-primary bg-primary/5 px-3 py-2">
                      <div className="flex flex-col">
                        <span className="font-mono text-xs text-foreground">{picked.id}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {picked.family} · {picked.modality}
                          {picked.contextWindow != null
                            ? ` · ${Math.round(picked.contextWindow / 1024)}K ctx`
                            : ' · ctx unknown'}
                        </span>
                      </div>
                      {picked.servedOnFleet ? (
                        <Badge
                          variant="secondary"
                          className="bg-primary/10 font-mono text-[10px] text-primary"
                        >
                          live
                        </Badge>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Pick a model from the catalog below. Fleet-served models are badged{' '}
                      <span className="font-mono text-primary">live</span>.
                    </p>
                  )}
                  <ModelBrowser
                    models={models}
                    loading={loading}
                    error={error}
                    selectedId={model}
                    onPick={(m) => setModel(m.id)}
                  />
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  A <span className="font-mono">block</span> rule refuses the request — no model
                  needed.
                </p>
              )}
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={create} disabled={busy || !name || !value} className="w-full">
              {busy ? 'Adding…' : 'Add rule'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
