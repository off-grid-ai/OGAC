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
import { LoadingBlock, Spinner } from '@/components/ui/spinner';
import { MODULES } from '@/modules/registry';

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
  const [roleName, setRoleName] = useState('');
  const [modules, setModules] = useState<string[]>([]);
  const [customRoles, setCustomRoles] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/v1/admin/roles');
        if (r.ok) setCustomRoles(((await r.json()) as { roles?: { id: string; name: string }[] }).roles ?? []);
      } catch { /* roles optional */ }
    })();
  }, []);

  const toggleModule = (id: string) =>
    setModules((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

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
          roleName: roleName || undefined,
          modules: modules.length ? modules : undefined,
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

      {/* ── Scope (RBAC/ABAC): pick a role AND/OR tick services this token may access ── */}
      {serviceAccount && (
        <div className="space-y-2 rounded-md border border-border bg-background/60 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Scope — what this token can access
          </p>
          {customRoles.length > 0 && (
            <label className="block text-xs text-muted-foreground">
              Custom role
              <select
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                <option value="">— none (use services below) —</option>
                {customRoles.map((r) => (
                  <option key={r.id} value={r.name}>{r.name}</option>
                ))}
              </select>
            </label>
          )}
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Or grant specific services:</p>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {MODULES.filter((m) => !m.internal).map((m) => (
                <label key={m.id} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={modules.includes(m.id)}
                    onChange={() => toggleModule(m.id)}
                    className="accent-primary"
                    disabled={!!roleName}
                  />
                  {m.label}
                </label>
              ))}
            </div>
            {roleName && <p className="mt-1 text-[10px] text-muted-foreground">Using the custom role above — clear it to pick services.</p>}
            {!roleName && !modules.length && (
              <p className="mt-1 text-[10px] text-amber-600">No scope selected → token defaults to viewer (read-only).</p>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" className="gap-1.5" onClick={submit} disabled={saving}>
          {saving ? (
            <>
              <Spinner /> Creating…
            </>
          ) : (
            'Create client'
          )}
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

  const keycloakUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-identity-provider';

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
          <Button size="sm" variant="outline" className="gap-1.5" onClick={rotate} disabled={rotating}>
            {rotating ? (
              <>
                <Spinner /> Rotating…
              </>
            ) : (
              'Rotate'
            )}
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
            <span className="font-medium">Identity provider error:</span> {apiError}
            {apiError === 'forbidden' && (
              <span className="ml-1 text-muted-foreground">
                — the service account needs <code className="rounded bg-muted px-1">view-clients</code> under realm-management in your identity provider.
              </span>
            )}
          </div>
        )}

        {loading ? (
          <LoadingBlock />
        ) : clients.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No clients yet — create one to authenticate machines and services.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {clients.map((c) => {
                const isOpen = expandedId === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setExpandedId(isOpen ? null : c.id)}
                    className={`flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors ${
                      isOpen ? 'border-primary bg-primary/5' : 'border-border bg-background hover:border-primary/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate font-mono text-xs font-medium text-foreground">{c.clientId}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="Delete client"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        title="Delete client"
                        onClick={(e) => { e.stopPropagation(); void deleteClient(c); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            void deleteClient(c);
                          }
                        }}
                      >
                        <Trash className="size-3.5" />
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">{c.name || '—'}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <Badge variant={c.enabled ? 'default' : 'destructive'} className="px-1 py-0 text-[10px]">
                        {c.enabled ? 'enabled' : 'disabled'}
                      </Badge>
                      {c.serviceAccountsEnabled && (
                        <Badge variant="secondary" className="px-1 py-0 text-[10px]">service account</Badge>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            {/* Expanded detail — full width below the grid */}
            {(() => {
              const c = clients.find((x) => x.id === expandedId);
              if (!c) return null;
              return (
                <div className="rounded-lg border border-primary/30 bg-muted/30 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-sm font-medium text-foreground">{c.clientId}</span>
                    <Button size="sm" variant="ghost" onClick={() => setExpandedId(null)}>Close</Button>
                  </div>
                  <ExpandedClient client={c} />
                </div>
              );
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
