'use client';

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

interface GatewayOption {
  id: string;
  name: string;
  egressClass: string;
}

// The fields the edit sheet manages — the full governance contract that a pipeline owns and the
// founder asked to be editable: identity + visibility + binding + routing leash + hard data ceiling.
export interface PipelineEditData {
  id: string;
  name: string;
  description: string;
  visibility: string;
  gatewayId: string | null;
  defaultModel: string | null;
  egressAllowed: boolean;
  dataAllowlist: string[];
}

const VISIBILITIES = [
  { value: 'private', label: 'Private — only me' },
  { value: 'org', label: 'Organisation — everyone in the org' },
  { value: 'public', label: 'Public — anyone with the link' },
];

// PipelineEditSheet — the CANONICAL edit panel for a pipeline. URL-driven (?panel=edit so Back closes
// it + it's deep-linkable), prefilled from the current values, and it PATCHes
// /api/v1/admin/pipelines/[id] which bumps the version + freezes a snapshot. Reachable from both the
// Overview and the Gateway & Routing tab — one editor, no drift (DRY).
export function PipelineEditSheet({ data }: { data: PipelineEditData }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'edit';

  const close = useCallback(() => {
    const qs = withPanelParams(params.toString(), { panel: null });
    router.replace(panelHref(pathname, qs), { scroll: false });
  }, [params, pathname, router]);

  const [name, setName] = useState(data.name);
  const [description, setDescription] = useState(data.description);
  const [visibility, setVisibility] = useState(data.visibility);
  const [gatewayId, setGatewayId] = useState(data.gatewayId ?? '');
  const [defaultModel, setDefaultModel] = useState(data.defaultModel ?? '');
  const [egressAllowed, setEgressAllowed] = useState(data.egressAllowed);
  const [allowlist, setAllowlist] = useState(data.dataAllowlist.join(', '));
  const [gateways, setGateways] = useState<GatewayOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form from the latest server values every time the sheet opens (so a re-edit after a
  // save reflects the persisted state, not stale keystrokes).
  useEffect(() => {
    if (!open) return;
    setName(data.name);
    setDescription(data.description);
    setVisibility(data.visibility);
    setGatewayId(data.gatewayId ?? '');
    setDefaultModel(data.defaultModel ?? '');
    setEgressAllowed(data.egressAllowed);
    setAllowlist(data.dataAllowlist.join(', '));
    setError(null);
  }, [open, data]);

  // Load gateway options for the binding dropdown when the sheet opens.
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
    const res = await fetch(`/api/v1/admin/pipelines/${data.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        description,
        visibility,
        gatewayId: gatewayId || null,
        defaultModel: defaultModel || null,
        dataAllowlist,
        routing: { egressAllowed },
      }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Saved — a new version was recorded');
      close();
      router.refresh();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to save changes');
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Edit pipeline"
      size="lg"
      description="Every save records a new immutable version (see the Versions tab). Tune the identity, its gateway binding, the egress leash, and the hard data ceiling."
      footer={
        <Button onClick={save} disabled={busy || !name.trim()} className="w-full">
          Save changes
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pe-name">Name</Label>
          <Input id="pe-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pe-desc">Description</Label>
          <Textarea
            id="pe-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What this pipeline governs and how it's used."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pe-vis">Visibility</Label>
          <select
            id="pe-vis"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            className={SELECT}
          >
            {VISIBILITIES.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5 border-t pt-4">
          <Label htmlFor="pe-gateway">Runs on (gateway)</Label>
          <select
            id="pe-gateway"
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
          <Label htmlFor="pe-model">Default model</Label>
          <Input
            id="pe-model"
            placeholder="gateway default"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            The model requests default to. Leave blank to use the gateway&apos;s default.
          </p>
        </div>

        <div className="space-y-2 border-t pt-4">
          <Label>Egress leash</Label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={egressAllowed}
              onChange={(e) => setEgressAllowed(e.target.checked)}
              className="size-4"
            />
            <span>Allow cloud egress</span>
          </label>
          <p className="text-[11px] text-muted-foreground">
            When off, any routing rule that would send data to a cloud model is leashed to{' '}
            <span className="font-medium">block</span> — data never leaves the box. Fine-grained
            data_class rules live on the Gateway &amp; Routing tab.
          </p>
        </div>

        <div className="space-y-1.5 border-t pt-4">
          <Label htmlFor="pe-allow">Data allowlist (hard ceiling)</Label>
          <Textarea
            id="pe-allow"
            placeholder="kyc-records, customer-master, transactions"
            value={allowlist}
            onChange={(e) => setAllowlist(e.target.value)}
            rows={2}
          />
          <p className="text-[11px] text-muted-foreground">
            Comma- or newline-separated data-domain ids. Consumers may only ever touch data inside this
            set (deny-by-default when empty).
          </p>
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </FormSheet>
  );
}
