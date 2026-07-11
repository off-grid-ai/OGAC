'use client';

import {
  Cloud,
  FlowArrow,
  HardDrives,
  Plus,
  Trash,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { pipelineTabHref } from '@/lib/pipeline-detail';
import { panelHref, withPanelParams } from '@/lib/url-panel';

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

// Shape the server hands us (a subset of PipelineView; kept local so the client bundle stays lean).
export interface PipelineCardData {
  id: string;
  name: string;
  description: string;
  status: string;
  version: number;
  isTemplate: boolean;
  dataAllowlist: string[];
  gateway?: { id: string; name: string; kind: string; egressClass: string } | null;
}

interface GatewayOption {
  id: string;
  name: string;
  egressClass: string;
}

function statusBadge(status: string) {
  if (status === 'published') {
    return <Badge variant="secondary" className="bg-primary/10 text-primary">published</Badge>;
  }
  if (status === 'in_review') {
    return (
      <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 dark:text-blue-400">
        in review
      </Badge>
    );
  }
  if (status === 'archived' || status === 'deprecated') {
    return <Badge variant="outline" className="text-muted-foreground">{status}</Badge>;
  }
  return <Badge variant="outline" className="text-amber-600 dark:text-amber-400">draft</Badge>;
}

// The "data ceiling" line for a pipeline card: "none" or "N domain(s)".
function dataCeilingSummary(count: number): string {
  if (count === 0) return 'none';
  return `${count} domain${count === 1 ? '' : 's'}`;
}

function egressBadge(egressClass: string | undefined) {
  if (egressClass === 'on-prem') {
    return (
      <Badge variant="secondary" className="bg-primary/10 text-primary">
        <HardDrives className="size-3" /> on-prem
      </Badge>
    );
  }
  if (egressClass === 'cloud') {
    return (
      <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Cloud className="size-3" /> cloud
      </Badge>
    );
  }
  return null;
}

function PipelineCard({ p, onDelete }: Readonly<{ p: PipelineCardData; onDelete: (p: PipelineCardData) => void }>) {
  return (
    <Card className="flex flex-col shadow-sm transition-colors hover:border-primary/40">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="min-w-0">
          <Link href={pipelineTabHref(p.id, 'overview')} className="hover:underline">
            <CardTitle className="truncate text-sm">{p.name}</CardTitle>
          </Link>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            {p.isTemplate ? <span className="text-primary">Template</span> : null}
            <span>v{p.version}</span>
          </p>
        </div>
        {statusBadge(p.status)}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-xs text-muted-foreground">
        {/* Bulletproof: FIXED height + overflow-hidden + line-clamp-2 — a long description is clipped
            to two lines and can NEVER grow to collide with the badges/footer below (min-h would). */}
        <p className="h-8 overflow-hidden text-ellipsis leading-4 line-clamp-2">
          {p.description || 'No description.'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {p.gateway ? (
            <Badge variant="outline" className="font-normal">
              <FlowArrow className="size-3" /> {p.gateway.name}
            </Badge>
          ) : (
            <Badge variant="outline" className="font-normal text-muted-foreground">org default gateway</Badge>
          )}
          {egressBadge(p.gateway?.egressClass)}
        </div>
        <dl className="space-y-1">
          <div className="flex justify-between gap-2">
            <dt>Data ceiling</dt>
            <dd className="text-foreground">
              {dataCeilingSummary(p.dataAllowlist.length)}
            </dd>
          </div>
        </dl>
        <div className="mt-auto flex items-center justify-between pt-2">
          <Link
            href={pipelineTabHref(p.id, 'overview')}
            className="text-primary hover:underline"
          >
            Open →
          </Link>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(p)}
          >
            <Trash className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddPipelineSheet({
  open,
  onOpenChange,
  onSaved,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}>) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gatewayId, setGatewayId] = useState('');
  const [allowlist, setAllowlist] = useState('');
  const [gateways, setGateways] = useState<GatewayOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the gateway options for the binding dropdown when the sheet opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/v1/admin/gateways');
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as { data?: GatewayOption[] } | null;
      if (!cancelled && body?.data) setGateways(body.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function save() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const dataAllowlist = allowlist
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await fetch('/api/v1/admin/pipelines', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        description,
        gatewayId: gatewayId || null,
        dataAllowlist,
      }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Pipeline "${name}" created`);
      setName('');
      setDescription('');
      setGatewayId('');
      setAllowlist('');
      onOpenChange(false);
      onSaved();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to create pipeline');
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New pipeline"
      description="A reusable, governed model-access contract. It runs on a gateway, fixes a hard data ceiling, and is consumed by apps, agents, and chat. Set the basics here; tune routing, policy, and guardrails on its detail page."
      footer={
        <Button onClick={save} disabled={busy || !name.trim()} className="w-full">
          Create pipeline
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pl-name">Name</Label>
          <Input
            id="pl-name"
            placeholder="Reimbursement Governance"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pl-desc">Description</Label>
          <Textarea
            id="pl-desc"
            placeholder="What this pipeline governs and how it's used."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pl-gateway">Runs on (gateway)</Label>
          <select
            id="pl-gateway"
            value={gatewayId}
            onChange={(e) => setGatewayId(e.target.value)}
            className={SELECT}
          >
            <option value="">Org default gateway</option>
            {gateways.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.egressClass})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            The model substrate this pipeline runs on. Leave as the org default to inherit.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pl-allow">Data allowlist (hard ceiling)</Label>
          <Textarea
            id="pl-allow"
            placeholder="kyc-records, customer-master, transactions"
            value={allowlist}
            onChange={(e) => setAllowlist(e.target.value)}
            rows={2}
          />
          <p className="text-[11px] text-muted-foreground">
            Comma- or newline-separated data-domain ids. Consumers may only ever touch data inside this
            set — to use more, edit the pipeline.
          </p>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </FormSheet>
  );
}

// The Pipelines library surface — full-width grid of pipeline cards + a URL-driven New sheet
// (?panel=new-pipeline so Back closes it and it's deep-linkable). Each card → the pipeline detail
// page. Templates and org pipelines are shown together; the card marks templates.
export function PipelinesManager({ pipelines }: Readonly<{ pipelines: PipelineCardData[] }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-pipeline';

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  const onDelete = useCallback(
    async (p: PipelineCardData) => {
      if (!confirm(`Delete pipeline "${p.name}"? Its version history is removed too. Consumers bound to it will fall back to the org default.`)) {
        return;
      }
      const res = await fetch(`/api/v1/admin/pipelines/${p.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`Pipeline "${p.name}" deleted`);
        router.refresh();
      } else {
        toast.error('Failed to delete pipeline');
      }
    },
    [router],
  );

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-foreground">Pipelines</h1>
          <p className="text-sm text-muted-foreground">
            Reusable, governed model-access contracts. A pipeline binds a gateway, fixes a hard data
            ceiling, and layers policy + guardrails; apps, agents, and chat consume it.
          </p>
        </div>
        <Button size="sm" onClick={() => setPanel('new-pipeline')}>
          <Plus className="size-4" />
          New pipeline
        </Button>
      </div>

      {pipelines.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No pipelines yet. Create one, or seed the sample BFSI templates with{' '}
            <span className="font-mono">POST /api/v1/admin/pipelines/seed</span>.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pipelines.map((p) => (
            <PipelineCard key={p.id} p={p} onDelete={onDelete} />
          ))}
        </div>
      )}

      <AddPipelineSheet open={open} onOpenChange={(o) => !o && setPanel(null)} onSaved={() => router.refresh()} />
    </div>
  );
}
