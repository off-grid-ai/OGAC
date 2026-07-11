'use client';

import { Key, Trash } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Secrets store panel. Stores connector/tool credentials + virtual-key secrets in the secrets store
// (KV v2) via /api/v1/admin/secrets. Values are write-only from the UI — GET returns key names only.
export function SecretsPanel({ configured, initialKeys }: Readonly<{ configured: boolean; initialKeys: string[] }>) {
  const [keys, setKeys] = useState<string[]>(initialKeys);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch('/api/v1/admin/secrets');
    const json = (await res.json()) as { keys?: string[] };
    setKeys(json.keys ?? []);
  }

  async function save() {
    if (!key.trim() || !value) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/secrets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: key.trim(), value }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'write failed');
      toast.success(`Stored ${key.trim()} in the secrets store`);
      setKey('');
      setValue('');
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(k: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/secrets?key=${encodeURIComponent(k)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('delete failed');
      toast.success(`Removed ${k}`);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <p className="text-xs text-muted-foreground">
        Secrets store not configured — set OFFGRID_OPENBAO_URL (token OFFGRID_OPENBAO_TOKEN, mount
        OFFGRID_OPENBAO_MOUNT) to store connector/tool credentials in the KV vault.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="space-y-1">
          <label htmlFor="control-secret-key" className="text-[10px] uppercase tracking-wide text-muted-foreground">Key</label>
          <Input
            id="control-secret-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="e.g. connector.slack.token"
            className="w-56"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="control-secret-value" className="text-[10px] uppercase tracking-wide text-muted-foreground">Value</label>
          <Input
            id="control-secret-value"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="secret material"
            className="w-56"
          />
        </div>
        <Button type="submit" size="sm" disabled={busy}>
          <Key className="mr-1.5 size-4" />
          Store
        </Button>
      </form>

      {keys.length ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {keys.map((k) => (
            <li key={k} className="flex items-center justify-between px-3 py-2">
              <span className="font-mono text-xs text-foreground">{k}</span>
              <button
                type="button"
                onClick={() => void remove(k)}
                disabled={busy}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`remove ${k}`}
              >
                <Trash className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No secrets stored yet.</p>
      )}
    </div>
  );
}
