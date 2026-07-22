'use client';

import { Broom, Trash } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { CacheStatus } from '@/lib/litellm-cache';

// Cache actions — the flush levers. Flush-all clears the whole response cache (confirmed, since it
// evicts every cached completion); flush-by-key evicts specific entries. Both go through the audited
// admin route. Disabled when no cache is wired (nothing to flush).

export function CacheActions({
  status,
  onFlushed,
}: Readonly<{ status: CacheStatus | null; onFlushed?: () => void }>) {
  const [confirmAll, setConfirmAll] = useState(false);
  const [keysRaw, setKeysRaw] = useState('');
  const [busy, setBusy] = useState(false);

  const enabled = status?.cacheEnabled === true && status.healthy;

  async function flush(body: { mode: 'all' } | { mode: 'keys'; keys: string[] }) {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/gateway/cache/flush', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; keysRequested?: number };
      if (!res.ok) throw new Error(j.error ?? `flush failed (${res.status})`);
      toast.success(
        body.mode === 'all'
          ? 'Cache flushed — all entries cleared.'
          : `Evicted ${j.keysRequested ?? body.keys.length} key(s) from the cache.`,
      );
      if (body.mode === 'keys') setKeysRaw('');
      onFlushed?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmAll(false);
    }
  }

  const parsedKeys = keysRaw
    .split(/[\n,]/)
    .map((k) => k.trim())
    .filter((k) => k !== '');

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <Broom weight="duotone" className="size-4 text-primary" />
          Cache actions
        </CardTitle>
        {!enabled ? (
          <Badge variant="secondary" className="font-mono text-[11px]">
            {status?.cacheEnabled ? 'degraded' : 'no cache'}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        {!enabled ? (
          <p className="text-sm text-muted-foreground">
            No healthy response cache is wired, so there is nothing to flush. Enable caching in the proxy
            config and reload to use these levers.
          </p>
        ) : (
          <>
            {/* flush all */}
            <div className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-mono text-sm">Flush all</div>
                <p className="text-[12px] text-muted-foreground">
                  Clear every cached completion. Next requests recompute and re-warm the cache.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmAll(true)}
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <Trash weight="bold" className="mr-1 size-4" />
                Flush all
              </Button>
            </div>

            {/* flush by key */}
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="font-mono text-sm">Flush by key</div>
              <p className="text-[12px] text-muted-foreground">
                Evict specific cache keys — one per line, or comma-separated.
              </p>
              <Input
                aria-label="cache keys to evict"
                placeholder="cache-key-1, cache-key-2"
                value={keysRaw}
                onChange={(e) => setKeysRaw(e.target.value)}
              />
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {parsedKeys.length} key{parsedKeys.length === 1 ? '' : 's'}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || parsedKeys.length === 0}
                  onClick={() => void flush({ mode: 'keys', keys: parsedKeys })}
                >
                  Evict keys
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-mono">Flush the entire cache?</DialogTitle>
            <DialogDescription>
              This clears every cached response ({status?.type ?? 'cache'}). In-flight requests are
              unaffected, but subsequent requests will recompute until the cache re-warms. This action is
              audited.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmAll(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void flush({ mode: 'all' })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Flush everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
