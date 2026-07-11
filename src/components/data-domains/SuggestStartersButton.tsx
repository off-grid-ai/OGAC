'use client';

import { MagicWand } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ProposedDomain } from '@/lib/data-domains-seed';

// "Suggest starter rules" — one-click seeding of the canonical domains (customer/transactions/
// quota/invoices) that the pure proposer matched to REAL connectors the org already has. The
// operator reviews the proposals, then creates them all with one action (each a POST). Nothing is
// invented: every proposal already points at a real connector id.
export function SuggestStartersButton({ proposals }: Readonly<{ proposals: ProposedDomain[] }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createAll() {
    if (busy || proposals.length === 0) return;
    setBusy(true);
    let created = 0;
    for (const p of proposals) {
      const res = await fetch('/api/v1/admin/data-domains', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: p.label,
          aliases: p.aliases,
          connectorId: p.connectorId,
          resource: p.resource,
        }),
      });
      if (res.ok) created += 1;
    }
    setBusy(false);
    setOpen(false);
    if (created > 0) {
      toast.success(`Created ${created} starter rule${created === 1 ? '' : 's'}`);
      router.refresh();
    } else {
      toast.error('Could not create starter rules');
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <MagicWand className="size-4" />
        Suggest starter rules
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suggested starter rules</DialogTitle>
            <DialogDescription>
              Matched to the connectors you already have. Review, then create them all.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {proposals.map((p) => (
              <div
                key={p.label}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{p.label}</span>
                  <Badge variant="secondary" className="bg-primary/10 text-primary">
                    {p.connectorName}
                  </Badge>
                  <code className="font-mono text-xs text-muted-foreground">{p.resource}</code>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.rationale}</p>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={createAll} disabled={busy}>
              Create {proposals.length} rule{proposals.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
