'use client';

import { FolderSimple, Key, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
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
import { type SecretKeyRow, validateKeyPath } from '@/lib/secret-keys';

// Secret-KEY management surface. Full CRUD over key NAMES via /api/v1/admin/secrets:
//   list (names only) · write (value is WRITE-ONLY — typed once, sent, never rendered back) · delete.
//
// SAFETY: this component never fetches, stores in state, or renders a secret VALUE. The value input
// is a password field, its state is cleared immediately after a successful write, and the GET
// response carries only key names — there is no code path that could display secret material.
//
// The "add" panel open/closed state is a navigational position, so it lives in the URL (?add=1)
// driven by the parent page; this component just receives it and reports changes via onToggleAdd.
export function SecretsManager({
  configured,
  sealed,
  addOpen,
  onToggleAdd,
}: {
  configured: boolean;
  sealed: boolean;
  addOpen: boolean;
  onToggleAdd: (open: boolean) => void;
}) {
  const [keys, setKeys] = useState<SecretKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  // Value is write-only: held transiently only while typing, cleared on submit. Never populated
  // from any server response.
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/secrets');
      const json = (await res.json()) as { keys?: SecretKeyRow[] };
      setKeys(Array.isArray(json.keys) ? json.keys : []);
    } catch {
      toast.error('Failed to load secret keys.');
    } finally {
      setLoading(false);
    }
  }, [configured]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    const v = validateKeyPath(newKey);
    if (!v.ok) {
      toast.error(v.error ?? 'Invalid key path.');
      return;
    }
    if (!newValue) {
      toast.error('A value is required.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/secrets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: v.key, value: newValue }),
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Write failed.');
      toast.success(`Stored "${v.key}" in OpenBao.`);
      setNewKey('');
      setNewValue(''); // clear write-only value immediately
      onToggleAdd(false);
      void refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (key: string) => {
    if (!window.confirm(`Delete secret "${key}"? This soft-deletes the latest version in OpenBao.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/secrets?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Delete failed.');
      toast.success(`Deleted "${key}".`);
      void refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-4 text-xs text-muted-foreground">
          OpenBao is not configured — set <span className="font-mono">OFFGRID_OPENBAO_URL</span>{' '}
          (token <span className="font-mono">OFFGRID_OPENBAO_TOKEN</span>, mount{' '}
          <span className="font-mono">OFFGRID_OPENBAO_MOUNT</span>) to store and manage
          connector/tool credentials in the KV vault.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Key className="size-4 text-primary" />
          Secret keys
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            {keys.length}
          </Badge>
        </CardTitle>
        <Button size="sm" onClick={() => onToggleAdd(!addOpen)} disabled={sealed}>
          <Plus className="mr-1 size-3.5" />
          Add secret
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {sealed && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Vault is sealed — writes and deletes are disabled until it is unsealed by an operator.
          </p>
        )}

        {addOpen && !sealed && (
          <form
            className="space-y-3 rounded-md border border-border bg-muted/30 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Write secret (value is stored write-only — it is never shown back)
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Key path
                </label>
                <Input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="e.g. connector.slack.token"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Value (write-only)
                </label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="secret material"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" type="submit" disabled={busy}>
                {busy ? 'Storing…' : 'Store secret'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => {
                  onToggleAdd(false);
                  setNewKey('');
                  setNewValue('');
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-xs text-muted-foreground">
                      No secrets stored in this mount yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  keys.map((k) => (
                    <TableRow key={k.key}>
                      <TableCell className="font-mono text-xs text-foreground">
                        {k.folder ? (
                          <span className="inline-flex items-center gap-1.5">
                            <FolderSimple className="size-3.5 text-muted-foreground" />
                            {k.key}
                          </span>
                        ) : (
                          k.key
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-muted-foreground">
                          {k.folder ? 'folder' : 'secret'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {k.folder ? (
                          <span className="text-[10px] text-muted-foreground">namespace</span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={busy || sealed}
                            onClick={() => void remove(k.key)}
                            title="Delete secret"
                          >
                            <Trash className="size-3.5" />
                          </Button>
                        )}
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
