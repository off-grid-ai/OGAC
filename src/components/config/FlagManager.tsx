'use client';

import { Plus, SlidersHorizontal, Trash } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toggleMessage } from '@/lib/toast-messages';
import { FlagDetailPanel } from './FlagDetailPanel';

interface Flag {
  key: string;
  enabled: boolean;
  description: string;
}

// Feature-flag management surface. Runtime toggles that gate capabilities without a redeploy
// (e.g. agent-code-exec, online-evals). Full CRUD: list, create-with-description, toggle, delete —
// all driving the /admin/flags routes. When Unleash is configured the routes drive the Unleash
// Admin API (variants + gradual rollout available via the detail panel); otherwise the first-party
// store. The open flag detail is a navigational position, so it lives in ?flag=<key>.
export function FlagManager({ forcedOpen = false }: { forcedOpen?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get('flag');

  const [flags, setFlags] = useState<Flag[]>([]);
  const [backend, setBackend] = useState<'unleash' | 'native'>('native');
  const [environment, setEnvironment] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/admin/flags', { cache: 'no-store' });
      const d = (await r.json()) as {
        data?: Flag[];
        backend?: 'unleash' | 'native';
        environment?: string | null;
      };
      setFlags(d.data ?? []);
      setBackend(d.backend ?? 'native');
      setEnvironment(d.environment ?? null);
    } catch {
      /* keep last snapshot */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = useCallback(
    (key: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (key) next.set('flag', key);
      else next.delete('flag');
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, router],
  );

  async function toggle(key: string, enabled: boolean) {
    setFlags((cur) => cur.map((f) => (f.key === key ? { ...f, enabled } : f)));
    const res = await fetch('/api/v1/admin/flags', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, enabled }),
    });
    if (res.ok) {
      toast.success(toggleMessage(key, enabled, 'Flag'));
    } else {
      toast.error('Toggle failed');
      load();
    }
  }

  async function create() {
    if (!newKey.trim() || busy) return;
    setBusy(true);
    const res = await fetch('/api/v1/admin/flags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: newKey.trim(), enabled: true, description: newDesc }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Flag "${newKey.trim()}" created`);
      setNewKey('');
      setNewDesc('');
      load();
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(d.error ?? 'Create failed');
    }
  }

  async function remove(key: string) {
    setBusy(true);
    const res = await fetch(`/api/v1/admin/flags/${encodeURIComponent(key)}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) {
      toast.success(backend === 'unleash' ? `Flag "${key}" archived` : `Flag "${key}" deleted`);
      if (selected === key) openDetail(null);
      load();
    } else {
      toast.error('Delete failed');
    }
  }

  return (
    <>
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">Feature flags</CardTitle>
            <Badge
              variant="secondary"
              className={backend === 'unleash' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}
            >
              {backend === 'unleash' ? `Unleash · ${environment ?? 'env'}` : 'first-party store'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Runtime toggles that gate capabilities without a redeploy. Flipping one takes effect on
            the next request.
            {backend === 'unleash'
              ? ' Managed in Unleash — open a flag to edit variants and gradual rollout.'
              : ' Set OFFGRID_UNLEASH_URL + an admin token to manage variants and gradual rollout.'}
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {forcedOpen ? (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-primary">All capabilities are ON for this instance.</span>{' '}
              <code>OFFGRID_FLAGS_OPEN=true</code> forces every gate open, so the toggles below are
              ignored at runtime — nothing is gated. Unset it to enforce per-flag state.
            </div>
          ) : null}
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
            <div className="space-y-1">
              <Label htmlFor="flag-key" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                New flag key
              </Label>
              <Input
                id="flag-key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="agent-code-exec"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="flag-desc" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Description
              </Label>
              <Input
                id="flag-desc"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="what this gates"
                className="text-xs"
              />
            </div>
            <Button onClick={create} disabled={busy || !newKey.trim()} className="gap-1.5">
              <Plus className="size-4" />
              Add flag
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-20">State</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : flags.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                    No feature flags yet. Add one above.
                  </TableCell>
                </TableRow>
              ) : (
                flags.map((f) => (
                  <TableRow key={f.key}>
                    <TableCell className="font-mono text-xs text-foreground">{f.key}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {f.description || '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={f.enabled}
                          onCheckedChange={(v) => toggle(f.key, v)}
                          aria-label={`Toggle ${f.key}`}
                        />
                        <Badge
                          variant="secondary"
                          className={f.enabled ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}
                        >
                          {f.enabled ? 'on' : 'off'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-primary"
                          onClick={() => openDetail(f.key)}
                          aria-label={`Edit ${f.key}`}
                        >
                          <SlidersHorizontal className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          onClick={() => remove(f.key)}
                          disabled={busy}
                          aria-label={`Delete ${f.key}`}
                        >
                          <Trash className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selected ? (
        <FlagDetailPanel
          flagKey={selected}
          backend={backend}
          environment={environment}
          onClose={() => openDetail(null)}
          onChanged={load}
        />
      ) : null}
    </>
  );
}
