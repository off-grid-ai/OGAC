'use client';

import { useCallback, useEffect, useState } from 'react';
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

// Virtual-key governance for the gateway (LiteLLM DB-backed FinOps): create keys with a $ budget +
// RPM/TPM caps, see live spend/utilization, edit limits, revoke. Mounts on the Routing view beside
// the deployment/health panel. Talks to the console's admin key routes (which proxy LiteLLM /key/*).

interface KeyRow {
  token: string;
  keyAlias: string | null;
  spend: number;
  maxBudget: number | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  models: string[];
  overBudget: boolean;
  budgetPct: number | null;
}

const EMPTY = { keyAlias: '', maxBudget: '', rpmLimit: '', tpmLimit: '' };

export function GatewayVirtualKeys() {
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/gateway/keys', { cache: 'no-store' });
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const j = (await res.json()) as { data?: KeyRow[] };
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

  const numOrUndef = (s: string): number | undefined => {
    const t = s.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  };

  const create = useCallback(async () => {
    setBusy(true);
    setNewKey(null);
    try {
      const res = await fetch('/api/v1/admin/gateway/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keyAlias: form.keyAlias.trim() || undefined,
          maxBudget: numOrUndef(form.maxBudget),
          rpmLimit: numOrUndef(form.rpmLimit),
          tpmLimit: numOrUndef(form.tpmLimit),
        }),
      });
      const j = (await res.json()) as { key?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? `create failed (${res.status})`);
      setNewKey(j.key ?? null);
      setForm(EMPTY);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [form, load]);

  const remove = useCallback(
    async (token: string) => {
      if (!confirm(`Revoke key ${token}? This cannot be undone.`)) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/v1/admin/gateway/keys/${encodeURIComponent(token)}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(`revoke failed (${res.status})`);
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const editBudget = useCallback(
    async (token: string, current: number | null) => {
      const raw = prompt('New monthly budget (USD). Blank = unbounded.', current == null ? '' : String(current));
      if (raw === null) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/v1/admin/gateway/keys/${encodeURIComponent(token)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ maxBudget: raw.trim() === '' ? null : Number(raw) }),
        });
        if (!res.ok) throw new Error(`update failed (${res.status})`);
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  return (
    <Card className="mt-6 shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Virtual keys &amp; budgets</CardTitle>
            <CardDescription className="text-xs">
              Per-key spend budgets and RPM/TPM limits, enforced by the gateway. {rows.length} key
              {rows.length === 1 ? '' : 's'}.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {newKey ? (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
            <p className="text-xs font-medium">New key created — copy it now, it is shown once:</p>
            <code className="mt-1 block break-all font-mono text-xs">{newKey}</code>
          </div>
        ) : null}

        {/* create form */}
        <div className="grid gap-2 sm:grid-cols-5">
          <Input
            placeholder="alias (e.g. team-tax)"
            value={form.keyAlias}
            onChange={(e) => setForm({ ...form, keyAlias: e.target.value })}
          />
          <Input
            placeholder="budget $"
            inputMode="decimal"
            value={form.maxBudget}
            onChange={(e) => setForm({ ...form, maxBudget: e.target.value })}
          />
          <Input
            placeholder="RPM"
            inputMode="numeric"
            value={form.rpmLimit}
            onChange={(e) => setForm({ ...form, rpmLimit: e.target.value })}
          />
          <Input
            placeholder="TPM"
            inputMode="numeric"
            value={form.tpmLimit}
            onChange={(e) => setForm({ ...form, tpmLimit: e.target.value })}
          />
          <Button size="sm" disabled={busy} onClick={() => void create()}>
            Create key
          </Button>
        </div>

        {/* key list */}
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {loading ? 'Loading…' : 'No virtual keys yet — create one above to govern spend + rate.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alias</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead className="text-right">Spend / Budget</TableHead>
                  <TableHead className="text-right">RPM</TableHead>
                  <TableHead className="text-right">TPM</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.token}>
                    <TableCell className="font-medium">{r.keyAlias ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.token}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      ${r.spend.toFixed(2)} /{' '}
                      {r.maxBudget == null ? (
                        <span className="text-muted-foreground">∞</span>
                      ) : (
                        <>
                          ${r.maxBudget.toFixed(2)}{' '}
                          <Badge
                            variant={r.overBudget ? 'destructive' : 'secondary'}
                            className="ml-1"
                          >
                            {r.budgetPct}%
                          </Badge>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.rpmLimit ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.tpmLimit ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void editBudget(r.token, r.maxBudget)}
                        >
                          Budget
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void remove(r.token)}
                        >
                          Revoke
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
