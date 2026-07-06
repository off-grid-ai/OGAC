'use client';

import { ArrowRight, DotsThree, PencilSimple, Trash } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DomainFormPanel, type ConnectorOption } from '@/components/data-domains/DomainFormPanel';
import { formatAliases } from '@/lib/data-domains-ui';
import { panelHref, withPanelParams } from '@/lib/url-panel';

export interface DomainLite {
  id: string;
  label: string;
  aliases: string[];
  connectorId: string;
  connectorName: string;
  resource: string;
}

// One declared domain rule as a card, with row-level management: edit (URL-driven side panel,
// ?panel=edit-domain&id=<id>) and delete (confirmation modal). Shows the full binding —
// label + aliases → connector · resource — so an operator reads the routing at a glance.
export function DomainCard({
  domain,
  connectors,
}: {
  domain: DomainLite;
  connectors: ConnectorOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editOpen = params.get('panel') === 'edit-domain' && params.get('id') === domain.id;

  const setEditPanel = useCallback(
    (targetId: string | null) => {
      const qs = withPanelParams(params.toString(), {
        panel: targetId ? 'edit-domain' : null,
        id: targetId,
      });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  async function remove() {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/v1/admin/data-domains/${domain.id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) {
      toast.success(`Data domain "${domain.label}" deleted`);
      setConfirmDelete(false);
      router.refresh();
    } else {
      toast.error('Delete failed');
    }
  }

  return (
    <>
      <Card className="flex h-full flex-col shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
          <CardTitle className="text-sm font-semibold text-foreground">
            <Link href={`/data-domains/${domain.id}`} className="hover:text-primary hover:underline">
              {domain.label}
            </Link>
          </CardTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-mr-1 -mt-1 size-8" aria-label="Domain actions">
                <DotsThree className="size-4" weight="bold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditPanel(domain.id)}>
                <PencilSimple className="size-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setConfirmDelete(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          {domain.aliases.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {domain.aliases.map((a) => (
                <Badge key={a} variant="secondary" className="bg-muted text-muted-foreground">
                  {a}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60">No aliases</p>
          )}
          <div className="mt-auto flex items-center gap-2 text-xs">
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              {domain.connectorName}
            </Badge>
            <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
            <code className="truncate font-mono text-muted-foreground">{domain.resource}</code>
          </div>
        </CardContent>
      </Card>

      <DomainFormPanel
        open={editOpen}
        onOpenChange={(o) => !o && setEditPanel(null)}
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
              matched it will no longer route to {domain.connectorName}. This cannot be undone.
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
