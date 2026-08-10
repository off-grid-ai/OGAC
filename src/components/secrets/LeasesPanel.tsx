'use client';

import { Clock, MagnifyingGlass, Trash } from '@phosphor-icons/react/dist/ssr';
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
import { formatTtl, type LeaseDetail, type LeaseRow } from '@/lib/secrets-ops';

// Lease inventory. Leases are opaque handles + TTLs (operational metadata, not secret material).
// List under a prefix, look up TTL/expiry, and revoke (destructive) a lease. Confirmed on revoke.
export function LeasesPanel({ sealed }: Readonly<{ sealed: boolean }>) {
  const [prefix, setPrefix] = useState('');
  const [leases, setLeases] = useState<LeaseRow[]>([]);
  const [details, setDetails] = useState<Record<string, LeaseDetail>>({});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const list = useCallback(async (p: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/secrets/leases?prefix=${encodeURIComponent(p)}`);
      const d = (await res.json()) as { prefix?: string; leases?: LeaseRow[]; error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to list leases.');
      setLeases(Array.isArray(d.leases) ? d.leases : []);
      // The server may have auto-descended past a chain of single-child namespaces to reach the
      // first real branch point or lease — reflect where it actually landed so "List" (or revoke's
      // re-list) shows the SAME prefix a follow-up search would need to type.
      if (typeof d.prefix === 'string') setPrefix(d.prefix);
      setLoaded(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  // List the ROOT prefix on mount, same as the dynamic-DB roles panel auto-loads its roles. Landing
  // on this page and seeing nothing until you first guess a prefix and click "List" reads as broken
  // even when the store is fine — an operator (or a buyer walking the demo) should see what's
  // currently issued without acting first.
  useEffect(() => {
    void list('');
  }, [list]);

  const lookup = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/admin/secrets/leases?id=${encodeURIComponent(id)}`);
      const d = (await res.json()) as { detail?: LeaseDetail; error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Lookup failed.');
      if (d.detail) setDetails((prev) => ({ ...prev, [id]: d.detail as LeaseDetail }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm(`Revoke lease "${id}"? The underlying credential is invalidated immediately.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/secrets/leases?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Revoke failed.');
      toast.success(`Revoked "${id}".`);
      await list(prefix);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Clock className="size-4 text-muted-foreground" />
          Leases
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void list(prefix);
          }}
        >
          <div className="flex-1 space-y-1">
            <label htmlFor="leases-prefix" className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Lease prefix (e.g. database/creds/app-ro)
            </label>
            <Input
              id="leases-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="empty = root"
            />
          </div>
          <Button size="sm" type="submit" disabled={busy || sealed}>
            <MagnifyingGlass className="mr-1 size-3.5" />
            List
          </Button>
        </form>

        {loaded && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lease id</TableHead>
                  <TableHead>TTL</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leases.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-xs text-muted-foreground">
                      No leases under this prefix.
                    </TableCell>
                  </TableRow>
                ) : (
                  leases.map((l) => {
                    const detail = details[l.id];
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="font-mono text-xs text-foreground">{l.id}</TableCell>
                        <TableCell className="text-xs">
                          {detail ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Badge variant="outline" className="text-muted-foreground">
                                {formatTtl(detail.ttl)}
                              </Badge>
                              {detail.renewable && (
                                <span className="text-[10px] text-muted-foreground">renewable</span>
                              )}
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void lookup(l.id)}
                              title="Look up TTL"
                            >
                              lookup
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={busy || sealed}
                            onClick={() => void revoke(l.id)}
                            title="Revoke lease"
                          >
                            <Trash className="size-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
