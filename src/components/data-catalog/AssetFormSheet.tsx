'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface AssetFormValues {
  name: string;
  source: string;
  kind: string;
  owner: string;
  description: string;
  rowCount: number;
  freshnessSlaHours: number;
}

const KINDS = ['table', 'view', 'stream', 'file', 'collection'];

// Shared create/edit side-panel for a data-asset. POST (create) or PATCH (edit) to the API, then
// refresh. Open/closed state is owned by the caller (URL-driven).
export function AssetFormSheet({
  open,
  onOpenChange,
  title,
  submitLabel,
  submitUrl,
  method,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  submitLabel: string;
  submitUrl: string;
  method: 'POST' | 'PATCH';
  initial: AssetFormValues;
  onSaved: () => void;
}) {
  const [v, setV] = useState<AssetFormValues>(initial);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!v.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(submitUrl, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(v),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'failed');
      toast.success(`${v.name} saved`);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="A dataset in your catalog — where it comes from, who owns it, and its freshness target."
      footer={
        <Button onClick={submit} disabled={busy} className="w-full">
          {busy ? 'Saving…' : submitLabel}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
            placeholder="e.g. Customer master"
          />
        </Field>
        <Field label="Source">
          <Input
            value={v.source}
            onChange={(e) => setV({ ...v, source: e.target.value })}
            placeholder="e.g. Core Bank DB (postgres)"
          />
        </Field>
        <Field label="Kind">
          <select
            value={v.kind}
            onChange={(e) => setV({ ...v, kind: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owner (steward email / team)">
          <Input
            value={v.owner}
            onChange={(e) => setV({ ...v, owner: e.target.value })}
            placeholder="risk-ops@bank.in"
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Row count">
            <Input
              type="number"
              min={0}
              value={v.rowCount}
              onChange={(e) => setV({ ...v, rowCount: Number(e.target.value) })}
            />
          </Field>
          <Field label="Freshness SLA (hours)">
            <Input
              type="number"
              min={0}
              value={v.freshnessSlaHours}
              onChange={(e) => setV({ ...v, freshnessSlaHours: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="Description">
          <Textarea
            value={v.description}
            onChange={(e) => setV({ ...v, description: e.target.value })}
            rows={3}
            placeholder="What this dataset contains and how it's used."
          />
        </Field>
      </div>
    </FormSheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
