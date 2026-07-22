'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
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
import type { DatasetDetail } from '@/lib/adapters/langfuse-datasets';
import type { DatasetItemView } from '@/lib/langfuse-datasets';

type Tab = 'items' | 'runs';
const emptyForm = { id: '', input: '', expectedOutput: '', metadata: '', status: 'ACTIVE' };

// Per-dataset lifecycle: items (create/edit/delete) + experiment runs. The active tab + the item
// being edited are URL-driven (?tab=, ?edit=) so Back is coherent.
export function LangfuseDatasetDetail({ name }: { name: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get('tab') as Tab) === 'runs' ? 'runs' : 'items';
  const editId = params.get('edit') ?? '';
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/admin/observability/datasets/${encodeURIComponent(name)}`, { cache: 'no-store' });
    const j = (await res.json()) as { configured?: boolean; detail?: DatasetDetail | null; error?: string };
    setConfigured(j.configured !== false);
    setDetail(j.detail ?? null);
    setError(j.error ?? '');
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  // When ?edit points at an item, hydrate the form from it (URL-driven edit target).
  useEffect(() => {
    if (!editId || !detail) return;
    const it = detail.items.find((i) => i.id === editId);
    if (it) setForm({ id: it.id, input: it.input, expectedOutput: it.expectedOutput, metadata: it.metadata, status: it.status });
  }, [editId, detail]);

  const setParam = (k: string, v: string | null) => {
    const qs = new URLSearchParams(params.toString());
    if (v === null) qs.delete(k);
    else qs.set(k, v);
    router.replace(`?${qs}`, { scroll: false });
  };

  function resetForm() {
    setForm({ ...emptyForm });
    setParam('edit', null);
  }

  async function saveItem() {
    if (busy || !form.input.trim()) return;
    setBusy(true);
    try {
      const editing = Boolean(form.id);
      const url = editing
        ? `/api/v1/admin/observability/datasets/${encodeURIComponent(name)}/items/${encodeURIComponent(form.id)}`
        : `/api/v1/admin/observability/datasets/${encodeURIComponent(name)}/items`;
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: form.input,
          expectedOutput: form.expectedOutput || undefined,
          metadata: form.metadata || undefined,
          status: form.status,
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || `save failed (${res.status})`);
      toast.success(editing ? 'Item updated' : 'Item added');
      resetForm();
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm(`Delete item ${id}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/observability/datasets/${encodeURIComponent(name)}/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || `delete failed (${res.status})`);
      toast.success('Item deleted');
      if (editId === id) resetForm();
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function editItem(it: DatasetItemView) {
    setParam('edit', it.id);
  }

  if (!configured) {
    return <Card className="shadow-sm"><CardContent className="py-6 text-center text-sm text-muted-foreground">Langfuse isn&apos;t configured on this deployment.</CardContent></Card>;
  }
  if (!detail) {
    return <Card className="shadow-sm"><CardContent className="py-6 text-center text-sm text-muted-foreground">{error || 'Dataset not found.'}</CardContent></Card>;
  }

  return (
    <div className="w-full space-y-4">
      {detail.dataset.description ? (
        <p className="text-sm text-muted-foreground">{detail.dataset.description}</p>
      ) : null}
      <div className="flex gap-2 border-b border-border">
        {(['items', 'runs'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setParam('tab', t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t === 'items' ? `Items (${detail.items.length})` : `Runs (${detail.runs.length})`}
          </button>
        ))}
      </div>

      {tab === 'items' ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="h-fit shadow-sm lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{form.id ? `Edit item` : 'New item'}</CardTitle>
              <CardDescription className="text-xs">{form.id ? <span className="font-mono">{form.id}</span> : 'Input + expected output.'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Input (JSON or text)</Label>
                <Textarea rows={4} value={form.input} onChange={(e) => setForm({ ...form, input: e.target.value })} className="font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Expected output</Label>
                <Textarea rows={3} value={form.expectedOutput} onChange={(e) => setForm({ ...form, expectedOutput: e.target.value })} className="font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Metadata (JSON object)</Label>
                <Input value={form.metadata} onChange={(e) => setForm({ ...form, metadata: e.target.value })} className="h-9 font-mono" placeholder='{ "lang": "en" }' />
              </div>
              <div className="flex items-center gap-2">
                {(['ACTIVE', 'ARCHIVED'] as const).map((s) => (
                  <Button key={s} type="button" size="sm" variant={form.status === s ? 'default' : 'outline'} onClick={() => setForm({ ...form, status: s })}>{s}</Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={saveItem} disabled={busy || !form.input.trim()} className="flex-1">{form.id ? 'Update' : 'Add item'}</Button>
                {form.id ? <Button size="sm" variant="outline" onClick={resetForm}>Cancel</Button> : null}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Items</CardTitle>
              <CardDescription className="text-xs">{error ? <span className="text-destructive">{error}</span> : `${detail.items.length} item(s)`}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Input</TableHead>
                      <TableHead>Expected</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-28 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((it) => (
                      <TableRow key={it.id} className={it.id === editId ? 'bg-muted/50' : ''}>
                        <TableCell className="max-w-xs truncate font-mono text-xs">{it.input}</TableCell>
                        <TableCell className="max-w-xs truncate font-mono text-xs">{it.expectedOutput || '—'}</TableCell>
                        <TableCell><Badge variant={it.status === 'ACTIVE' ? 'default' : 'secondary'} className="text-[10px]">{it.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          <button onClick={() => editItem(it)} className="mr-2 text-xs text-primary hover:underline">edit</button>
                          <button onClick={() => deleteItem(it.id)} className="text-xs text-destructive hover:underline">del</button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {detail.items.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">No items yet.</TableCell></TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Experiment runs</CardTitle>
            <CardDescription className="text-xs">Executions of an experiment against this dataset (created by eval runs).</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.description || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{r.createdAt?.slice(0, 19).replace('T', ' ')}</TableCell>
                    </TableRow>
                  ))}
                  {detail.runs.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground">No runs yet — run an experiment against this dataset to populate this.</TableCell></TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
