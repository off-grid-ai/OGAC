'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { buildInstallPayload, isInstallable, type McpServer } from '@/lib/mcp-catalog';

// ─── McpInstallButton (Builder Epic #119) — one-click add a catalog server as an MCP tool ─────────
// Opens a panel (URL-driven: ?install=<id> so Back closes it) prefilled from the catalog entry. The
// operator MUST supply their own on-prem endpoint URL (the console never guesses where the server
// runs); the pure buildInstallPayload turns entry + endpoint into the EXACT tool-create body, POSTed
// to the EXISTING /api/v1/admin/tools route (type=mcp). No new tool storage — the added tool shows
// up in the builder's ToolPicker "Registered tools" group automatically.
export function McpInstallButton({ server }: Readonly<{ server: McpServer }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('install') === server.id;

  const [endpoint, setEndpoint] = useState('');
  const [busy, setBusy] = useState(false);

  const setOpen = useCallback(
    (next: boolean) => {
      const sp = new URLSearchParams(params.toString());
      if (next) sp.set('install', server.id);
      else sp.delete('install');
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router, server.id],
  );

  async function add() {
    if (!isInstallable(server, endpoint)) {
      toast.error('Enter the on-prem endpoint where this server runs.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildInstallPayload(server, endpoint)),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Added "${server.name}" — now available as a registered MCP tool.`);
      setEndpoint('');
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to add tool');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add {server.name}</SheetTitle>
            <SheetDescription>
              Register this MCP server as a tool your apps can use. It will appear in the
              builder&apos;s tool picker under “Registered tools”.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-5">
            <div className="space-y-1.5">
              <Label>1. Run the server on your network</Label>
              <pre className="overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs">
                {server.install}
              </pre>
              {server.reachesInternet ? (
                <p className="text-xs text-amber-700">{server.airgapNote}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{server.airgapNote}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mcp-endpoint">2. Your on-prem endpoint</Label>
              <Input
                id="mcp-endpoint"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={server.defaultEndpointHint}
              />
              <p className="text-xs text-muted-foreground">
                Where the server runs on your network — a{' '}
                {server.transport === 'http' ? 'URL' : 'launch command / socket'}. Sample above; the
                console never connects out on its own.
              </p>
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={add} disabled={busy || !endpoint.trim()} className="w-full">
              {busy ? 'Adding…' : `Add ${server.name}`}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
