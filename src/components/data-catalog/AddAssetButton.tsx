'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { AssetFormSheet } from '@/components/data-catalog/AssetFormSheet';
import { Button } from '@/components/ui/button';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// Register a new dataset in the catalog. Panel state lives in the URL (?panel=new-asset) so Back
// closes it and it's deep-linkable.
export function AddAssetButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-asset';

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  return (
    <>
      <Button size="sm" onClick={() => setPanel('new-asset')}>
        <Plus className="size-4" />
        Add dataset
      </Button>
      <AssetFormSheet
        open={open}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Register a dataset"
        submitLabel="Create dataset"
        submitUrl="/api/v1/admin/data-assets"
        method="POST"
        initial={{ name: '', source: '', kind: 'table', owner: '', description: '', rowCount: 0, freshnessSlaHours: 0 }}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
