'use client';

import { ArrowsClockwise, DotsThree, PencilSimple, Trash } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { panelHref, withPanelParams } from '@/lib/url-panel';

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

export interface ConnectorLite {
  id: string;
  name: string;
  type: string;
  endpoint: string;
  auth: string;
  description: string;
  custom: boolean;
}

// Row-level management for a connector: trigger a sync (all connectors), and — for custom
// connectors — edit its config or delete it. Server routes: POST /sync, PATCH & DELETE /[id].
// The edit panel is a URL-driven side panel (?panel=edit-connector&id=<id>) so Back closes it and
// it's deep-linkable; delete stays a confirmation modal (local state) per the NO-MODALS carve-out.
export function ConnectorRowActions({ connector }: Readonly<{ connector: ConnectorLite }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // This row's edit panel is open only when the URL targets this connector's id.
  const editOpen =
    params.get('panel') === 'edit-connector' && params.get('id') === connector.id;

  // edit form state
  const [name, setName] = useState(connector.name);
  const [auth, setAuth] = useState(connector.auth);
  const [endpoint, setEndpoint] = useState(connector.endpoint);
  const [description, setDescription] = useState(connector.description);

  const setEditPanel = useCallback(
    (targetId: string | null) => {
      const qs = withPanelParams(params.toString(), {
        panel: targetId ? 'edit-connector' : null,
        id: targetId,
      });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  // Seed the form from the connector each time this row's panel opens.
  useEffect(() => {
    if (editOpen) {
      setName(connector.name);
      setAuth(connector.auth);
      setEndpoint(connector.endpoint);
      setDescription(connector.description);
    }
  }, [editOpen, connector.name, connector.auth, connector.endpoint, connector.description]);

  async function sync() {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/v1/admin/connectors/${connector.id}/sync`, { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const job = await res.json().catch(() => null);
      toast.success(
        job?.records != null
          ? `Synced "${connector.name}" — ${Number(job.records).toLocaleString()} records`
          : `Sync started for "${connector.name}"`,
      );
      router.refresh();
    } else {
      toast.error(`Sync failed for "${connector.name}"`);
    }
  }

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const res = await fetch(`/api/v1/admin/connectors/${connector.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, auth, endpoint, description }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Connector "${name}" updated`);
      setEditPanel(null);
      router.refresh();
    } else {
      toast.error('Update failed');
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/v1/admin/connectors/${connector.id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) {
      toast.success(`Connector "${connector.name}" deleted`);
      setConfirmDelete(false);
      router.refresh();
    } else {
      toast.error('Delete failed');
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Connector actions">
            <DotsThree className="size-4" weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={sync} disabled={busy}>
            <ArrowsClockwise className="size-4" />
            Sync now
          </DropdownMenuItem>
          {connector.custom ? (
            <>
              <DropdownMenuItem onClick={() => setEditPanel(connector.id)}>
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
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit panel — URL-driven side panel (?panel=edit-connector&id=<id>) */}
      <FormSheet
        open={editOpen}
        onOpenChange={(o) => !o && setEditPanel(null)}
        title="Edit connector"
        description="Update how this connector reaches its source."
        footer={
          <Button onClick={save} disabled={busy} className="w-full">
            Save changes
          </Button>
        }
      >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-auth">Auth</Label>
              <select
                id="edit-auth"
                value={auth}
                onChange={(e) => setAuth(e.target.value)}
                className={SELECT}
              >
                <option value="none">None</option>
                <option value="api-key">API key</option>
                <option value="oauth">OAuth</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-endpoint">Endpoint</Label>
              <Input
                id="edit-endpoint"
                placeholder="https://…"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-desc">Description (when to use)</Label>
              <Textarea
                id="edit-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
      </FormSheet>

      {/* Delete confirm — stays a confirmation modal per the NO-MODALS delete carve-out */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete connector?</DialogTitle>
            <DialogDescription>
              This removes <span className="font-medium text-foreground">{connector.name}</span> and
              its ingest history. This cannot be undone.
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
