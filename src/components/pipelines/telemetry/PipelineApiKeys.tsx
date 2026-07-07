'use client';

import { Copy, Key, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ─── PipelineApiKeys — the keys table + Mint/Revoke on the pipeline's API tab ─────────────────────
//
// Full CRUD for a pipeline's provisioned keys: mint (plaintext shown ONCE in a FormSheet), list, and
// revoke (with confirm). URL-driven panel state (?panel=mint) so the create panel is Back-coherent
// and deep-linkable per the nav mandate. The plaintext is captured from the mint response and never
// re-fetched — only its hash lives server-side.

export interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  active: boolean;
  createdAt: string | null;
  createdBy: string;
  revokedAt: string | null;
}

function fmt(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function PipelineApiKeys({ pipelineId, keys }: { pipelineId: string; keys: KeyRow[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const open = params.get('panel') === 'mint';

  const setOpen = useCallback(
    (next: boolean) => {
      const p = new URLSearchParams(params.toString());
      if (next) p.set('panel', 'mint');
      else p.delete('panel');
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  const [name, setName] = useState('');
  const [minted, setMinted] = useState('');
  const [busy, setBusy] = useState(false);

  async function mint() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/pipelines/${pipelineId}/keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? 'failed');
      }
      const data = await res.json();
      setMinted(data.apiKey as string);
      setName('');
      router.refresh();
    } catch (e) {
      toast.error(`Failed to mint key: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, label: string) {
    if (!window.confirm(`Revoke key "${label}"? Any app, agent, or third-party using it stops immediately.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/v1/admin/pipelines/${pipelineId}/keys/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('failed');
      toast.success('Key revoked');
      router.refresh();
    } catch {
      toast.error('Failed to revoke key');
    }
  }

  function close(o: boolean) {
    setOpen(o);
    if (!o) setMinted('');
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Provisioned keys</h3>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Mint key
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>By</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  No keys yet. Mint one to let an app, agent, or third-party call this pipeline.
                </TableCell>
              </TableRow>
            ) : (
              keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name || '—'}</TableCell>
                  <TableCell>
                    <code className="text-xs text-muted-foreground">{k.prefix}</code>
                  </TableCell>
                  <TableCell>
                    {k.active ? (
                      <Badge variant="secondary" className="text-primary">
                        active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        revoked {fmt(k.revokedAt)}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmt(k.createdAt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{k.createdBy || '—'}</TableCell>
                  <TableCell className="text-right">
                    {k.active ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revoke(k.id, k.name)}
                        aria-label={`Revoke ${k.name}`}
                      >
                        <Trash className="size-4 text-destructive" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <FormSheet
        open={open}
        onOpenChange={close}
        title="Mint a provisioned key"
        description="A key an app, agent, or external third-party presents to call this pipeline. The secret is shown once — governance still applies on every call."
      >
        {minted ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Copy this key now — it won&apos;t be shown again. Only its hash is stored.
            </p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted p-2">
              <code className="flex-1 break-all text-xs text-foreground">{minted}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(minted);
                  toast.success('Copied');
                }}
                aria-label="Copy key"
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <Button onClick={() => close(false)} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                value={name}
                placeholder="e.g. Partner integration — Acme"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button onClick={mint} disabled={busy || !name.trim()} className="w-full">
              <Key className="size-4" />
              {busy ? 'Minting…' : 'Mint key'}
            </Button>
          </div>
        )}
      </FormSheet>
    </div>
  );
}
