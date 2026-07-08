'use client';

import { PencilSimple, Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AssetFormSheet } from '@/components/data-catalog/AssetFormSheet';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DataAsset } from '@/db/schema';

// Edit + delete actions for one data-asset. Edit reuses the shared form sheet (PATCH); delete is
// guarded by a confirmation dialog and navigates back to the catalog on success.
export function AssetActions({ asset }: { asset: DataAsset }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function del() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/data-assets/${asset.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      toast.success(`Deleted ${asset.name}`);
      router.push('/data/catalog');
      router.refresh();
    } catch {
      toast.error('Failed to delete dataset');
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        <PencilSimple className="size-4" />
        Edit
      </Button>
      <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
        <Trash className="size-4" />
        Delete
      </Button>

      <AssetFormSheet
        open={editing}
        onOpenChange={setEditing}
        title="Edit dataset"
        submitLabel="Save changes"
        submitUrl={`/api/v1/admin/data-assets/${asset.id}`}
        method="PATCH"
        initial={{
          name: asset.name,
          source: asset.source,
          kind: asset.kind,
          owner: asset.owner,
          description: asset.description,
          rowCount: asset.rowCount,
          freshnessSlaHours: asset.freshnessSlaHours,
        }}
        onSaved={() => router.refresh()}
      />

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {asset.name}?</DialogTitle>
            <DialogDescription>
              This removes the dataset from the catalog along with its classification and retention
              policy. This does not delete the underlying data in the warehouse.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={del} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete dataset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
