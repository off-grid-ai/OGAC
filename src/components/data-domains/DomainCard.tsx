'use client';

import { ArrowRight, DotsThree, PencilSimple, Trash } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { DomainFormPanel, type ConnectorOption } from '@/components/data-domains/DomainFormPanel';
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
import { explainResponse } from '@/lib/api-failure';

import { describeDeleteImpact, describeUsage, type DomainUsage } from '@/lib/data-domain-usage';
import { formatAliases } from '@/lib/data-domains-ui';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// One tone per level, most sensitive loudest. 'unclassified' is deliberately NOT the same neutral grey
// as 'public' — an ungraded source must not read as a safe one.
const CLASSIFICATION_TONE: Record<string, string> = {
  restricted: 'border-destructive/50 bg-destructive/10 text-destructive',
  confidential: 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-500',
  internal: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  public: 'border-border bg-muted text-muted-foreground',
  unclassified: 'border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground',
};


export interface DomainLite {
  id: string;
  label: string;
  aliases: string[];
  connectorId: string;
  connectorName: string;
  resource: string;
  /** Sensitivity of what this rule reaches; null = nobody has graded it. */
  classification?: string | null;
}

// One declared domain rule as a card, with row-level management: edit (URL-driven side panel,
// ?panel=edit-domain&id=<id>) and delete (confirmation modal). Shows the full binding —
// label + aliases → connector · resource — so an operator reads the routing at a glance.
export function DomainCard({
  domain,
  usage,
  connectors,
}: Readonly<{
  domain: DomainLite;
  /** Reverse edge: the apps/pipelines routing through this rule. Absent on surfaces that don't read it. */
  usage?: DomainUsage;
  connectors: ConnectorOption[];
}>) {
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
      return;
    }
    // The server's own reason, and a refusal presented as a refusal — a viewer on a read-only demo
    // account is the system working, not "Delete failed".
    const failure = await explainResponse(res, `delete "${domain.label}"`);
    (failure.refusal ? toast.info : toast.error)(failure.message);
  }

  const impact = usage ? describeDeleteImpact(usage) : '';

  return (
    <>
      <Card className="flex h-full flex-col shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
          <CardTitle className="text-sm font-semibold text-foreground">
            <Link href={`/data/domains/${domain.id}`} className="hover:text-primary hover:underline">
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
          <div className="mt-auto space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* WHAT SENSITIVITY THIS REACHES. Classification existed on the warehouse catalogue,
                  which apps never read — so a CISO's "which models saw Confidential data" hit a
                  broken join. Grading the DOMAIN closes it, because the domain is what apps bind to.
                  Ungraded says so plainly instead of looking safe. */}
              <Badge
                variant="outline"
                className={CLASSIFICATION_TONE[domain.classification ?? 'unclassified'] ?? CLASSIFICATION_TONE.unclassified}
                title={
                  domain.classification
                    ? `Data reached through this rule is classified ${domain.classification}`
                    : 'Nobody has classified what this rule reaches — it is not treated as public'
                }
              >
                {domain.classification ?? 'unclassified'}
              </Badge>
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                {domain.connectorName}
              </Badge>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
              <code className="truncate font-mono text-muted-foreground">{domain.resource}</code>
            </div>
            {/* Who routes through this rule. With 20+ near-identical cards, the binding alone doesn't
                say which rule the org actually runs on — this does. */}
            {usage ? (
              <p
                className={
                  usage.unused
                    ? 'text-[11px] text-muted-foreground/70'
                    : 'text-[11px] font-medium text-foreground'
                }
                title={
                  usage.unused
                    ? 'No app step or pipeline ceiling references this rule yet.'
                    : [...usage.apps.map((a) => a.title), ...usage.pipelines.map((p) => p.name)].join(
                        ', ',
                      )
                }
              >
                {usage.unused ? 'Not routed to yet' : `Routed to by ${describeUsage(usage)}`}
              </p>
            ) : null}
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
          // Without this the edit form opened with an empty grade and SAVING would clear it — an edit
          // to a label would silently un-classify the domain.
          classification: domain.classification ?? '',
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
          {/* Deleting a rule that apps or pipelines bind leaves those bindings pointing at nothing.
              That is how a cosmetic cleanup turns into a broken app, so it is stated before the click,
              naming what breaks. */}
          {impact ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              {impact}
            </p>
          ) : null}
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
