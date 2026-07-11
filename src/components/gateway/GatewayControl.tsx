'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { HEALTH_META, type Health } from '@/components/gateway/GatewayTraffic';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toDisplayHost } from '@/lib/display-host';

interface Node {
  name: string;
  host: string;
  port: number;
  model: string;
  vision: boolean;
  health: Health;
  reachable: boolean;
  enabled: boolean;
  activeModel: string;
  installed: string[];
}

type NodeAction = 'model' | 'restart' | 'enable' | 'disable';
type Support = Record<NodeAction, { backed: boolean; needs: string }>;

interface NodesResponse {
  available: boolean;
  nodes: Node[];
  support: Support;
}

// Nothing is backed when the control plane is unreachable — used as the fallback response so the
// UI can render an explicit "unavailable" state (never a perpetual spinner) without null-guarding.
const UNAVAILABLE_SUPPORT: Support = {
  model: { backed: false, needs: '' },
  restart: { backed: false, needs: '' },
  enable: { backed: false, needs: '' },
  disable: { backed: false, needs: '' },
};

const selectCls =
  'h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30';

// One node card: health, current model, and the swap / restart / enable-disable
// controls. Each action executes for real via /api/v1/gateway/nodes/[name] →
// the aggregator's POST /nodes/:name (SSH-to-node from S1). Destructive actions
// confirm first; every action toasts its success/failure.
function NodeCard({
  node,
  support,
  onDone,
}: Readonly<{
  node: Node;
  support: Support;
  onDone: () => Promise<void>;
}>) {
  const h = HEALTH_META[node.health ?? 'unknown'];
  const [selected, setSelected] = useState(node.activeModel);
  const [pending, setPending] = useState<NodeAction | null>(null);

  // Keep the dropdown in sync when a refetch changes the active model out from under us.
  useEffect(() => setSelected(node.activeModel), [node.activeModel]);

  const run = async (action: NodeAction, label: string, model?: string) => {
    setPending(action);
    const t = toast.loading(`${label} ${node.name}…`);
    try {
      const r = await fetch(`/api/v1/gateway/nodes/${encodeURIComponent(node.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, model }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string; notActionable?: boolean };
      if (r.ok) {
        toast.success(`${label} ${node.name} — done`, { id: t });
      } else {
        toast.error(
          d.notActionable
            ? `Not actionable — ${d.error ?? 'the gateway declined'}`
            : (d.error ?? `${label} failed (${r.status})`),
          { id: t },
        );
      }
      await onDone();
    } catch (e) {
      toast.error(`${label} failed — ${(e as Error).message}`, { id: t });
    } finally {
      setPending(null);
    }
  };

  const modelBacked = support.model.backed;
  const restartBacked = support.restart.backed;
  const toggleBacked = node.enabled ? support.disable.backed : support.enable.backed;
  const togglePending = pending === 'enable' || pending === 'disable';
  const toggleLabel = node.enabled ? 'Disable' : 'Enable';

  return (
    <div className="flex flex-col rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
          <span className={`inline-block size-2 rounded-full ${h.dot}`} />
          {node.name}
        </span>
        <span className={`font-mono text-[10px] font-medium uppercase ${h.text}`}>{h.label}</span>
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{toDisplayHost(node.host)}</div>
      <div className="mt-2 flex items-center justify-between">
        <span className="font-mono text-xs text-foreground">{node.activeModel || '(none)'}</span>
        <div className="flex items-center gap-1">
          {node.vision ? (
            <Badge variant="secondary" className="bg-primary/10 font-mono text-[10px] text-primary">
              vision
            </Badge>
          ) : null}
          {!node.enabled ? (
            <Badge variant="secondary" className="font-mono text-[10px] text-muted-foreground">
              disabled
            </Badge>
          ) : null}
        </div>
      </div>

      {/* Model swap */}
      <div className="mt-3 flex items-center gap-1.5">
        <select
          className={selectCls}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={!node.installed.length || !modelBacked}
          aria-label={`Model for ${node.name}`}
        >
          {node.installed.length ? (
            node.installed.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))
          ) : (
            <option value="">no installed models</option>
          )}
        </select>
        <Button
          size="xs"
          variant="outline"
          title={support.model.needs}
          disabled={!selected || selected === node.activeModel || !modelBacked || pending !== null}
          onClick={() => {
            if (
              confirm(
                `Load "${selected}" on ${node.name}? In-flight requests on this node will drop while it restarts.`,
              )
            ) {
              void run('model', 'Swapping model on', selected);
            }
          }}
        >
          {pending === 'model' ? '…' : 'Swap'}
        </Button>
      </div>

      {/* Restart + enable/disable */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button
          size="xs"
          variant="ghost"
          title={support.restart.needs}
          disabled={!restartBacked || pending !== null}
          onClick={() => {
            if (confirm(`Restart ${node.name}'s gateway? In-flight requests on this node will drop.`)) {
              void run('restart', 'Restarting');
            }
          }}
        >
          {pending === 'restart' ? '…' : 'Restart'}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          title={node.enabled ? support.disable.needs : support.enable.needs}
          disabled={!toggleBacked || pending !== null}
          onClick={() => {
            const disabling = node.enabled;
            if (
              !disabling ||
              confirm(`Take ${node.name} out of the routing pool? Traffic will drain to the other nodes.`)
            ) {
              void run(disabling ? 'disable' : 'enable', disabling ? 'Disabling' : 'Enabling');
            }
          }}
        >
          {togglePending ? '…' : toggleLabel}
        </Button>
      </div>
    </div>
  );
}

// Gateway CONTROL plane — per-node management (swap / restart / enable-disable).
// Polls /api/v1/gateway/nodes every 5s and dispatches actions to
// /api/v1/gateway/nodes/[name], which proxies the aggregator's POST /nodes/:name.
export function GatewayControl() {
  const [data, setData] = useState<NodesResponse | null>(null);
  // Settled after the first fetch resolves (success OR failure) so a thrown/unreachable feed
  // shows an explicit "unavailable" state instead of a perpetual "Loading nodes…" spinner.
  const [loaded, setLoaded] = useState(false);

  const refetch = async () => {
    try {
      const r = await fetch('/api/v1/gateway/nodes', { cache: 'no-store' });
      setData((await r.json()) as NodesResponse);
    } catch {
      // Feed unreachable: treat as an unavailable control plane rather than keeping null forever.
      setData((prev) => prev ?? { nodes: [], available: false, support: UNAVAILABLE_SUPPORT });
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (alive) await refetch();
    };
    void tick();
    const id = setInterval(() => void tick(), 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const nodes = data?.nodes ?? [];

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Node control</CardTitle>
        <p className="text-xs text-muted-foreground">
          Swap the active model, restart the gateway, or toggle a node in and out of the routing pool.
          Each action executes on the host through the cluster gateway.
        </p>
      </CardHeader>
      <CardContent>
        {data && !data.available ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Control plane unavailable — the cluster gateway is not reachable.
          </div>
        ) : nodes.length && data ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {nodes.map((n) => (
              <NodeCard key={n.name} node={n} support={data.support} onDone={refetch} />
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-muted-foreground">
            {loaded ? 'No nodes discovered in the pool.' : 'Loading nodes…'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
