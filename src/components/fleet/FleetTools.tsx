'use client';

import { Bug, Play, Plus, Trash, X } from '@phosphor-icons/react/dist/ssr';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { FleetPolicy, LiveQueryResult } from '@/lib/fleetdm';

export interface FleetHostOption {
  id: string;
  name: string;
}

const TABS = ['live-query', 'policies'] as const;
type TabValue = (typeof TABS)[number];

// The FleetDM operator surface — live osquery + policy CRUD. URL-driven tabs (Back-coherent,
// deep-linkable). Create/edit is an inline side-by-side panel, not a modal; delete is a confirm.
export function FleetTools({
  hosts,
  supported,
}: Readonly<{
  hosts: FleetHostOption[];
  supported: boolean;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = (params.get('tools') as TabValue) ?? 'live-query';
  const active = TABS.includes(current) ? current : 'live-query';

  const onChange = (value: string): void => {
    const next = new URLSearchParams(params.toString());
    next.set('tools', value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  if (!supported) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Fleet tools</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Live osquery, software/CVE inventory, and FleetDM policies require a FleetDM backend. Set{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">OFFGRID_ADAPTER_MDM=fleetdm</code>{' '}
          and <code className="rounded bg-muted px-1 py-0.5 text-xs">OFFGRID_FLEET_URL</code> /{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">OFFGRID_FLEET_TOKEN</code> to enable
          them. The native device registry has no osquery agent.
        </CardContent>
      </Card>
    );
  }

  return (
    <Tabs value={active} onValueChange={onChange}>
      <TabsList>
        <TabsTrigger value="live-query">Live query</TabsTrigger>
        <TabsTrigger value="policies">Policies</TabsTrigger>
      </TabsList>
      <TabsContent value="live-query" className="space-y-4">
        <LiveQueryPanel hosts={hosts} />
      </TabsContent>
      <TabsContent value="policies" className="space-y-4">
        <PoliciesPanel />
      </TabsContent>
    </Tabs>
  );
}

// ── Live query ──────────────────────────────────────────────────────────────────
function LiveQueryPanel({ hosts }: Readonly<{ hosts: FleetHostOption[] }>) {
  const [sql, setSql] = useState('SELECT name, version FROM os_version;');
  const [selected, setSelected] = useState<Set<string>>(new Set(hosts.map((h) => h.id)));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<LiveQueryResult | null>(null);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/v1/admin/fleet/live-query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: sql, hostIds: [...selected].map(Number) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'live query failed');
      setResult(data as LiveQueryResult);
      toast.success(`${data.respondedHosts}/${data.targetedHosts} hosts responded`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const columns = result?.rows.length
    ? Array.from(new Set(result.rows.flatMap((r) => Object.keys(r.columns))))
    : [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="shadow-sm lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">osquery live query</CardTitle>
          <p className="text-xs text-muted-foreground">
            Runs an ad-hoc read-only SELECT across selected hosts in real time via FleetDM.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            className="font-mono text-xs"
            rows={4}
            aria-label="osquery SQL"
          />
          <Button onClick={run} disabled={running || selected.size === 0} size="sm">
            <Play className="size-4" />
            {running ? 'Running…' : `Run on ${selected.size} host${selected.size === 1 ? '' : 's'}`}
          </Button>
          {result ? (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {result.respondedHosts}/{result.targetedHosts} responded · {result.status}
              </div>
              {result.rows.length ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Host</TableHead>
                        {columns.map((c) => (
                          <TableHead key={c}>{c}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.rows.map((r, i) => (
                        <TableRow key={`${r.hostId}-${i}`}>
                          <TableCell className="text-muted-foreground">
                            {r.hostName ?? r.hostId}
                          </TableCell>
                          {columns.map((c) => (
                            <TableCell key={c} className="font-mono text-xs">
                              {r.columns[c] ?? ''}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">No rows returned.</p>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Target hosts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {hosts.length ? (
            hosts.map((h) => (
              <label key={h.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(h.id)}
                  onChange={() => toggle(h.id)}
                  className="size-4 accent-primary"
                />
                <span className="text-foreground">{h.name}</span>
                <span className="text-xs text-muted-foreground">#{h.id}</span>
              </label>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No hosts enrolled.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Policies ──────────────────────────────────────────────────────────────────
type PolicyForm = {
  id?: number;
  name: string;
  query: string;
  description: string;
  resolution: string;
  platform: string;
  critical: boolean;
};

const EMPTY_FORM: PolicyForm = {
  name: '',
  query: 'SELECT 1 FROM osquery_info;',
  description: '',
  resolution: '',
  platform: '',
  critical: false,
};

function PoliciesPanel() {
  const [policies, setPolicies] = useState<FleetPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<PolicyForm | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/fleet/policies');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'failed to load policies');
      setPolicies(data.policies as FleetPolicy[]);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const editing = form.id != null;
      const res = await fetch(
        editing ? `/api/v1/admin/fleet/policies/${form.id}` : '/api/v1/admin/fleet/policies',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: form.name,
            query: form.query,
            description: form.description || undefined,
            resolution: form.resolution || undefined,
            platform: form.platform || undefined,
            critical: form.critical,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'save failed');
      toast.success(editing ? 'Policy updated' : 'Policy created');
      setForm(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: FleetPolicy) {
    if (!window.confirm(`Delete policy "${p.name}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/v1/admin/fleet/policies/${p.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'delete failed');
      }
      toast.success('Policy deleted');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="shadow-sm lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">FleetDM policies</CardTitle>
          <Button size="sm" onClick={() => setForm({ ...EMPTY_FORM })}>
            <Plus className="size-4" />
            New policy
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : policies.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Policy</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Passing</TableHead>
                  <TableHead>Failing</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-foreground">
                      <button
                        type="button"
                        className="text-left hover:text-primary"
                        onClick={() =>
                          setForm({
                            id: p.id,
                            name: p.name,
                            query: p.query,
                            description: p.description,
                            resolution: p.resolution,
                            platform: p.platform,
                            critical: p.critical,
                          })
                        }
                      >
                        {p.name}
                        {p.critical ? (
                          <Badge variant="secondary" className="ml-2 bg-destructive/10 text-destructive">
                            critical
                          </Badge>
                        ) : null}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.platform || 'all'}</TableCell>
                    <TableCell className="text-primary">{p.passingHostCount}</TableCell>
                    <TableCell className="text-destructive">{p.failingHostCount}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${p.name}`}
                        onClick={() => remove(p)}
                      >
                        <Trash className="size-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No policies yet.</p>
          )}
        </CardContent>
      </Card>

      {form ? (
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">{form.id != null ? 'Edit policy' : 'New policy'}</CardTitle>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setForm(null)}>
              <X className="size-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Name</Label>
              <Input
                id="p-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-query">osquery (SELECT — a host passes when it returns a row)</Label>
              <Textarea
                id="p-query"
                value={form.query}
                onChange={(e) => setForm({ ...form, query: e.target.value })}
                className="font-mono text-xs"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-platform">Platform (blank = all)</Label>
              <Input
                id="p-platform"
                placeholder="darwin,windows,linux"
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-resolution">Resolution</Label>
              <Textarea
                id="p-resolution"
                value={form.resolution}
                onChange={(e) => setForm({ ...form, resolution: e.target.value })}
                rows={2}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="p-critical">Critical</Label>
              <Switch
                id="p-critical"
                checked={form.critical}
                onCheckedChange={(v) => setForm({ ...form, critical: v })}
              />
            </div>
            <Button onClick={save} disabled={saving} className="w-full">
              {saving ? 'Saving…' : form.id != null ? 'Update policy' : 'Create policy'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <Bug className="size-6" />
            Select a policy to edit, or create one.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
