'use client';

import {
  ArrowLeft,
  Cpu,
  Lock,
  Pencil,
  Trash,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { egressBadge, statusBadge } from '@/components/gateways/GatewaysManager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { GatewayView } from '@/lib/gateways-policy';
import { mergeFleetServed, type ModelSpec } from '@/lib/model-catalog';

const KIND_LABEL: Record<string, string> = {
  'on-prem': 'On-prem cluster',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  compat: 'OpenAI-compatible',
};

interface PipelineSummary {
  id: string;
  name: string;
  status: string;
  visibility: string;
  defaultModel: string | null;
}

// The node view the aggregator /nodes proxy returns (see src/lib/gateway.ts mapAggregatorNode).
interface NodeView {
  name: string;
  host: string;
  model: string;
  vision: boolean;
  health: 'up' | 'degraded' | 'down' | 'unknown';
  reachable: boolean;
  enabled: boolean;
}

function fmtCtx(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function ModelSpecTable({ specs, emptyNote }: { specs: ModelSpec[]; emptyNote: string }) {
  if (specs.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyNote}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead>Family</TableHead>
            <TableHead>Context</TableHead>
            <TableHead>Modality</TableHead>
            <TableHead>Params</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {specs.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <div className="font-mono text-xs text-foreground">{m.id}</div>
                <div className="text-[11px] text-muted-foreground">{m.name}</div>
              </TableCell>
              <TableCell className="text-muted-foreground">{m.family}</TableCell>
              <TableCell className="text-muted-foreground">{fmtCtx(m.contextWindow)}</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-muted-foreground">
                  {m.modality}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {m.paramsB === null ? '—' : `${m.paramsB}B`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const NODE_HEALTH_CLS: Record<string, string> = {
  up: 'bg-primary/10 text-primary',
  degraded: 'bg-amber-500/10 text-amber-600',
  down: 'bg-destructive/10 text-destructive',
  unknown: 'bg-muted text-muted-foreground',
};

function NodePool() {
  const [state, setState] = useState<{ loading: boolean; available: boolean; nodes: NodeView[] }>({
    loading: true,
    available: false,
    nodes: [],
  });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch('/api/v1/gateway/nodes', { cache: 'no-store' });
        const d = (await r.json()) as { available?: boolean; nodes?: NodeView[] };
        if (live) setState({ loading: false, available: Boolean(d.available), nodes: d.nodes ?? [] });
      } catch {
        if (live) setState({ loading: false, available: false, nodes: [] });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Cpu className="size-4 text-primary" /> Node pool
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Live fleet nodes fronting this gateway, probed through the aggregator. Health is the strict
          probe truth — never faked.
        </p>
      </CardHeader>
      <CardContent>
        {state.loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Probing the fleet…</p>
        ) : !state.available ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            The aggregator did not answer — node inventory is unavailable right now.
          </p>
        ) : state.nodes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No nodes in the pool.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Node</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Pool</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.nodes.map((n) => (
                  <TableRow key={n.name}>
                    <TableCell>
                      <div className="text-xs text-foreground">{n.name}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{n.host}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {n.model || '—'}
                      {n.vision ? <span className="ml-1 text-[10px]">(vision)</span> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={NODE_HEALTH_CLS[n.health] ?? ''}>
                        {n.health}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {n.enabled ? 'enabled' : 'disabled'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const PIPE_STATUS_CLS: Record<string, string> = {
  published: 'bg-primary/10 text-primary',
  draft: 'bg-muted text-muted-foreground',
  archived: 'bg-muted text-muted-foreground',
};

export function GatewayDetail({
  gateway,
  pipelines,
  isOnPrem,
  fleetModelBaseline,
  defaultModelSpec,
}: {
  gateway: GatewayView;
  pipelines: PipelineSummary[];
  isOnPrem: boolean;
  fleetModelBaseline: ModelSpec[];
  defaultModelSpec: ModelSpec | null;
}) {
  const router = useRouter();

  // On-prem: reconcile the fleet-served baseline against the LIVE node routing tags so the catalog
  // reflects what the fleet is actually serving — not a static assumption. Cloud: show the default
  // model's published spec if it's a known catalog entry.
  const [onPremModels, setOnPremModels] = useState<ModelSpec[]>(fleetModelBaseline);

  useEffect(() => {
    if (!isOnPrem) return;
    let live = true;
    (async () => {
      try {
        const r = await fetch('/api/v1/gateway/nodes', { cache: 'no-store' });
        const d = (await r.json()) as { nodes?: { model: string }[] };
        const tags = (d.nodes ?? []).map((n) => n.model).filter(Boolean);
        if (!live) return;
        // Reconcile against live tags; keep only the models the fleet actually serves.
        const merged = mergeFleetServed(fleetModelBaseline, tags).filter((m) => m.servedOnFleet);
        setOnPremModels(merged.length ? merged : fleetModelBaseline);
      } catch {
        /* keep the static baseline on probe failure — honest fallback */
      }
    })();
    return () => {
      live = false;
    };
  }, [isOnPrem, fleetModelBaseline]);

  const onDelete = useCallback(async () => {
    if (!confirm(`Delete gateway "${gateway.name}"? Pipelines bound to it will fall back to the org default.`)) return;
    const res = await fetch(`/api/v1/admin/gateways/${gateway.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(`Gateway "${gateway.name}" deleted`);
      router.push('/gateways');
      router.refresh();
    } else {
      toast.error('Failed to delete gateway');
    }
  }, [gateway.id, gateway.name, router]);

  const facts = [
    { label: 'Kind', value: KIND_LABEL[gateway.kind] ?? gateway.kind },
    { label: 'Egress', value: gateway.egressClass === 'on-prem' ? 'stays on-prem' : 'leaves (cloud)' },
    { label: 'Default model', value: gateway.defaultModel || '—' },
    { label: 'Enabled', value: gateway.enabled ? 'yes' : 'no' },
    { label: 'Available', value: gateway.available ? 'yes' : 'no' },
  ];

  return (
    <div className="w-full space-y-6">
      <Link
        href="/gateways"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Gateways
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold text-foreground">{gateway.name}</h1>
            {statusBadge(gateway)}
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{gateway.id}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{egressBadge(gateway.egressClass)}</div>
        </div>
        <div className="flex items-center gap-2">
          {/* Edit deep-links back to the list's URL-driven edit panel — one sheet, no fork. */}
          <Button size="sm" variant="outline" asChild>
            <Link href={`/gateways?panel=edit-gateway&id=${gateway.id}`}>
              <Pencil className="size-4" /> Edit
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash className="size-4" /> Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {facts.map((f) => (
          <Card key={f.label} className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                {f.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="truncate text-sm font-medium text-foreground">{f.value}</CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Endpoint & auth — never render a secret; report presence only. */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Lock className="size-4 text-muted-foreground" /> Endpoint &amp; auth
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Base URL</div>
              <div className="mt-1 break-all font-mono text-xs text-foreground">
                {gateway.baseUrl || (isOnPrem ? 'aggregator (fleet-configured)' : 'provider default')}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Credentials</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {isOnPrem
                  ? 'Served by the fleet — no outbound key. Aggregator auth is handled server-side.'
                  : gateway.configured
                    ? 'A provider key is configured (stored server-side; never shown here).'
                    : 'No provider key configured — this gateway is unconfigured.'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Health</div>
              <div className="mt-1 text-xs text-foreground">{gateway.detail}</div>
            </div>
          </CardContent>
        </Card>

        {/* Pipelines bound to this gateway — the real linkage (many pipelines : one gateway). */}
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pipelines running on this gateway</CardTitle>
            <p className="text-xs text-muted-foreground">
              {pipelines.length} pipeline{pipelines.length === 1 ? '' : 's'} bound to this gateway.
            </p>
          </CardHeader>
          <CardContent>
            {pipelines.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No pipelines are bound to this gateway yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pipeline</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Visibility</TableHead>
                      <TableHead>Default model</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pipelines.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Link
                            href={`/pipelines/${p.id}`}
                            className="text-foreground hover:text-primary hover:underline"
                          >
                            {p.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={PIPE_STATUS_CLS[p.status] ?? ''}>
                            {p.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{p.visibility}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {p.defaultModel || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* On-prem: node pool health. Cloud gateways have no fleet nodes. */}
      {isOnPrem ? <NodePool /> : null}

      {/* Model catalog — published specs (context window / modality / family), never fabricated. */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Model catalog</CardTitle>
          <p className="text-xs text-muted-foreground">
            {isOnPrem
              ? 'Models this fleet serves (reconciled against live node routing tags). Specs are real published values; unknown → —.'
              : 'The default model’s published spec, when it’s a known catalog entry. Cloud providers expose many models; we never guess a spec.'}
          </p>
        </CardHeader>
        <CardContent>
          {isOnPrem ? (
            <ModelSpecTable
              specs={onPremModels}
              emptyNote="No fleet-served models are known for this gateway."
            />
          ) : (
            <ModelSpecTable
              specs={defaultModelSpec ? [defaultModelSpec] : []}
              emptyNote={
                gateway.defaultModel
                  ? `"${gateway.defaultModel}" is not in the curated catalog — spec unknown.`
                  : 'No default model set — nothing to describe.'
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
