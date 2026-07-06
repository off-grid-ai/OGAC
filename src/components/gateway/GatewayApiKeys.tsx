'use client';

import { Copy, Key, Plus, Trash, Warning } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface KeyView {
  id: string;
  clientId: string;
  name: string;
  owner: string;
  scope: string;
  status: 'active' | 'revoked';
  createdAt: string | null;
  lastUsedAt: string | null;
}

// ─── Reveal-once banner ─────────────────────────────────────────────────────────

function NewKeyBanner({ name, apiKey, onDismiss }: { name: string; apiKey: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-4 space-y-2">
      <p className="text-sm font-medium text-foreground">
        Key <code className="font-mono text-primary">{name}</code> created — copy it now.
      </p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Warning className="size-3.5 text-amber-500" />
        This is the only time the secret is shown. Send it as <code className="rounded bg-muted px-1">x-api-key</code> to the gateway.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded border border-border bg-background px-2 py-1.5 font-mono text-xs break-all">
          {apiKey}
        </code>
        <Button size="sm" variant="outline" onClick={copy}>
          <Copy className="size-3.5 mr-1" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        I have saved it
      </Button>
    </div>
  );
}

// ─── Create form ────────────────────────────────────────────────────────────────

function CreateKeyForm({
  onDone,
  onCancel,
}: {
  onDone: (name: string, apiKey: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error('A name is required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/gateway-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), ownerOrg: owner.trim() || undefined }),
      });
      const data = (await res.json()) as { apiKey?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to create key.');
      onDone(name.trim(), data.apiKey ?? '');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">New API key</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input placeholder="Name (e.g. mobile-app)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Input placeholder="Owner org (optional)" value={owner} onChange={(e) => setOwner(e.target.value)} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Each key is backed by its own Keycloak service-account client. Revoking a key disables that
        client, so it stops working at the gateway immediately.
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? 'Creating…' : 'Create key'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ago = (ts: string | null): string => {
  if (!ts) return '—';
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export function GatewayApiKeys() {
  const [keys, setKeys] = useState<KeyView[]>([]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<{ name: string; apiKey: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const res = await fetch('/api/v1/admin/gateway-keys');
      const data = (await res.json()) as { configured?: boolean; keys?: KeyView[]; error?: string };
      if (!res.ok) {
        setApiError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setConfigured(data.configured !== false);
      setKeys(data.keys ?? []);
    } catch {
      setApiError('Failed to reach the gateway-keys API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (k: KeyView) => {
    if (!window.confirm(`Revoke key "${k.name}"? It will stop working at the gateway immediately.`)) return;
    try {
      const res = await fetch(`/api/v1/admin/gateway-keys/${encodeURIComponent(k.id)}?hard=true`, {
        method: 'DELETE',
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to revoke key.');
      toast.success(`Revoked ${k.name}.`);
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Key className="size-4 text-primary" />
          Gateway API keys
        </CardTitle>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)} disabled={!configured}>
            <Plus className="size-3.5 mr-1" />
            New key
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!configured && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-700">
            Keycloak is not configured on this deployment, so Keycloak-backed keys can't be minted.
            Set <code className="rounded bg-muted px-1">OFFGRID_KEYCLOAK_URL</code>,{' '}
            <code className="rounded bg-muted px-1">_REALM</code>, and the admin client env, then reload.
          </div>
        )}

        {showCreate && configured && (
          <CreateKeyForm
            onDone={(name, apiKey) => {
              setShowCreate(false);
              setNewKey({ name, apiKey });
              void load();
            }}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {newKey && <NewKeyBanner name={newKey.name} apiKey={newKey.apiKey} onDismiss={() => setNewKey(null)} />}

        {apiError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
            <span className="font-medium">Error:</span> {apiError}
          </div>
        )}

        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : keys.length === 0 && configured ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No API keys yet — create one to authenticate a client to the gateway.
          </p>
        ) : keys.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm text-foreground">{k.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{k.clientId}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{k.owner}</TableCell>
                  <TableCell>
                    <Badge
                      variant={k.status === 'active' ? 'default' : 'destructive'}
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {k.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {k.createdAt ? new Date(k.createdAt).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{ago(k.lastUsedAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => void revoke(k)}
                      title="Revoke key"
                    >
                      <Trash className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
