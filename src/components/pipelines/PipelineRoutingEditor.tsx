'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PipelineActions } from './PipelineActions';
import { PipelineEditSheet } from './PipelineEditSheet';

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

interface GatewayOption {
  id: string;
  name: string;
  egressClass: string;
}

export interface RoutingEditorData {
  id: string;
  name: string;
  description: string;
  status: string;
  visibility: string;
  gatewayId: string | null;
  defaultModel: string | null;
  egressAllowed: boolean;
  dataAllowlist: string[];
  /** A read-only summary of the routing rules (rule editing is a fan-out; the leash toggle is here). */
  ruleSummary: { name: string; value: string; action: string }[];
}

// The Gateway & Routing tab — the FUNCTIONAL editor for the pipeline's binding + egress leash + hard
// data ceiling. PATCHes /api/v1/admin/pipelines/[id] which bumps the version + writes a snapshot.
export function PipelineRoutingEditor({ data }: { data: RoutingEditorData }) {
  const router = useRouter();
  const [gatewayId, setGatewayId] = useState(data.gatewayId ?? '');
  const [defaultModel, setDefaultModel] = useState(data.defaultModel ?? '');
  const [egressAllowed, setEgressAllowed] = useState(data.egressAllowed);
  const [allowlist, setAllowlist] = useState(data.dataAllowlist.join(', '));
  const [gateways, setGateways] = useState<GatewayOption[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
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
  }, []);

  async function save() {
    if (busy) return;
    setBusy(true);
    const dataAllowlist = allowlist
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await fetch(`/api/v1/admin/pipelines/${data.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gatewayId: gatewayId || null,
        defaultModel: defaultModel || null,
        dataAllowlist,
        routing: { egressAllowed, rules: undefined },
      }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Saved — a new version was recorded');
      router.refresh();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(body?.error ?? 'Failed to save');
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-foreground">Gateway &amp; Routing</h2>
          <p className="text-sm text-muted-foreground">
            The gateway this pipeline runs on, its egress leash, and the hard data ceiling. Every save
            records a new immutable version.
          </p>
        </div>
        <PipelineActions pipelineId={data.id} status={data.status} name={data.name} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Gateway binding</CardTitle>
            <p className="text-xs text-muted-foreground">The model substrate this pipeline runs on.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rt-gateway">Gateway</Label>
              <select
                id="rt-gateway"
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
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-model">Default model</Label>
              <Input
                id="rt-model"
                placeholder="gateway default"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Data ceiling (hard allowlist)</CardTitle>
            <p className="text-xs text-muted-foreground">
              Comma- or newline-separated data-domain ids. This is the HARD ceiling — consumers may
              only ever touch data inside it.
            </p>
          </CardHeader>
          <CardContent>
            <Textarea
              value={allowlist}
              onChange={(e) => setAllowlist(e.target.value)}
              rows={3}
              placeholder="kyc-records, customer-master, transactions"
            />
          </CardContent>
        </Card>

        <Button onClick={save} disabled={busy}>
          Save changes
        </Button>
      </div>

      <div className="space-y-6">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Egress leash</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={egressAllowed}
                onChange={(e) => setEgressAllowed(e.target.checked)}
                className="size-4"
              />
              <span>Allow cloud egress</span>
            </label>
            <p className="text-xs text-muted-foreground">
              When off, any routing rule that would send data to a cloud model is leashed to
              <span className="font-medium"> block</span> — data never leaves the box.
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Routing rules</CardTitle>
            <p className="text-xs text-muted-foreground">
              data_class → local | cloud | block, in priority order.
            </p>
          </CardHeader>
          <CardContent className="text-xs">
            {data.ruleSummary.length === 0 ? (
              <p className="text-muted-foreground">No rules — defaults to local.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.ruleSummary.map((r) => (
                  <li key={r.name} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-muted-foreground">{r.value || r.name}</span>
                    <span className="font-medium text-foreground">{r.action}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      </div>

      <PipelineEditSheet
        data={{
          id: data.id,
          name: data.name,
          description: data.description,
          visibility: data.visibility,
          gatewayId: data.gatewayId,
          defaultModel: data.defaultModel,
          egressAllowed: data.egressAllowed,
          dataAllowlist: data.dataAllowlist,
        }}
      />
    </div>
  );
}
