'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Provider-pool management for the gateway: the set of model deployments LiteLLM routes across —
// on-prem fleet + cloud. Config-file models are the fixed base; deployments added here are DB-managed
// (validated /model/new transactions) and removable. Mounts on the Routing view. Never shows API keys.

interface PoolRow {
  id: string;
  modelName: string;
  upstreamModel: string;
  apiBase: string | null;
  dbManaged: boolean;
}

const EMPTY = { modelName: '', provider: 'openai', model: '', apiBase: '', apiKey: '' };

export function GatewayProviderPool() {
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/gateway/models', { cache: 'no-store' });
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const j = (await res.json()) as { data?: PoolRow[] };
      setRows(j.data ?? []);
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

  async function add() {
    if (busy || !form.modelName.trim() || !form.model.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/gateway/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error || `add failed (${res.status})`);
      toast.success(`Added ${form.modelName} to the routing pool`);
      setForm(EMPTY);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: PoolRow) {
    if (!row.dbManaged || !row.id) return;
    if (!confirm(`Remove ${row.modelName} from the routing pool?`)) return;
    try {
      const res = await fetch(`/api/v1/admin/gateway/models/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error || `remove failed (${res.status})`);
      toast.success(`Removed ${row.modelName}`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Provider pool</CardTitle>
        <CardDescription className="text-xs">
          The model deployments the gateway routes across — on-prem fleet + cloud. Add a deployment to
          publish it into routing; on-prem base models are fixed, added ones are removable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-6">
          <Input
            className="sm:col-span-2"
            placeholder="routing name (e.g. cloud/gpt-4o-mini)"
            value={form.modelName}
            onChange={(e) => setForm({ ...form, modelName: e.target.value })}
          />
          <select
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
            className="h-10 rounded-md border border-border bg-background px-2 text-sm"
          >
            {['openai', 'anthropic', 'gemini', 'openai-compatible', 'hosted_vllm', 'onprem'].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <Input
            placeholder="upstream model id"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
          <Input
            placeholder="api base (compatible)"
            value={form.apiBase}
            onChange={(e) => setForm({ ...form, apiBase: e.target.value })}
          />
          <Input
            type="password"
            placeholder="api key (cloud)"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={add} disabled={busy || !form.modelName.trim() || !form.model.trim()}>
            {busy ? 'Adding…' : 'Add to pool'}
          </Button>
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Routing name</TableHead>
              <TableHead>Upstream</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id || r.modelName}>
                <TableCell className="font-medium">{r.modelName}</TableCell>
                <TableCell className="text-muted-foreground">{r.upstreamModel}</TableCell>
                <TableCell className="text-muted-foreground">{r.apiBase ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={r.dbManaged ? 'secondary' : 'outline'}>
                    {r.dbManaged ? 'added' : 'base'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {r.dbManaged && r.id ? (
                    <Button variant="ghost" size="sm" onClick={() => remove(r)}>
                      Remove
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">fixed</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  No model deployments yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
