'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import type { DatasetRow } from '@/lib/langfuse-datasets';

// Langfuse datasets — create + list, rows link to a deep detail page (items + runs). Governed writes
// hit the admin observability routes.
export function LangfuseDatasetsManager() {
  const [configured, setConfigured] = useState(true);
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [metadata, setMetadata] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/v1/admin/observability/datasets', { cache: 'no-store' });
    const j = (await res.json()) as { configured?: boolean; datasets?: DatasetRow[]; error?: string };
    setConfigured(j.configured !== false);
    setDatasets(j.datasets ?? []);
    setError(j.error ?? '');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/observability/datasets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, metadata: metadata.trim() || undefined }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || `create failed (${res.status})`);
      toast.success(`Dataset "${name.trim()}" created`);
      setName('');
      setDescription('');
      setMetadata('');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Langfuse isn&apos;t configured on this deployment yet (no Langfuse endpoint / project keys).
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="h-fit shadow-sm lg:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">New dataset</CardTitle>
          <CardDescription className="text-xs">A named collection of test cases.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input placeholder="kyc-golden-set" value={name} onChange={(e) => setName(e.target.value)} className="h-9 font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Input placeholder="Verified KYC extraction cases" value={description} onChange={(e) => setDescription(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Metadata (JSON object, optional)</Label>
            <Textarea rows={3} placeholder='{ "owner": "risk-ops" }' value={metadata} onChange={(e) => setMetadata(e.target.value)} className="font-mono text-xs" />
          </div>
          <Button size="sm" onClick={create} disabled={busy || !name.trim()} className="w-full">Create dataset</Button>
        </CardContent>
      </Card>

      <Card className="shadow-sm lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Datasets</CardTitle>
          <CardDescription className="text-xs">
            {error ? <span className="text-destructive">{error}</span> : 'Click a dataset to manage items + view experiment runs.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {datasets.map((d) => (
                  <TableRow key={d.name} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <Link href={`/insights/ai/langfuse-datasets/${encodeURIComponent(d.name)}`} className="text-primary hover:underline">
                        {d.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.description || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{d.createdAt?.slice(0, 10)}</TableCell>
                  </TableRow>
                ))}
                {datasets.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground">No datasets yet.</TableCell></TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
