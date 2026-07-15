'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { toDisplayHost } from '@/lib/display-host';
import { deriveClusters } from '@/lib/fleet';
import { getModelSpec, modelLabel } from '@/lib/model-catalog';

// The fleet_nodes SSOT editor — the authoritative place to configure a node: which
// model it serves (id + gguf + mmproj), its context size, role/kind, and whether it's
// in the routing pool. Saving writes the DB (aggregator routing + status page follow)
// and PUSHES model changes to the node (active-model.json + kickstart, via the aggregator).
interface FleetNode {
  name: string;
  host: string;
  port: number;
  role: string;
  kind: string;
  model: string;
  primaryGguf: string;
  mmprojGguf: string;
  modelId: string;
  contextSize: number | null;
  vision: boolean;
  enabled: boolean;
  notes: string;
  clusterHead?: string | null; // RPC worker: the head node it's bonded to (null ⇒ standalone/head)
  rpcPort?: number | null; // worker's ggml-rpc-server port (null ⇒ 50052)
}

const ROLES = ['gateway', 'server', 'image', 'spare'];
const KINDS = ['chat', 'grounding', 'image'];
const inputCls = 'h-8 text-xs font-mono';

function EditDialog({
  node,
  open,
  onOpenChange,
  onSaved,
}: Readonly<{
  node: FleetNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}>) {
  const [form, setForm] = useState<FleetNode>(node);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setForm(node), [node]);

  const set = <K extends keyof FleetNode>(k: K, v: FleetNode[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/gateway/fleet/${encodeURIComponent(node.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: form.host,
          port: Number(form.port),
          role: form.role,
          kind: form.kind,
          model: form.model,
          modelId: form.modelId,
          primaryGguf: form.primaryGguf,
          mmprojGguf: form.mmprojGguf,
          contextSize: form.contextSize === null || `${form.contextSize}` === '' ? null : Number(form.contextSize),
          vision: form.vision,
          enabled: form.enabled,
          clusterHead: form.clusterHead ? String(form.clusterHead).trim() : null,
          rpcPort: form.rpcPort === null || `${form.rpcPort ?? ''}` === '' ? null : Number(form.rpcPort),
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ ok: false, text: d.error ?? `save failed (${r.status})` });
      } else {
        let pushed = '';
        if (d.push?.ok) pushed = ' · pushed to node';
        else if (d.push?.status === 501) pushed = ' · saved (node push not actionable)';
        else if (d.push?.error) pushed = ` · push error: ${d.push.error}`;
        setMsg({ ok: true, text: `saved${pushed}` });
        await onSaved();
        setTimeout(() => onOpenChange(false), 900);
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, k: keyof FleetNode, opts?: { placeholder?: string; type?: string }) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        className={inputCls}
        type={opts?.type ?? 'text'}
        placeholder={opts?.placeholder}
        value={form[k] === null ? '' : String(form[k])}
        onChange={(e) => {
          let next: string | number | null = e.target.value;
          if (opts?.type === 'number') next = e.target.value === '' ? null : Number(e.target.value);
          set(k, next as never);
        }}
      />
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm">Configure {node.name}</SheetTitle>
        </SheetHeader>
        <SheetBody>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Role</Label>
            <select
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs dark:bg-input/30"
              value={form.role}
              onChange={(e) => set('role', e.target.value)}
            >
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Kind (routing)</Label>
            <select
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs dark:bg-input/30"
              value={form.kind}
              onChange={(e) => set('kind', e.target.value)}
            >
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          {field('Model tag (routing)', 'model', { placeholder: 'e.g. fleet-chat-9b' })}
          {field('Context size (n_ctx)', 'contextSize', { type: 'number', placeholder: 'node default' })}
          {field('Model id', 'modelId', { placeholder: 'empero-ai/…-GGUF' })}
          {field('Host', 'host')}
          {field('Primary GGUF', 'primaryGguf', { placeholder: 'Model-Q4_K_M.gguf' })}
          {field('mmproj GGUF (vision)', 'mmprojGguf', { placeholder: 'mmproj-…-f16.gguf' })}
          {field('Cluster head (RPC worker of…)', 'clusterHead', { placeholder: 'e.g. g7 — empty for standalone' })}
          {field('RPC port', 'rpcPort', { type: 'number', placeholder: '50052' })}
        </div>
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <Switch checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
            <span className="text-xs">{form.enabled ? 'In routing pool' : 'Out of rotation'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.vision} onCheckedChange={(v) => set('vision', v)} />
            <span className="text-xs">Vision</span>
          </div>
        </div>
        {msg ? (
          <p className={`text-xs ${msg.ok ? 'text-primary' : 'text-destructive'}`}>{msg.text}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Saving writes the fleet SSOT and pushes model changes to the node (active-model.json + restart).
          </p>
        )}
        </SheetBody>
        <SheetFooter>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save & apply'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

type CardProps = Readonly<{
  configuring: string | null;
  setConfiguring: (name: string | null) => void;
  onSaved: () => Promise<void>;
}>;

/** The context to show for a serving node: its own override, else the catalog window. */
function nodeCtx(n: FleetNode): number | null {
  return n.contextSize ?? getModelSpec(n.model)?.contextWindow ?? null;
}

/** A single standalone fleet node (gateway / image / server / spare). */
function NodeCard({ node, configuring, setConfiguring, onSaved }: CardProps & { node: FleetNode }) {
  const ctx = nodeCtx(node);
  return (
    <div className="flex flex-col justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{node.name}</span>
          <Badge variant="secondary" className="text-[10px]">{node.role}</Badge>
          {!node.enabled && node.role !== 'server' ? (
            <Badge variant="outline" className="text-[10px]">disabled</Badge>
          ) : null}
        </div>
        {node.role !== 'server' ? (
          <p className="truncate text-xs text-muted-foreground">
            {node.model ? modelLabel(node.model) : '(no model)'}
            {ctx ? ` · ${ctx.toLocaleString()} ctx` : ''}
          </p>
        ) : (
          <p className="truncate font-mono text-xs text-muted-foreground">{toDisplayHost(node.host)}</p>
        )}
      </div>
      <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={() => setConfiguring(node.name)}>
        Configure
      </Button>
      <EditDialog
        node={node}
        open={configuring === node.name}
        onOpenChange={(o) => setConfiguring(o ? node.name : null)}
        onSaved={onSaved}
      />
    </div>
  );
}

/** A distributed RPC cluster: one serving head backed by bonded workers. Workers are shown
 *  under the head (not as their own gateway cards) and each is individually configurable. */
function ClusterCard({
  head,
  workers,
  configuring,
  setConfiguring,
  onSaved,
}: CardProps & { head: FleetNode; workers: FleetNode[] }) {
  const members = [head, ...workers];
  const ctx = nodeCtx(head);
  return (
    <div className="flex flex-col justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5">
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{head.name}</span>
          <Badge className="text-[10px]">RPC cluster</Badge>
          <span className="text-[10px] text-muted-foreground">
            {members.length} nodes · :{head.port}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {head.model ? modelLabel(head.model) : '(no model)'}
          {ctx ? ` · ${ctx.toLocaleString()} ctx` : ''}
        </p>
        <div className="flex flex-wrap gap-1">
          {members.map((m) => (
            <button
              key={m.name}
              type="button"
              onClick={() => setConfiguring(m.name)}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:border-primary"
            >
              {m.name}
              <span className="text-muted-foreground">{m.name === head.name ? ' · head' : ' · worker'}</span>
            </button>
          ))}
        </div>
      </div>
      <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={() => setConfiguring(head.name)}>
        Configure head
      </Button>
      {members.map((m) => (
        <EditDialog
          key={m.name}
          node={m}
          open={configuring === m.name}
          onOpenChange={(o) => setConfiguring(o ? m.name : null)}
          onSaved={onSaved}
        />
      ))}
    </div>
  );
}

export function GatewayFleetConfig() {
  const router = useRouter();
  const params = useSearchParams();
  const [nodes, setNodes] = useState<FleetNode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Which node's config panel is open lives in the URL (?panel=configure-node&node=<name>) so
  // Back closes it and the panel is deep-linkable — never local-only state.
  const configuring =
    params.get('panel') === 'configure-node' ? params.get('node') : null;

  const setConfiguring = useCallback(
    (name: string | null) => {
      const p = new URLSearchParams(params.toString());
      if (name) {
        p.set('panel', 'configure-node');
        p.set('node', name);
      } else {
        p.delete('panel');
        p.delete('node');
      }
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  const load = async () => {
    try {
      const r = await fetch('/api/v1/gateway/fleet', { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? 'failed to load fleet'); return; }
      setNodes(d.nodes ?? []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => { void load(); }, []);

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Fleet configuration (source of truth)</CardTitle>
        <p className="text-xs text-muted-foreground">
          Edit a node&apos;s model, context size, and pool membership. Changes persist to the DB and
          push to the node — routing and the status page follow automatically.
        </p>
      </CardHeader>
      <CardContent>
        {err ? <p className="text-xs text-destructive">{err}</p> : null}
        {nodes === null && !err ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
        {nodes?.length === 0 ? <p className="text-xs text-muted-foreground">No fleet_nodes rows.</p> : null}
        {nodes?.length
          ? (() => {
              // One grouping rule (deriveClusters, unit-tested): RPC workers fold under their
              // head as a single cluster card; everything else renders as a standalone node.
              const { clusters, standalone } = deriveClusters(nodes);
              return (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {clusters.map((c) => (
                    <ClusterCard
                      key={c.head.name}
                      head={c.head}
                      workers={c.workers}
                      configuring={configuring}
                      setConfiguring={setConfiguring}
                      onSaved={load}
                    />
                  ))}
                  {standalone.map((n) => (
                    <NodeCard
                      key={n.name}
                      node={n}
                      configuring={configuring}
                      setConfiguring={setConfiguring}
                      onSaved={load}
                    />
                  ))}
                </div>
              );
            })()
          : null}
      </CardContent>
    </Card>
  );
}
