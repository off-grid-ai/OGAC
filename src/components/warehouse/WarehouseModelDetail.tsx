'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Version {
  version: number;
  definition: { selectSql?: string } & Record<string, unknown>;
  applyDdl: string[];
  note: string | null;
  createdAt: string;
}
interface ModelDetail {
  id: string;
  name: string;
  database: string | null;
  kind: string;
  currentVersion: number;
  versions: Version[];
}

export function WarehouseModelDetail({ id }: Readonly<{ id: string }>) {
  const router = useRouter();
  const [model, setModel] = useState<ModelDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/warehouse/models/${id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const j = (await res.json()) as { model: ModelDetail };
      setModel(j.model);
      setEdit(j.model.versions.find((v) => v.version === j.model.currentVersion)?.definition.selectSql ?? '');
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveEdit() {
    if (busy || !edit.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/warehouse/models/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ definition: { selectSql: edit.trim() } }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || `edit failed (${res.status})`);
      toast.success('New version applied to ClickHouse');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rollback(version: number) {
    if (!confirm(`Roll back to v${version}? Its DDL re-applies as the live definition.`)) return;
    try {
      const res = await fetch(`/api/v1/admin/warehouse/models/${id}/rollback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || `rollback failed (${res.status})`);
      toast.success(`Rolled back to v${version}`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove() {
    if (!confirm('Delete this model? The object is dropped from ClickHouse.')) return;
    try {
      const res = await fetch(`/api/v1/admin/warehouse/models/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
      toast.success('Model deleted + object dropped');
      router.push('/data/warehouse/models');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!model) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="shadow-sm lg:col-span-2">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">{model.name}</CardTitle>
            <Button variant="ghost" size="sm" onClick={remove} className="text-destructive">
              Delete
            </Button>
          </div>
          <CardDescription className="text-xs">
            {model.database ?? '—'} · {model.kind} · live v{model.currentVersion}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="text-xs text-muted-foreground">Definition (edit → new version, applied live)</label>
          <textarea
            value={edit}
            onChange={(e) => setEdit(e.target.value)}
            rows={5}
            className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs"
          />
          <div className="flex justify-end">
            <Button onClick={saveEdit} disabled={busy || !edit.trim()}>
              {busy ? 'Applying…' : 'Save new version'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Version history</CardTitle>
          <CardDescription className="text-xs">Immutable snapshots — roll any prior one back.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {model.versions.map((v) => (
            <div key={v.version} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <div className="flex items-center gap-2 text-sm">
                  v{v.version}
                  {v.version === model.currentVersion ? <Badge variant="secondary">live</Badge> : null}
                </div>
                <div className="text-[11px] text-muted-foreground">{v.note ?? '—'}</div>
              </div>
              {v.version !== model.currentVersion ? (
                <Button variant="outline" size="sm" onClick={() => rollback(v.version)}>
                  Roll back
                </Button>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
