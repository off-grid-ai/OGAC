'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

// Analytical-model management (warehouse → models): create a governed view/materialized-view/table
// over the warehouse (the DDL is applied LIVE to ClickHouse), and drill into each for versions +
// apply/rollback/delete. List → deep-linkable detail; the write actions hit the admin warehouse routes.
interface ModelRow {
  id: string;
  name: string;
  database: string | null;
  kind: string;
  currentVersion: number;
}

const KINDS = ['view', 'materialized_view', 'table'] as const;

export function WarehouseModelsManager() {
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'view', database: 'offgrid_warehouse', selectSql: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/warehouse/models', { cache: 'no-store' });
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const j = (await res.json()) as { models?: ModelRow[] };
      setRows(j.models ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (busy || !form.name.trim() || !form.selectSql.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/warehouse/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          kind: form.kind,
          database: form.database.trim() || undefined,
          definition: { selectSql: form.selectSql.trim() },
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || `create failed (${res.status})`);
      toast.success(`Model "${form.name}" created + DDL applied`);
      setForm({ name: '', kind: 'view', database: 'offgrid_warehouse', selectSql: '' });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="shadow-sm lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Analytical models</CardTitle>
          <CardDescription className="text-xs">
            Governed views + tables over the warehouse. Creating one applies the DDL live to ClickHouse
            and freezes v1; each edit is a new version and rollback re-applies an older one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
          <div className="divide-y divide-border rounded-md border border-border">
            {rows.map((m) => (
              <Link
                key={m.id}
                href={`/data/warehouse/models/${m.id}`}
                className="flex items-center justify-between px-3 py-2.5 hover:bg-muted/40"
              >
                <div>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.database ?? '—'} · {m.kind}
                  </div>
                </div>
                <Badge variant="secondary">v{m.currentVersion}</Badge>
              </Link>
            ))}
            {!loading && rows.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No analytical models yet — create one to materialize a governed view over the warehouse.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">New model</CardTitle>
          <CardDescription className="text-xs">Applied live to ClickHouse on save.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="name (e.g. claims_daily)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="h-10 rounded-md border border-border bg-background px-2 text-sm"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <Input
              placeholder="database"
              value={form.database}
              onChange={(e) => setForm({ ...form, database: e.target.value })}
            />
          </div>
          <textarea
            placeholder="SELECT … (read-only query)"
            value={form.selectSql}
            onChange={(e) => setForm({ ...form, selectSql: e.target.value })}
            rows={4}
            className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs"
          />
          <Button
            onClick={create}
            disabled={busy || !form.name.trim() || !form.selectSql.trim()}
            className="w-full"
          >
            {busy ? 'Applying…' : 'Create + apply'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
