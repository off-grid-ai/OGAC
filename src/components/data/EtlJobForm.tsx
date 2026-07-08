'use client';

import { Plus, Trash, PencilSimple } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  ColumnMapping,
  EtlJobDraft,
  EtlJobSpec,
  EtlTriggerMode,
} from '@/lib/etl-job';
import type { RedactionAction } from '@/lib/data-redaction';
import { validateJobDraft } from '@/lib/etl-job';
import { cn } from '@/lib/utils';

// The ONE create/edit form for an ETL job. Same component powers "New ETL job" (mode=create, a button
// that opens the panel) and "Edit" on the detail page (mode=edit, seeded with the job). Validation is
// the PURE validateJobDraft — the exact rule the server runs — so errors surface before the round-trip.
// Source is picked from the operator's connectors; resources are fetched live from the chosen
// connector (with graceful fallback to manual entry). Redaction is per-mapping-column, reusing the
// governance vocabulary. Nav is driven by the button's own open state (a quick create/edit panel is
// an allowed modal per the IA rule — the job itself is a real detail page).

const ACTIONS: { value: RedactionAction; label: string }[] = [
  { value: 'keep', label: 'Keep' },
  { value: 'mask', label: 'Mask (keep last 4)' },
  { value: 'hash', label: 'Hash (join-safe)' },
  { value: 'tokenize', label: 'Tokenize' },
  { value: 'drop', label: 'Drop' },
  { value: 'detect', label: 'Detect PII + redact' },
];

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface ConnectorOption {
  id: string;
  name: string;
  type: string;
}

