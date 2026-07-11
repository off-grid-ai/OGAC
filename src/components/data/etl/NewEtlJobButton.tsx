'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { defaultDag } from '@/lib/etl-job';

// Create a new ETL job with just a name, then open its visual builder (list→detail). The job starts
// as a two-node source→destination DAG the operator configures on the detail page — so the create
// step is a quick modal (allowed for a create form), and the real authoring happens in the builder.
export function NewEtlJobButton({ hasConnectors }: Readonly<{ hasConnectors: boolean }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) {
      toast.error('Give the job a name.');
      return;
    }
    setBusy(true);
    try {
      // Seed with a default (unconfigured) source→destination DAG. The server derives the flat fields
      // from the DAG and persists it as-authored — the operator configures + runs it in the builder.
      const res = await fetch('/api/v1/admin/etl/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), dag: defaultDag() }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        toast.error(b.error ?? 'Could not create the job.');
        return;
      }
      const job = (await res.json()) as { id: string };
      router.push(`/data/etl/${job.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 size-4" />
        New ETL job
      </Button>
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title="New ETL job"
        description="You'll build the source → transforms → destination visually on the next screen."
        footer={
          <Button onClick={create} disabled={busy}>
            {busy ? 'Creating…' : 'Create + open builder'}
          </Button>
        }
      >
        <div className="space-y-2">
          <Label htmlFor="etl-name">Job name</Label>
          <Input
            id="etl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nightly customers → warehouse"
            autoFocus
          />
          {!hasConnectors ? (
            <p className="text-xs text-amber-600">
              You have no source connectors yet — add one under Connectors first, or create the job and
              connect a source later.
            </p>
          ) : null}
        </div>
      </FormSheet>
    </>
  );
}
