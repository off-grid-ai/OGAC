'use client';

import { LinkSimple, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { providerTypeLabel, summarizeFederation } from '@/lib/keycloak-federation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingBlock, Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
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

const tabClass = (active: boolean) =>
  `rounded-md px-3 py-1 text-xs font-medium transition-colors ${
    active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
  }`;

// Add an identity provider — OIDC (authorization-code) OR SAML v2. Both post to the same route; the
// server validates + builds the rep via the pure builders (buildOidcIdpRep / buildSamlIdpRep).
function AddIdpForm({ onDone, onCancel }: Readonly<{ onDone: () => void; onCancel: () => void }>) {
  const [type, setType] = useState<'oidc' | 'saml'>('oidc');
  const [alias, setAlias] = useState('');
  const [displayName, setDisplayName] = useState('');
  // OIDC
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  const [tokenUrl, setTokenUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  // SAML
  const [singleSignOnServiceUrl, setSingleSignOnServiceUrl] = useState('');
  const [entityId, setEntityId] = useState('');
  const [singleLogoutServiceUrl, setSingleLogoutServiceUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const body =
        type === 'saml'
          ? {
              type: 'saml',
              alias,
              displayName: displayName || undefined,
              singleSignOnServiceUrl,
              entityId: entityId || undefined,
              singleLogoutServiceUrl: singleLogoutServiceUrl || undefined,
            }
          : {
              type: 'oidc',
              alias,
              displayName: displayName || undefined,
              authorizationUrl,
              tokenUrl,
              clientId,
              clientSecret,
            };
      const res = await fetch('/api/v1/admin/access/idp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          New identity provider
        </p>
        <div className="ml-auto flex gap-1">
          <button type="button" className={tabClass(type === 'oidc')} onClick={() => setType('oidc')}>
            OIDC
          </button>
          <button type="button" className={tabClass(type === 'saml')} onClick={() => setType('saml')}>
            SAML 2.0
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input placeholder="Alias (required)" value={alias} onChange={(e) => setAlias(e.target.value)} autoFocus />
        <Input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        {type === 'oidc' ? (
          <>
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
          </>
        ) : (
          <>
            <Input
              placeholder="Single sign-on URL (required)"
              value={singleSignOnServiceUrl}
              onChange={(e) => setSingleSignOnServiceUrl(e.target.value)}
            />
            <Input
              placeholder="SP entity ID (optional)"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            />
            <Input
              placeholder="Single logout URL (optional)"
              value={singleLogoutServiceUrl}
              onChange={(e) => setSingleLogoutServiceUrl(e.target.value)}
            />
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {type === 'oidc'
          ? 'Covers the common OIDC authorization-code case (persistent import, JWKS discovery).'
          : 'SAML v2 POST-binding with a persistent NameID. Signing certificates and attribute mappers stay in your IdP console.'}
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

  const toggleEnabled = async (idp: Idp, enabled: boolean) => {
    try {
      const res = await fetch(`/api/v1/admin/access/idp/${encodeURIComponent(idp.alias)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to update provider.');
      toast.success(`"${idp.alias}" ${enabled ? 'enabled' : 'disabled'}.`);
      void fetchIdps();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // Federation posture at a glance — pure rollup over the normalized list.
  const summary = useMemo(() => summarizeFederation(providers), [providers]);

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <LinkSimple className="size-4 text-primary" />
          Identity providers
        </CardTitle>
        <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="size-3.5 mr-1" />
          Add provider
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!loading && !error && providers.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-md border border-border px-2.5 py-1 text-muted-foreground">
              <span className="font-mono text-foreground">{summary.total}</span> configured
            </span>
            <span className="rounded-md border border-border px-2.5 py-1 text-muted-foreground">
              <span className="font-mono text-foreground">{summary.enabled}</span> enabled
            </span>
            {summary.disabled > 0 && (
              <span className="rounded-md border border-border px-2.5 py-1 text-muted-foreground">
                <span className="font-mono text-foreground">{summary.disabled}</span> disabled
              </span>
            )}
            {summary.byType.map((t) => (
              <span key={t.providerId} className="rounded-md border border-border px-2.5 py-1 text-muted-foreground">
                {t.label}: <span className="font-mono text-foreground">{t.count}</span>
              </span>
            ))}
          </div>
        )}

        {showAdd && (
          <AddIdpForm
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
              <span className="font-medium">Identity provider error:</span> {error}
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
                        <Badge variant="secondary" className="text-xs">
                          {providerTypeLabel(p.providerId)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={p.enabled}
                            onCheckedChange={(v) => void toggleEnabled(p, v)}
                            aria-label={`${p.enabled ? 'Disable' : 'Enable'} ${p.alias}`}
                          />
                          <span className="text-xs text-muted-foreground">
                            {p.enabled ? 'enabled' : 'disabled'}
                          </span>
                        </div>
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