export function EtlJobForm({
  connectors,
  mode,
  job,
}: {
  connectors: ConnectorOption[];
  mode: 'create' | 'edit';
  job?: EtlJobSpec;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [sourceConnectorId, setSourceConnectorId] = useState(connectors[0]?.id ?? '');
  const [sourceResource, setSourceResource] = useState('');
  const [destDatabase, setDestDatabase] = useState('warehouse');
  const [destTable, setDestTable] = useState('');
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [trigger, setTrigger] = useState<EtlTriggerMode>('manual');
  const [cron, setCron] = useState('0 * * * *');
  const [rowLimit, setRowLimit] = useState('1000');
  const [resources, setResources] = useState<string[]>([]);

  // Seed from the job on open (edit) or reset to blanks (create).
  const seed = useCallback(() => {
    if (mode === 'edit' && job) {
      setName(job.name);
      setSourceConnectorId(job.sourceConnectorId);
      setSourceResource(job.sourceResource);
      setDestDatabase(job.destDatabase);
      setDestTable(job.destTable);
      setMappings(job.mappings ?? []);
      setTrigger(job.trigger);
      setCron(job.cron ?? '0 * * * *');
      setRowLimit(String(job.rowLimit ?? 1000));
    } else {
      setName('');
      setSourceConnectorId(connectors[0]?.id ?? '');
      setSourceResource('');
      setDestDatabase('warehouse');
      setDestTable('');
      setMappings([]);
      setTrigger('manual');
      setCron('0 * * * *');
      setRowLimit('1000');
    }
  }, [mode, job, connectors]);

  useEffect(() => {
    if (open) seed();
  }, [open, seed]);

  // Fetch the source connector's resources (tables) so the operator picks instead of hand-typing.
  useEffect(() => {
    if (!open || !sourceConnectorId) {
      setResources([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/admin/connectors/${sourceConnectorId}/resources`);
        const body = (await res.json().catch(() => ({}))) as { resources?: string[] };
        if (!cancelled) setResources(Array.isArray(body.resources) ? body.resources : []);
      } catch {
        if (!cancelled) setResources([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sourceConnectorId]);

  const draft: EtlJobDraft = {
    name,
    sourceConnectorId,
    sourceResource,
    destDatabase,
    destTable,
    mappings,
    trigger,
    cron: trigger === 'schedule' ? cron : undefined,
    rowLimit: Number(rowLimit) || undefined,
  };
  const validation = validateJobDraft(draft);

  function addMapping() {
    setMappings((m) => [...m, { source: '', dest: '', action: 'keep' }]);
  }
  function updateMapping(i: number, patch: Partial<ColumnMapping>) {
    setMappings((m) => m.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function removeMapping(i: number) {
    setMappings((m) => m.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (!validation.ok) {
      toast.error(validation.errors[0]);
      return;
    }
    setBusy(true);
    try {
      const url = mode === 'edit' && job ? `/api/v1/admin/etl/jobs/${job.id}` : '/api/v1/admin/etl/jobs';
      const res = await fetch(url, {
        method: mode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) {
        toast.error(body.error || 'Could not save the job');
        return;
      }
      toast.success(mode === 'edit' ? 'Job updated' : 'Job created');
      setOpen(false);
      if (mode === 'create' && body.id) {
        router.push(`/data/etl/${body.id}`);
      } else {
        router.refresh();
      }
    } catch {
      toast.error('Could not save the job');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant={mode === 'edit' ? 'outline' : 'default'} onClick={() => setOpen(true)}>
        {mode === 'edit' ? <PencilSimple className="size-4" /> : <Plus className="size-4" />}
        {mode === 'edit' ? 'Edit' : 'New ETL job'}
      </Button>

      <FormSheet
        open={open}
        onOpenChange={setOpen}
        size="lg"
        title={mode === 'edit' ? 'Edit ETL job' : 'New ETL job'}
        description="Move data from a connected source into a warehouse table, redacting sensitive columns on the way."
        footer={
          <Button onClick={submit} disabled={busy || !validation.ok} className="w-full">
            {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create job'}
          </Button>
        }
      >
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="etl-name">Job name</Label>
            <Input
              id="etl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Loans → warehouse"
            />
          </div>

          <fieldset className="space-y-3 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Source</legend>
            <div className="space-y-1.5">
              <Label htmlFor="etl-conn">Connector</Label>
              <select
                id="etl-conn"
                className={SELECT_CLASS}
                value={sourceConnectorId}
                onChange={(e) => setSourceConnectorId(e.target.value)}
              >
                {connectors.length === 0 ? <option value="">No connectors available</option> : null}
                {connectors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="etl-resource">Table / resource</Label>
              {resources.length > 0 ? (
                <select
                  id="etl-resource"
                  className={SELECT_CLASS}
                  value={sourceResource}
                  onChange={(e) => setSourceResource(e.target.value)}
                >
                  <option value="">Select a table…</option>
                  {resources.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id="etl-resource"
                  value={sourceResource}
                  onChange={(e) => setSourceResource(e.target.value)}
                  placeholder="table name or REST collection"
                />
              )}
            </div>
          </fieldset>

          <fieldset className="grid grid-cols-2 gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Destination</legend>
            <div className="space-y-1.5">
              <Label htmlFor="etl-db">Warehouse database</Label>
              <Input id="etl-db" value={destDatabase} onChange={(e) => setDestDatabase(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="etl-table">Table</Label>
              <Input
                id="etl-table"
                value={destTable}
                onChange={(e) => setDestTable(e.target.value)}
                placeholder="loans"
              />
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              Column mapping & redaction
            </legend>
            <p className="text-[11px] text-muted-foreground">
              Leave empty to copy every column as-is. Add rows to rename columns or redact sensitive
              values on the movement path.
            </p>
            {mappings.map((m, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-[10px]">Source col</Label>
                  <Input
                    value={m.source}
                    onChange={(e) => updateMapping(i, { source: e.target.value })}
                    placeholder="pan"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-[10px]">Dest col</Label>
                  <Input
                    value={m.dest ?? ''}
                    onChange={(e) => updateMapping(i, { dest: e.target.value })}
                    placeholder="(same)"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-[10px]">Redaction</Label>
                  <select
                    className={cn(SELECT_CLASS, 'h-9')}
                    value={m.action ?? 'keep'}
                    onChange={(e) => updateMapping(i, { action: e.target.value as RedactionAction })}
                  >
                    {ACTIONS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeMapping(i)}
                  aria-label="Remove mapping"
                >
                  <Trash className="size-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={addMapping}>
              <Plus className="size-4" />
              Add column
            </Button>
          </fieldset>

          <fieldset className="space-y-3 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Schedule</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={trigger === 'manual'}
                  onChange={() => setTrigger('manual')}
                />
                Manual (run on demand)
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={trigger === 'schedule'}
                  onChange={() => setTrigger('schedule')}
                />
                On a schedule
              </label>
            </div>
            {trigger === 'schedule' ? (
              <div className="space-y-1.5">
                <Label htmlFor="etl-cron">Cron (min hour dom mon dow)</Label>
                <Input
                  id="etl-cron"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 * * * *"
                  className="font-mono"
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="etl-limit">Row limit per run</Label>
              <Input
                id="etl-limit"
                type="number"
                value={rowLimit}
                onChange={(e) => setRowLimit(e.target.value)}
              />
            </div>
          </fieldset>

          {!validation.ok ? (
            <ul className="space-y-1 rounded-md bg-destructive/5 p-2 text-[11px] text-destructive">
              {validation.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </FormSheet>
    </>
  );
}
