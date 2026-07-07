'use client';

import { LinkSimple, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingBlock, Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Idp {
  alias: string;
  displayName: string;
  providerId: string;
  enabled: boolean;
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
}

function AddOidcIdpForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [alias, setAlias] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  const [tokenUrl, setTokenUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/access/idp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alias,
          displayName: displayName || undefined,
          authorizationUrl,
          tokenUrl,
          clientId,
          clientSecret,
        }),
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to add identity provider.');
      toast.success(`Identity provider "${alias}" added.`);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        New OIDC identity provider
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input placeholder="Alias (required)" value={alias} onChange={(e) => setAlias(e.target.value)} autoFocus />
        <Input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <Input
          placeholder="Authorization URL"
          value={authorizationUrl}
          onChange={(e) => setAuthorizationUrl(e.target.value)}
        />
        <Input placeholder="Token URL" value={tokenUrl} onChange={(e) => setTokenUrl(e.target.value)} />
        <Input placeholder="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
        <Input
          placeholder="Client secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Covers the common OIDC authorization-code case. SAML and advanced mapper config stay in the
        Keycloak admin console.
      </p>
      <div className="flex gap-2">
        <Button size="sm" className="gap-1.5" onClick={submit} disabled={saving}>
          {saving ? (
            <>
              <Spinner /> Adding…
            </>
          ) : (
            'Add provider'
          )}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// Identity-provider federation tab: list + add (OIDC) + delete.
export function IdpList() {
  const [providers, setProviders] = useState<Idp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A 403 whose message names the missing realm-management role → the console's SA lacks the grant.
  // Offer a one-click self-heal (GAP #40) instead of leaving the operator to run kcadm by hand.
  const [grantable, setGrantable] = useState(false);
  const [granting, setGranting] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const fetchIdps = useCallback(async () => {
    setLoading(true);
    setError(null);
    setGrantable(false);
    try {
      const res = await fetch('/api/v1/admin/access/idp');
      const data = (await res.json()) as { providers?: Idp[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setGrantable(res.status === 403 || /realm-management/i.test(data.error ?? ''));
        return;
      }
      setProviders(data.providers ?? []);
    } catch {
      setError('Failed to reach the access API.');
    } finally {
      setLoading(false);
    }
  }, []);

  const grantAccess = useCallback(async () => {
    setGranting(true);
    try {
      const res = await fetch('/api/v1/admin/access/federation/provision', { method: 'POST' });
      const d = (await res.json()) as { ok?: boolean; manualCommand?: string; error?: string };
      if (!res.ok || !d.ok) {
        const msg = d.manualCommand ? `${d.error ?? 'Could not grant access.'}\n\n${d.manualCommand}` : d.error;
        throw new Error(msg ?? 'Could not grant access.');
      }
      toast.success('Federation access granted to the console service-account.');
      await fetchIdps();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGranting(false);
    }
  }, [fetchIdps]);

  useEffect(() => {
    void fetchIdps();
  }, [fetchIdps]);

  const remove = async (idp: Idp) => {
    if (!window.confirm(`Delete identity provider "${idp.alias}"? Federated logins will stop working.`))
      return;
    try {
      const res = await fetch(`/api/v1/admin/access/idp/${encodeURIComponent(idp.alias)}`, {
        method: 'DELETE',
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to delete provider.');
      toast.success(`Deleted "${idp.alias}".`);
      void fetchIdps();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <LinkSimple className="size-4 text-primary" />
          Identity providers
        </CardTitle>
        <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="size-3.5 mr-1" />
          Add OIDC provider
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAdd && (
          <AddOidcIdpForm
            onDone={() => {
              setShowAdd(false);
              void fetchIdps();
            }}
            onCancel={() => setShowAdd(false)}
          />
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
            <div>
              <span className="font-medium">Keycloak error:</span> {error}
            </div>
            {grantable && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 gap-1.5"
                onClick={() => void grantAccess()}
                disabled={granting}
              >
                {granting ? (
                  <>
                    <Spinner /> Granting…
                  </>
                ) : (
                  'Grant access'
                )}
              </Button>
            )}
          </div>
        )}

        {loading ? (
          <LoadingBlock />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alias</TableHead>
                  <TableHead>Display name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                      No identity providers configured.
                    </TableCell>
                  </TableRow>
                ) : (
                  providers.map((p) => (
                    <TableRow key={p.alias}>
                      <TableCell className="font-mono text-xs">{p.alias}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.displayName}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {p.providerId}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.enabled ? 'default' : 'destructive'} className="text-xs">
                          {p.enabled ? 'enabled' : 'disabled'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void remove(p)}
                          title="Delete provider"
                        >
                          <Trash className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
