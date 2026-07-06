'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { DomainFormPanel, type ConnectorOption } from '@/components/data-domains/DomainFormPanel';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// Declare a new data-domain rule. The create panel's open/closed state lives in the URL
// (?panel=new-domain) so Back closes it and it's deep-linkable — never local useState.
export function AddDomainButton({ connectors }: { connectors: ConnectorOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-domain';

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  return (
    <>
      <Button size="sm" onClick={() => setPanel('new-domain')} disabled={connectors.length === 0}>
        <Plus className="size-4" />
        Add domain rule
      </Button>
      <DomainFormPanel
        open={open}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Declare a data domain"
        description='Bind a semantic label — e.g. "customer data" — to the connector and resource where that data actually lives.'
        submitLabel="Create rule"
        connectors={connectors}
        initial={{ label: '', connectorId: '', resource: '', aliasesRaw: '' }}
        submitUrl="/api/v1/admin/data-domains"
        method="POST"
        onSaved={() => router.refresh()}
      />
    </>
  );
}
