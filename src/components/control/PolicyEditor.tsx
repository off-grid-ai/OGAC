'use client';

import { Plus, FloppyDisk as Save, X } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { PolicyBundle } from '@/lib/store';

function ChipList({
  label,
  hint,
  items,
  onChange,
}: {
  label: string;
  hint: string;
  items: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    const v = draft.trim();
    if (v && !items.includes(v)) onChange([...items, v]);
    setDraft('');
  }

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground/80">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item} variant="secondary" className="gap-1">
            {item}
            <button
              type="button"
              aria-label={`Remove ${item}`}
              onClick={() => onChange(items.filter((i) => i !== item))}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={`Add ${label.toLowerCase()}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          className="h-8"
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function PolicyEditor({ initial }: { initial: PolicyBundle }) {
  const router = useRouter();
  const [egress, setEgress] = useState(initial.egressAllowed);
  const [guardrails, setGuardrails] = useState(initial.guardrails);
  const [models, setModels] = useState(initial.allowedModels);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(initial.version);

  async function publish() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/policy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ egressAllowed: egress, guardrails, allowedModels: models }),
      });
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setVersion(data.version);
      toast.success(`Policy published · v${data.version}`);
      router.refresh();
    } catch {
      toast.error('Failed to publish policy');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="space-y-0">
        <div className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Policy · v{version}</CardTitle>
          <Button size="sm" onClick={publish} disabled={busy}>
            <Save className="size-4" />
            {busy ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          The org-wide policy every enrolled node enforces. Set it here → <strong>Publish</strong>{' '}
          bumps the version → nodes converge on their next poll. See Handbook → How-tos.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
          <div>
            <p className="text-sm text-foreground">Egress to cloud</p>
            <p className="text-xs text-muted-foreground">
              Allow leashed cloud-model calls off-device.
            </p>
          </div>
          <Switch checked={egress} onCheckedChange={setEgress} aria-label="Toggle cloud egress" />
        </div>
        <ChipList
          label="Guardrails"
          hint="Checks run on every request, e.g. pii-input · injection-scan · grounding. Type one and press Enter."
          items={guardrails}
          onChange={setGuardrails}
        />
        <ChipList
          label="Allowed models"
          hint="Models nodes may use, e.g. gemma-local · whisper-local. Anything not listed is blocked."
          items={models}
          onChange={setModels}
        />
      </CardContent>
    </Card>
  );
}
