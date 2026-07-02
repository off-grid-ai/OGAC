'use client';

import {
  Copy,
  Eye,
  EyeSlash,
  Plus,
  Robot,
  Trash,
} from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface KcClient {
  id: string;
  clientId: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  serviceAccountsEnabled?: boolean;
}

// ─── Add client form ──────────────────────────────────────────────────────────

function AddClientForm({
  onDone,
  onCancel,
}: {
  onDone: (secret: string, clientId: string) => void;
  onCancel: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [serviceAccount, setServiceAccount] = useState(true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!clientId.trim()) {
      toast.error('Client ID is required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/access/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientId.trim(),
          name: name.trim() || undefined,
          description: description.trim() || undefined,
          serviceAccountsEnabled: serviceAccount,
        }),
      });
      const data = (await res.json()) as { secret?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to create client.');
      onDone(data.secret ?? '', clientId.trim());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">New client</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          placeholder="Client ID (required)"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="font-mono"
          autoFocus
        />
        <Input
          placeholder="Display name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="sm:col-span-2"
        />
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={serviceAccount}
          onChange={(e) => setServiceAccount(e.target.checked)}
          className="accent-primary"
        />
        Enable service account (client_credentials grant)
      </label>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? 'Creating…' : 'Create client'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Secret newly-created modal ───────────────────────────────────────────────

function NewSecretBanner({
  clientId,
  secret,
  onDismiss,
}: {
  clientId: string;
  secret: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-4 space-y-2">
      <p className="text-sm font-medium text-foreground">
        Client <code className="font-mono text-primary">{clientId}</code> created — save this secret
        now.
      </p>
      <p className="text-xs text-muted-foreground">
        This secret will not be shown again. Store it in a secrets manager before closing.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded border border-border bg-background px-2 py-1.5 font-mono text-xs break-all">
          {secret}
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

// ─── Expanded client row ──────────────────────────────────────────────────────

// eslint-disable-next-line complexity
function ExpandedClient({ client }: { client: KcClient }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loadingSecret, setLoadingSecret] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);

  const keycloakUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-keycloak';

  const reveal = async () => {
    if (secret) {
      setRevealed(true);
      return;
    }
    setLoadingSecret(true);
    try {
      const res = await fetch(`/api/v1/admin/access/clients/${client.id}/secret`);
      const data = (await res.json()) as { secret?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to fetch secret.');
      setSecret(data.secret ?? '');
      setRevealed(true);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingSecret(false);
    }
  };

  const rotate = async () => {
    if (!window.confirm('Rotate client secret? The current secret will stop working immediately.')) return;
    setRotating(true);
    try {
      const res = await fetch(`/api/v1/admin/access/clients/${client.id}/secret`, {
        method: 'POST',
      });
      const data = (await res.json()) as { secret?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to rotate secret.');
      setSecret(data.secret ?? '');
      setRevealed(true);
      toast.success('Secret rotated. Update all consumers now.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRotating(false);
    }
  };

  const copy = () => {
    if (!secret) return;
    void navigator.clipboard.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const curlExample = `curl -s -X POST \\
  "${keycloakUrl}/realms/<realm>/protocol/openid-connect/token" \\
  -d "grant_type=client_credentials" \\
  -d "client_id=${client.clientId}" \\
  -d "client_secret=<secret>" \\
  | jq -r '.access_token'`;

  return (
    <div className="space-y-4 py-2">
      <div className="grid gap-1 text-xs text-muted-foreground">
        <div>
          <span className="text-foreground font-medium">Client ID</span>
          <span className="ml-2 font-mono text-foreground">{client.clientId}</span>
        </div>
        <div>
          <span className="text-foreground font-medium">Internal ID</span>
          <span className="ml-2 font-mono">{client.id}</span>
        </div>
      </div>

      {/* Secret section */}
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Client secret
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Input
              type={revealed ? 'text' : 'password'}
              value={secret ?? '••••••••••••••••'}
              readOnly
              className="font-mono text-xs pr-8"
            />
            <button
              type="button"
              onClick={() => (revealed ? setRevealed(false) : void reveal())}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={loadingSecret}
            >
              {revealed ? <EyeSlash className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
          {revealed && secret && (
            <Button size="sm" variant="outline" onClick={copy} title="Copy secret">
              <Copy className="size-3.5 mr-1" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={rotate} disabled={rotating}>
            {rotating ? 'Rotating…' : 'Rotate'}
          </Button>
        </div>
      </div>

      {/* How to use */}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
          How to get a token
        </summary>
        <pre className="mt-2 overflow-x-auto rounded border border-border bg-background p-3 font-mono text-[11px] text-foreground">
          {curlExample}
        </pre>
      </details>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MachineClientsList() {
  const [clients, setClients] = useState<KcClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newSecret, setNewSecret] = useState<{ clientId: string; secret: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const res = await fetch('/api/v1/admin/access/clients');
      const data = (await res.json()) as { clients?: KcClient[]; error?: string };
      if (!res.ok) {
        setApiError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setClients(data.clients ?? []);
    } catch {
      setApiError('Failed to reach the access API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchClients();
  }, [fetchClients]);

  const deleteClient = async (client: KcClient) => {
    if (!window.confirm(`Delete client "${client.clientId}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/v1/admin/access/clients/${client.id}`, { method: 'DELETE' });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to delete client.');
      toast.success(`Deleted ${client.clientId}.`);
      void fetchClients();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Robot className="size-4 text-primary" />
          Machine Clients
        </CardTitle>
        <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="size-3.5 mr-1" />
          New client
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAdd && (
          <AddClientForm
            onDone={(secret, clientId) => {
              setShowAdd(false);
              setNewSecret({ secret, clientId });
              void fetchClients();
            }}
            onCancel={() => setShowAdd(false)}
          />
        )}

        {newSecret && (
          <NewSecretBanner
            clientId={newSecret.clientId}
            secret={newSecret.secret}
            onDismiss={() => setNewSecret(null)}
          />
        )}

        {apiError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
            <span className="font-medium">Keycloak error:</span> {apiError}
            {apiError === 'forbidden' && (
              <span className="ml-1 text-muted-foreground">
                — the service account needs <code className="rounded bg-muted px-1">view-clients</code> under realm-management in Keycloak.
              </span>
            )}
          </div>
        )}

        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Service account</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                      No clients yet — create one to authenticate machines and services.
                    </TableCell>
                  </TableRow>
                ) : (
                  clients.map((c) => {
                    const isOpen = expandedId === c.id;
                    return (
                      <>
                        <TableRow
                          key={c.id}
                          className="cursor-pointer"
                          onClick={() => setExpandedId(isOpen ? null : c.id)}
                        >
                          <TableCell className="font-mono text-xs">
                            {isOpen ? '▾ ' : '▸ '}
                            {c.clientId}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {c.name || '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={c.enabled ? 'default' : 'destructive'} className="text-xs">
                              {c.enabled ? 'enabled' : 'disabled'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {c.serviceAccountsEnabled ? (
                              <Badge variant="secondary" className="text-xs">yes</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">no</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                void deleteClient(c);
                              }}
                              title="Delete client"
                            >
                              <Trash className="size-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow key={`${c.id}-expanded`}>
                            <TableCell colSpan={5} className="bg-muted/30">
                              <ExpandedClient client={c} />
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
