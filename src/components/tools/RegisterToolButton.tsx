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
import { Textarea } from '@/components/ui/textarea';

const TYPES = ['http', 'mcp'] as const;

// ─── RegisterToolButton (#121) — register a new HTTP/MCP tool in the registry ─────────────────────
// The tool-create path, brought to the Tools home (adapted from the old Brain AddToolButton). POSTs
// the EXACT same body to the EXISTING /api/v1/admin/tools route (createTool) — no new storage. Open/
// close state lives in the URL (?panel=new-tool) so Back closes the panel.
export function RegisterToolButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-tool';

  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('http');
  const [endpoint, setEndpoint] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const setOpen = useCallback(
    (next: boolean) => {
      const sp = new URLSearchParams(params.toString());
      if (next) sp.set('panel', 'new-tool');
      else sp.delete('panel');
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, type, endpoint, description }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Registered "${name}"`);
      setName('');
      setEndpoint('');
      setDescription('');
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to register tool');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Register tool
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Register a tool</SheetTitle>
            <SheetDescription>
              The router invokes it when a query&apos;s intent matches the &quot;when to use&quot;
              description. Point an HTTP tool at your service URL, or an MCP tool at a server on your
              network.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-1.5">
              <Label htmlFor="tool-name">Name</Label>
              <Input id="tool-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="flex gap-2">
                {TYPES.map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={type === t ? 'default' : 'outline'}
                    onClick={() => setType(t)}
                  >
                    {t.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tool-endpoint">Endpoint</Label>
              <Input
                id="tool-endpoint"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={type === 'mcp' ? 'mcp://server' : 'https://service/api'}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tool-desc">When to use</Label>
              <Textarea
                id="tool-desc"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this tool does — used to match query intent."
              />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={create} disabled={busy || !name.trim()} className="w-full">
              {busy ? 'Registering…' : 'Register tool'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
