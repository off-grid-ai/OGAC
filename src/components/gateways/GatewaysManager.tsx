'use client';

import {
  CheckCircle as CircleCheck,
  ProhibitInset as CircleSlash,
  Cloud,
  HardDrives,
  Plus,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GATEWAY_KINDS, type GatewayKind, type GatewayView } from '@/lib/gateways-policy';
import { panelHref, withPanelParams } from '@/lib/url-panel';

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

const KIND_LABEL: Record<string, string> = {
  'on-prem': 'On-prem cluster',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  compat: 'OpenAI-compatible',
};

// Honest status → colour + icon. `available` is the strict truth from the server (enabled+configured
// +reachable); we never invent a green dot the probe didn't earn.
function statusBadge(gw: GatewayView) {
  switch (gw.status) {
    case 'up':
      return (
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          <CircleCheck className="size-3" /> up
        </Badge>
      );
    case 'degraded':
      return (
        <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <WarningCircle className="size-3" /> degraded
        </Badge>
      );
    case 'down':
      return (
        <Badge variant="destructive">
          <CircleSlash className="size-3" /> down
        </Badge>
      );
    case 'unconfigured':
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <CircleSlash className="size-3" /> not configured
        </Badge>
      );
    case 'disabled':
      return (
        <Badge variant="outline" className="text-muted-foreground">
          disabled
        </Badge>
      );
  }
}

function egressBadge(egressClass: string) {
  return egressClass === 'on-prem' ? (
    <Badge variant="secondary" className="bg-primary/10 text-primary">
      <HardDrives className="size-3" /> data stays on-prem
    </Badge>
  ) : (
    <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
      <Cloud className="size-3" /> data leaves (cloud)
    </Badge>
  );
}

function GatewayCard({ gw, onDelete }: { gw: GatewayView; onDelete: (gw: GatewayView) => void }) {
  return (
    <Card className="flex flex-col shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="truncate text-sm">{gw.name}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{KIND_LABEL[gw.kind] ?? gw.kind}</p>
        </div>
        {statusBadge(gw)}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-1.5">{egressBadge(gw.egressClass)}</div>
        <dl className="space-y-1">
          {gw.defaultModel ? (
            <div className="flex justify-between gap-2">
              <dt>Model</dt>
              <dd className="truncate font-mono text-foreground">{gw.defaultModel}</dd>
            </div>
          ) : null}
          {gw.baseUrl ? (
            <div className="flex justify-between gap-2">
              <dt>Base URL</dt>
              <dd className="truncate font-mono">{gw.baseUrl}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-2">
            <dt>Health</dt>
            <dd className="text-foreground">{gw.detail}</dd>
          </div>
        </dl>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className={gw.available ? 'text-primary' : 'text-muted-foreground'}>
            {gw.available ? 'available' : 'unavailable'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(gw)}
          >
            <Trash className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddGatewaySheet({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<GatewayKind>('on-prem');
  const [baseUrl, setBaseUrl] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await fetch('/api/v1/admin/gateways', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, kind, baseUrl, defaultModel }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Gateway "${name}" created`);
      setName('');
      setBaseUrl('');
      setDefaultModel('');
      setKind('on-prem');
      onOpenChange(false);
      onSaved();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to create gateway');
    }
  }

  const isCloud = kind !== 'on-prem';

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add gateway"
      description="Register a model-serving endpoint your pipelines can run on. Its egress class is derived from the kind — on-prem keeps data on your fleet; cloud means data leaves."
      footer={
        <Button onClick={save} disabled={busy || !name.trim()} className="w-full">
          Create gateway
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="gw-name">Name</Label>
          <Input
            id="gw-name"
            placeholder="On-Prem Cluster"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gw-kind">Kind</Label>
          <select
            id="gw-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as GatewayKind)}
            className={SELECT}
          >
            {GATEWAY_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            {isCloud
              ? 'Cloud gateway — data leaves your network on every call.'
              : 'On-prem — served by your fleet; data never leaves.'}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gw-baseurl">Base URL{kind === 'compat' ? '' : ' (optional)'}</Label>
          <Input
            id="gw-baseurl"
            placeholder={kind === 'compat' ? 'https://openrouter.ai/api/v1' : 'well-known default used if blank'}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            An OpenAI-compatible gateway (compat) requires a base URL; on-prem and the well-known
            cloud providers fall back to their configured endpoint.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gw-model">Default model (optional)</Label>
          <Input
            id="gw-model"
            placeholder="gpt-4o-mini"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </FormSheet>
  );
}

// The Gateways registry surface — full-width grid of gateway cards + a URL-driven Add sheet
// (?panel=new-gateway so Back closes it and it's deep-linkable). Health is honest: the server
// merged live probes, so an unconfigured OpenAI shows "not configured", never a fake green.
export function GatewaysManager({ gateways }: { gateways: GatewayView[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-gateway';

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  const onDelete = useCallback(
    async (gw: GatewayView) => {
      if (!confirm(`Delete gateway "${gw.name}"? Pipelines bound to it will fall back to the org default.`)) return;
      const res = await fetch(`/api/v1/admin/gateways/${gw.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`Gateway "${gw.name}" deleted`);
        router.refresh();
      } else {
        toast.error('Failed to delete gateway');
      }
    },
    [router],
  );

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-foreground">Gateways</h1>
          <p className="text-sm text-muted-foreground">
            Model-serving endpoints your pipelines run on. Shared: many pipelines : one gateway.
          </p>
        </div>
        <Button size="sm" onClick={() => setPanel('new-gateway')}>
          <Plus className="size-4" />
          Add gateway
        </Button>
      </div>

      {gateways.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No gateways registered yet. Add one, or seed the samples with
            <span className="font-mono"> POST /api/v1/admin/gateways/seed</span>.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {gateways.map((gw) => (
            <GatewayCard key={gw.id} gw={gw} onDelete={onDelete} />
          ))}
        </div>
      )}

      <AddGatewaySheet open={open} onOpenChange={(o) => !o && setPanel(null)} onSaved={() => router.refresh()} />
    </div>
  );
}
