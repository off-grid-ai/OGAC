'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { panelHref, withPanelParams } from '@/lib/url-panel';

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

// Register a custom connector — an MCP server URL or HTTP endpoint with an auth scheme. Persists to
// the connectors directory (and can be promoted to a chat tool). Admin-only surface. The create
// panel's open/closed state lives in the URL (?panel=new-connector) so Back closes it and it's
// deep-linkable — never in local useState.
export function AddConnectorButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-connector';

  const [name, setName] = useState('');
  const [type, setType] = useState<'mcp' | 'http'>('mcp');
  const [endpoint, setEndpoint] = useState('');
  const [auth, setAuth] = useState<'none' | 'api-key' | 'oauth'>('none');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  // Reset the form each time the panel opens so a stale draft never lingers.
  useEffect(() => {
    if (open) {
      setName('');
      setType('mcp');
      setEndpoint('');
      setAuth('none');
      setDescription('');
    }
  }, [open]);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const res = await fetch('/api/v1/admin/connectors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, type, endpoint, auth, description }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Connector "${name}" added`);
      setPanel(null);
      router.refresh();
    } else {
      toast.error('Failed to add connector');
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setPanel('new-connector')}>
        <Plus className="size-4" />
        Add custom connector
      </Button>
      <FormSheet
        open={open}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Add a custom connector"
        description="Point at an MCP server or an HTTP endpoint. It joins the connector directory and can be exposed to chat as a governed tool."
        footer={
          <Button onClick={create} disabled={busy} className="w-full">
            Add connector
          </Button>
        }
      >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="con-name">Name</Label>
              <Input id="con-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="con-type">Kind</Label>
                <select
                  id="con-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as typeof type)}
                  className={SELECT}
                >
                  <option value="mcp">MCP server</option>
                  <option value="http">HTTP endpoint</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="con-auth">Auth</Label>
                <select
                  id="con-auth"
                  value={auth}
                  onChange={(e) => setAuth(e.target.value as typeof auth)}
                  className={SELECT}
                >
                  <option value="none">None</option>
                  <option value="api-key">API key</option>
                  <option value="oauth">OAuth</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="con-endpoint">
                {type === 'mcp' ? 'MCP server URL' : 'HTTP endpoint'}
              </Label>
              <Input
                id="con-endpoint"
                placeholder="https://…"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="con-desc">Description (when to use)</Label>
              <Textarea
                id="con-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
      </FormSheet>
    </>
  );
}
