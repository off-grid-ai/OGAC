'use client';

import { Key, PencilSimple, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { validateKvKey, validateKvValue, type KvRow } from '@/lib/kestra-catalog';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// KV management for one namespace — the writable, governed per-namespace config store. Create/edit
// panels are URL-driven (?panel=new-kv / ?panel=edit-kv&key=…) so Back closes them and they're
// deep-linkable. Values are write-only from the console: we never fetch/display a stored value (the
// list carries key + version + dates only), so the manager can set a value but never leaks one.
export function KestraKvManager({
  namespace,
  rows,
}: Readonly<{ namespace: string; rows: KvRow[] }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const panel = params.get('panel');
  const editKey = params.get('key') ?? '';
  const creating = panel === 'new-kv';
  const editing = panel === 'edit-kv';

  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const setPanel = useCallback(
    (next: { panel: string | null; key?: string | null }) => {
      const qs = withPanelParams(params.toString(), next);
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  // Seed the form when a panel opens: blank for create, key locked for edit.
  useEffect(() => {
    if (creating) {
      setKey('');
      setValue('');
    } else if (editing) {
      setKey(editKey);
      setValue('');
    }
  }, [creating, editing, editKey]);

  async function save() {
    const keyCheck = validateKvKey(key);
    if (!keyCheck.ok) return toast.error(keyCheck.error!);
    const valueCheck = validateKvValue(value);
    if (!valueCheck.ok) return toast.error(valueCheck.error!);
    setBusy(true);
    try {
      const base = `/api/v1/admin/orchestration/namespaces/${encodeURIComponent(namespace)}/kv`;
      const res = editing
        ? await fetch(`${base}/${encodeURIComponent(key)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ value }),
          })
        : await fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: key.trim(), value }),
          });
      if (res.ok) {
        toast.success(editing ? `Updated "${key}"` : `Created "${key.trim()}"`);
        setPanel({ panel: null, key: null });
        router.refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ?? 'Save failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/admin/orchestration/namespaces/${encodeURIComponent(namespace)}/kv/${encodeURIComponent(pendingDelete)}`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        toast.success(`Deleted "${pendingDelete}"`);
        setPendingDelete(null);
        router.refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ?? 'Delete failed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Key className="size-4" /> Key / value store
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal">{rows.length}</span>
        </h3>
        <Button size="sm" variant="outline" onClick={() => setPanel({ panel: 'new-kv', key: null })}>
          <Plus className="size-4" /> New key
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No key/value entries in this namespace yet. Create one to store governed config for its flows.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 font-mono text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Version</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-mono">{r.key}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.version ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.updatedAt ? r.updatedAt.slice(0, 19).replace('T', ' ') : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit ${r.key}`}
                        onClick={() => setPanel({ panel: 'edit-kv', key: r.key })}
                      >
                        <PencilSimple className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${r.key}`}
                        onClick={() => setPendingDelete(r.key)}
                      >
                        <Trash className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormSheet
        open={creating || editing}
        onOpenChange={(o) => !o && setPanel({ panel: null, key: null })}
        title={editing ? `Set value for "${editKey}"` : 'New key/value entry'}
        description={
          editing
            ? 'Overwrites the stored value; the key is fixed. The current value is never shown.'
            : 'Keys may contain letters, digits, dot, underscore and hyphen.'
        }
        footer={
          <Button onClick={save} disabled={busy} className="w-full">
            {editing ? 'Save value' : 'Create entry'}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="kv-key">Key</Label>
            <Input
              id="kv-key"
              value={key}
              disabled={editing}
              placeholder="DB_HOST, feature.flag, api-token…"
              className="font-mono"
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kv-value">Value</Label>
            <Textarea
              id="kv-value"
              value={value}
              rows={4}
              placeholder="Value to store"
              className="font-mono"
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        </div>
      </FormSheet>

      <Dialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete key/value entry?</DialogTitle>
            <DialogDescription>
              This permanently removes <span className="font-mono">{pendingDelete}</span> from
              namespace <span className="font-mono">{namespace}</span>. Flows that read it will no
              longer find it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
