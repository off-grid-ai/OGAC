'use client';

import { CaretDown as ChevronDown, Plus, Warning } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ReadOnlyGuard } from '@/components/ReadOnlyGuard';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CONNECTOR_TYPES, connectorTypeDef } from '@/lib/connector-policy';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// The create panel's open/closed state lives in the URL (?panel=new-connector) so Back closes it
// and it's deep-linkable — never in local useState.
//
// This is the ONE real create form (the drop-in promise): the user picks a source type and fills the
// fields that type actually needs (SQL: host / port / database / user / password; REST: base URL +
// api key). The password/api key is sent to the server, which writes it to the vault and stores a
// credential-free connector — the secret never lands in the DB or the endpoint string. Types we
// can't query yet are shown but disabled with a "coming soon" note, so no dead connector gets made.
export function AddConnectorButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-connector';

  const [name, setName] = useState('');
  const [type, setType] = useState('postgres');
  // SQL fields
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [database, setDatabase] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  // REST fields
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);

  const def = useMemo(() => connectorTypeDef(type), [type]);
  const family = def?.family ?? 'sql';

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (open) {
      setName('');
      setType('postgres');
      setHost('');
      setPort('');
      setDatabase('');
      setUser('');
      setPassword('');
      setBaseUrl('');
      setApiKey('');
    }
  }, [open]);

  const disabled = busy || def?.status !== 'ready' || !name.trim();

  async function create() {
    if (disabled || !def) return;
    setBusy(true);
    try {
      const payload =
        family === 'sql'
          ? { name, type, host, port, database, user, password }
          : { name, type, baseUrl, apiKey };
      const res = await fetch('/api/v1/admin/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'failed');
      }
      toast.success(`Connector "${name}" added — credential stored in the vault`);
      setPanel(null);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message || 'Failed to add connector');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ReadOnlyGuard>
        <Button size="sm" onClick={() => setPanel('new-connector')}>
          <Plus className="size-4" />
          Add connector
        </Button>
      </ReadOnlyGuard>
      <FormSheet
        open={open}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Add a connector"
        description="Connect a database or an API. Your password stays in the vault — never in plain text."
        footer={
          <Button onClick={create} disabled={disabled} className="w-full">
            {busy ? 'Connecting…' : 'Add connector'}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="con-name">Name</Label>
            <Input
              id="con-name"
              value={name}
              placeholder="Core Banking (Postgres)"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Source type</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal">
                  {def?.label ?? type}
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                {CONNECTOR_TYPES.map((t) => (
                  <DropdownMenuItem
                    key={t.type}
                    disabled={t.status !== 'ready'}
                    onClick={() => t.status === 'ready' && setType(t.type)}
                  >
                    <span>{t.label}</span>
                    {t.status !== 'ready' ? (
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                        soon
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {def?.status !== 'ready' ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <Warning className="mt-0.5 size-4 shrink-0" />
              <span>{def?.note ?? 'This source type is not available yet.'}</span>
            </div>
          ) : family === 'sql' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="con-host">Host</Label>
                  <Input
                    id="con-host"
                    value={host}
                    placeholder="db.internal.acme.co"
                    onChange={(e) => setHost(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="con-port">Port</Label>
                  <Input
                    id="con-port"
                    value={port}
                    placeholder={String(def?.defaultPort ?? '')}
                    inputMode="numeric"
                    onChange={(e) => setPort(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="con-db">Database</Label>
                <Input
                  id="con-db"
                  value={database}
                  placeholder="corebank"
                  onChange={(e) => setDatabase(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="con-user">Username</Label>
                  <Input
                    id="con-user"
                    value={user}
                    placeholder="reader"
                    autoComplete="off"
                    onChange={(e) => setUser(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="con-pass">Password</Label>
                  <Input
                    id="con-pass"
                    type="password"
                    value={password}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The password is written to the secrets vault and referenced by the connector — it is
                never stored in plain text.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="con-url">Base URL</Label>
                <Input
                  id="con-url"
                  value={baseUrl}
                  placeholder="https://api.acme.co/v1"
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="con-key">API key / token (optional)</Label>
                <Input
                  id="con-key"
                  type="password"
                  value={apiKey}
                  placeholder="Leave blank for a public API"
                  autoComplete="new-password"
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                If provided, the API key is stored in the secrets vault and sent as a Bearer token —
                never stored in plain text.
              </p>
            </div>
          )}
        </div>
      </FormSheet>
    </>
  );
}
