'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

// Register a custom connector — an MCP server URL or HTTP endpoint with an auth scheme. Persists to
// the connectors directory (and can be promoted to a chat tool). Admin-only surface.
export function AddConnectorButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'mcp' | 'http'>('mcp');
  const [endpoint, setEndpoint] = useState('');
  const [auth, setAuth] = useState<'none' | 'api-key' | 'oauth'>('none');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

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
      setName('');
      setEndpoint('');
      setDescription('');
      setOpen(false);
      router.refresh();
    } else {
      toast.error('Failed to add connector');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Add custom connector
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a custom connector</DialogTitle>
          <DialogDescription>
            Point at an MCP server or an HTTP endpoint. It joins the connector directory and can be
            exposed to chat as a governed tool.
          </DialogDescription>
        </DialogHeader>
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
          <Button onClick={create} disabled={busy} className="w-full">
            Add connector
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
