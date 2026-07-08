'use client';

import {
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  FolderSimple,
  Key,
  Plus,
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
import { type SecretKeyRow, validateKeyPath } from '@/lib/secret-keys';
import type { SecretVersionsView } from '@/lib/secrets-ops';

// Secret-KEY management surface. Full CRUD over key NAMES via /api/v1/admin/secrets plus KV v2
// versioning/rotation via /api/v1/admin/secrets/versions:
//   list (names only) · write · delete · expand → version history · rotate · destroy old versions.
//
// SAFETY: this component never fetches, stores in state, or renders a secret VALUE. Values are typed
// into write-only password fields, cleared after submit; every GET returns names / version metadata
// only — there is no code path that could display secret material.
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
  const [expanded, setExpanded] = useState<string | null>(null);

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
      toast.success(`Stored "${v.key}" in the secrets store.`);
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
    if (
      !window.confirm(
        `Delete secret "${key}"? This soft-deletes the latest version in the secrets store.`,
      )
    ) {
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
          The secrets store is not configured — set{' '}
          <span className="font-mono">OFFGRID_OPENBAO_URL</span> (token{' '}
          <span className="font-mono">OFFGRID_OPENBAO_TOKEN</span>, mount{' '}
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
                    <SecretRow
                      key={k.key}
                      row={k}
                      sealed={sealed}
                      busy={busy}
                      expanded={expanded === k.key}
                      onToggle={() =>
                        setExpanded((prev) => (prev === k.key ? null : k.key))
                      }
                      onRemove={() => void remove(k.key)}
                    />
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

// A single key row plus, when expanded, its inline KV v2 version history + rotate/destroy controls.
function SecretRow({
  row,
  sealed,
  busy,
  expanded,
  onToggle,
  onRemove,
}: {
  row: SecretKeyRow;
  sealed: boolean;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  if (row.folder) {
    return (
      <TableRow>
        <TableCell className="font-mono text-xs text-foreground">
          <span className="inline-flex items-center gap-1.5">
            <FolderSimple className="size-3.5 text-muted-foreground" />
            {row.key}
          </span>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className="text-muted-foreground">
            folder
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          <span className="text-[10px] text-muted-foreground">namespace</span>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-xs text-foreground">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1.5 hover:text-primary"
            title="Show version history"
          >
            {expanded ? (
              <CaretDown className="size-3.5 text-muted-foreground" />
            ) : (
              <CaretRight className="size-3.5 text-muted-foreground" />
            )}
            {row.key}
          </button>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className="text-muted-foreground">
            secret
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={busy || sealed}
            onClick={onRemove}
            title="Delete secret (soft-delete latest version)"
          >
            <Trash className="size-3.5" />
          </Button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={3} className="bg-muted/20 p-0">
            <VersionPanel keyPath={row.key} sealed={sealed} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// eslint-disable-next-line complexity
function VersionPanel({ keyPath, sealed }: { keyPath: string; sealed: boolean }) {
  const [data, setData] = useState<SecretVersionsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateValue, setRotateValue] = useState('');
  const [destroyOld, setDestroyOld] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/admin/secrets/versions?key=${encodeURIComponent(keyPath)}`,
      );
      const json = (await res.json()) as { versions?: SecretVersionsView; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to load versions.');
      setData(json.versions ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [keyPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const versionAction = async (
    body: Record<string, unknown>,
    ok: string,
  ): Promise<void> => {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/secrets/versions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: keyPath, ...body }),
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Action failed.');
      toast.success(ok);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!rotateValue) {
      toast.error('A new value is required to rotate.');
      return;
    }
    const priorActive = (data?.versions ?? [])
      .filter((v) => v.state === 'active' && !v.current)
      .map((v) => v.version);
    await versionAction(
      {
        action: 'rotate',
        value: rotateValue,
        destroyPrior: destroyOld ? priorActive : [],
      },
      `Rotated "${keyPath}" to a new version${destroyOld ? ' and destroyed prior versions' : ''}.`,
    );
    setRotateValue('');
    setRotateOpen(false);
    setDestroyOld(false);
  };

  const destroy = async (version: number) => {
    if (
      !window.confirm(
        `Permanently DESTROY version ${version} of "${keyPath}"? This is irreversible — the material is gone forever.`,
      )
    ) {
      return;
    }
    await versionAction({ action: 'destroy', versions: [version] }, `Destroyed version ${version}.`);
  };

  const undelete = async (version: number) => {
    await versionAction({ action: 'undelete', versions: [version] }, `Recovered version ${version}.`);
  };

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Version history{' '}
          {data && (
            <>
              · current v{data.currentVersion ?? '—'} · keeps{' '}
              {data.maxVersions && data.maxVersions > 0 ? data.maxVersions : '10 (default)'}
            </>
          )}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={sealed || busy}
          onClick={() => setRotateOpen((o) => !o)}
        >
          <ArrowsClockwise className="mr-1 size-3.5" />
          Rotate
        </Button>
      </div>

      {rotateOpen && !sealed && (
        <form
          className="space-y-2 rounded-md border border-border bg-background p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void rotate();
          }}
        >
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            New value (write-only)
          </label>
          <Input
            type="password"
            autoComplete="new-password"
            value={rotateValue}
            onChange={(e) => setRotateValue(e.target.value)}
            placeholder="new secret material"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={destroyOld}
              onChange={(e) => setDestroyOld(e.target.checked)}
            />
            Also permanently destroy prior versions (irreversible)
          </label>
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={busy}>
              {busy ? 'Rotating…' : 'Rotate secret'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => {
                setRotateOpen(false);
                setRotateValue('');
                setDestroyOld(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="py-2 text-center text-xs text-muted-foreground">Loading versions…</p>
      ) : !data || data.versions.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">No version metadata.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            <tr className="border-b border-border">
              <th className="py-1 pr-4 font-medium">Version</th>
              <th className="py-1 pr-4 font-medium">Created</th>
              <th className="py-1 pr-4 font-medium">State</th>
              <th className="py-1 pr-4 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.versions.map((v) => (
              <VersionRow
                key={v.version}
                v={v}
                disabled={sealed || busy}
                onUndelete={() => void undelete(v.version)}
                onDestroy={() => void destroy(v.version)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const STATE_CLASS: Record<SecretVersionsView['versions'][number]['state'], string> = {
  destroyed: 'text-destructive',
  deleted: 'text-amber-600',
  active: 'text-muted-foreground',
};

// One row of the version-history table. Kept as its own component so the parent's render stays flat.
function VersionRow({
  v,
  disabled,
  onUndelete,
  onDestroy,
}: {
  v: SecretVersionsView['versions'][number];
  disabled: boolean;
  onUndelete: () => void;
  onDestroy: () => void;
}) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-1 pr-4 font-mono">
        v{v.version}
        {v.current && (
          <Badge variant="secondary" className="ml-1.5 bg-primary/10 text-[9px] text-primary">
            current
          </Badge>
        )}
      </td>
      <td className="py-1 pr-4 text-muted-foreground">
        {v.createdTime ? new Date(v.createdTime).toLocaleString() : '—'}
      </td>
      <td className="py-1 pr-4">
        <Badge variant="outline" className={STATE_CLASS[v.state]}>
          {v.state}
        </Badge>
      </td>
      <td className="py-1 pr-4 text-right">
        {v.state === 'deleted' ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={onUndelete}
            title="Recover this soft-deleted version"
          >
            Recover
          </Button>
        ) : v.state === 'destroyed' ? (
          <span className="text-[10px] text-muted-foreground">gone</span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={disabled}
            onClick={onDestroy}
            title="Permanently destroy this version"
          >
            Destroy
          </Button>
        )}
      </td>
    </tr>
  );
}
