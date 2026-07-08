'use client';

import { ArrowRight, PencilSimple, Trash } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ConnectorOption } from '@/components/data-domains/DomainFormPanel';
import { DomainFormPanel } from '@/components/data-domains/DomainFormPanel';
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
import { resolveDomainRanked, type DataDomain } from '@/lib/data-domains';
import { formatAliases } from '@/lib/data-domains-ui';

// The client half of the data-domain DETAIL page: the full binding, edit (URL-driven side panel)
// + delete, a cross-link to the bound connector, and a scoped "test resolve" that runs the SAME
// pure resolver the builder/router use — so an operator can confirm THIS domain wins the phrases
// they expect (and see when a sibling domain would steal it). Resolve runs entirely client-side.
export function DomainDetailPanel({
  domain,
  connectorName,
  connectors,
  allDomains,
  referencedByPipelines = [],
}: {
  domain: DataDomain & { connectorName: string };
  connectorName: string;
  connectors: ConnectorOption[];
  allDomains: DataDomain[];
  /** Pipelines whose data ceiling (dataAllowlist) allowlists THIS domain — the reverse edge. */
  referencedByPipelines?: { id: string; name: string; status: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [phrase, setPhrase] = useState('');

  const editOpen = params.get('panel') === 'edit-domain';

  const setEditPanel = useCallback(
    (open: boolean) => {
      const p = new URLSearchParams(params.toString());
      if (open) p.set('panel', 'edit-domain');
      else p.delete('panel');
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  const ranked = useMemo(() => {
    if (!phrase.trim()) return [];
    return resolveDomainRanked(phrase, allDomains);
  }, [phrase, allDomains]);
  const winner = ranked[0]?.domain ?? null;

  async function remove() {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/v1/admin/data-domains/${domain.id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) {
      toast.success(`Data domain "${domain.label}" deleted`);
      router.push('/data/domains');
    } else {
      toast.error('Delete failed');
    }
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditPanel(true)}>
          <PencilSimple className="size-4" /> Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-destructive hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash className="size-4" /> Delete
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Binding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Aliases
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {domain.aliases.length === 0 ? (
                  <span className="text-xs text-muted-foreground/60">No aliases</span>
                ) : (
                  domain.aliases.map((a) => (
                    <Badge key={a} variant="secondary" className="bg-muted text-muted-foreground">
                      {a}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Routes to
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Link href={`/data/connectors/${domain.connectorId}`}>
                  <Badge variant="secondary" className="bg-primary/10 text-primary hover:underline">
                    {connectorName}
                  </Badge>
                </Link>
                <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                <code className="truncate font-mono text-xs text-muted-foreground">
                  {domain.resource}
                </code>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Test resolve</CardTitle>
            <p className="text-xs text-muted-foreground">
              Type a phrase — this runs the same deterministic resolver the builder uses, across all
              domains, and confirms whether it binds to THIS one.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="e.g. employee reimbursement quota"
              className="font-mono text-sm"
            />
            {phrase.trim() ? (
              winner ? (
                <div
                  className={`rounded-md border px-3 py-2 text-sm ${
                    winner.id === domain.id
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-amber-500/40 bg-amber-500/5'
                  }`}
                >
                  {winner.id === domain.id ? (
                    <span className="text-primary">Binds to this domain ✓</span>
                  ) : (
                    <span className="text-amber-600">
                      Binds to <b>{winner.label}</b> instead, not this one.
                    </span>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
                  No confident match — the resolver returns null (no-guess).
                </div>
              )
            ) : null}
            {ranked.length > 0 ? (
              <div className="space-y-1">
                {ranked.slice(0, 4).map((r) => (
                  <div
                    key={r.domain.id}
                    className="flex items-center justify-between text-xs text-muted-foreground"
                  >
                    <span className={r.domain.id === domain.id ? 'font-medium text-foreground' : ''}>
                      {r.domain.label}
                    </span>
                    <span className="font-mono">{r.score.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Reverse edge — which pipelines allowlist THIS domain in their data ceiling. Mirrors the
          connector's "Bound data domains" card: the substrate reads legibly from both ends. */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">
            Referenced by pipelines ({referencedByPipelines.length})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Pipelines whose data ceiling allowlists this domain — the only pipelines permitted to reach
            it. Bind or remove it from a pipeline&apos;s ceiling on that pipeline&apos;s Routing tab.
          </p>
        </CardHeader>
        <CardContent>
          {referencedByPipelines.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No pipeline references this domain yet — no governed consumer can reach it until a
              pipeline adds it to its data ceiling.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {referencedByPipelines.map((p) => (
                <Link key={p.id} href={`/build/pipelines/${p.id}`}>
                  <Badge
                    variant="outline"
                    className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                  >
                    {p.name}
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {p.status}
                    </span>
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <DomainFormPanel
        open={editOpen}
        onOpenChange={(o) => !o && setEditPanel(false)}
        title="Edit data domain"
        description="Update the label, aliases, or where this data lives."
        submitLabel="Save changes"
        connectors={connectors}
        initial={{
          label: domain.label,
          connectorId: domain.connectorId,
          resource: domain.resource,
          aliasesRaw: formatAliases(domain.aliases),
        }}
        submitUrl={`/api/v1/admin/data-domains/${domain.id}`}
        method="PATCH"
        onSaved={() => router.refresh()}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete data domain?</DialogTitle>
            <DialogDescription>
              This removes the rule{' '}
              <span className="font-medium text-foreground">{domain.label}</span> — phrases that
              matched it will no longer route to {connectorName}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
