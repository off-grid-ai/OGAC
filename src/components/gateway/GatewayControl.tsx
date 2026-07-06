'use client';

import { useEffect, useState } from 'react';
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

const selectCls =
  'h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30';

// One node card: health, current model, and the swap / restart / enable-disable
// controls. An action with no real backend (support[action].backed === false) is
// rendered DISABLED with the reason as a tooltip — never POST-and-pretend.
// eslint-disable-next-line complexity
function NodeCard({
  node,
  support,
  onDone,
}: {
  node: Node;
  support: Support;
  onDone: () => Promise<void>;
}) {
  const h = HEALTH_META[node.health ?? 'unknown'];
  const [selected, setSelected] = useState(node.activeModel);
  const [pending, setPending] = useState<NodeAction | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (action: NodeAction, model?: string) => {
    setPending(action);
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/gateway/nodes/${encodeURIComponent(node.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, model }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string; notActionable?: boolean };
      if (!r.ok) setMsg(d.notActionable ? `not actionable — ${d.error}` : (d.error ?? 'failed'));
      await onDone();
    } catch {
      setMsg('request failed');
    } finally {
      setPending(null);
    }
  };

  const modelBacked = support.model.backed;
  const restartBacked = support.restart.backed;
  const toggleBacked = node.enabled ? support.disable.backed : support.enable.backed;

  return (
    <div className="rounded-md border border-border px-3 py-2.5">
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
          title={modelBacked ? 'Load / switch active model' : support.model.needs}
          disabled={!selected || !modelBacked || pending === 'model'}
          onClick={() => void run('model', selected)}
        >
          {pending === 'model' ? '…' : 'Swap'}
        </Button>
      </div>

      {/* Restart + enable/disable */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button
          size="xs"
          variant="ghost"
          title={restartBacked ? "Reload the node's gateway" : support.restart.needs}
          disabled={!restartBacked || pending === 'restart'}
          onClick={() => {
            if (confirm(`Restart ${node.name}'s gateway? In-flight requests on this node will drop.`)) {
              void run('restart');
            }
          }}
        >
          {pending === 'restart' ? '…' : 'Restart'}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          title={toggleBacked ? 'Toggle this node in the routing pool' : support.disable.needs}
          disabled={!toggleBacked || pending === 'enable' || pending === 'disable'}
          onClick={() => void run(node.enabled ? 'disable' : 'enable')}
        >
          {pending === 'enable' || pending === 'disable' ? '…' : node.enabled ? 'Disable' : 'Enable'}
        </Button>
      </div>

      {!modelBacked && !restartBacked && !toggleBacked ? (
        <p className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
          Node control is read-only here — the cluster gateway is a router and does not front
          model-load / restart / pool-toggle yet. These need on-host execution.
        </p>
      ) : null}

      {msg ? <p className="mt-2 text-[10px] text-amber-600">{msg}</p> : null}
    </div>
  );
}

// Gateway CONTROL plane — per-node management (swap / restart / enable-disable).
// Polls /api/v1/gateway/nodes every 5s and dispatches actions to
// /api/v1/gateway/nodes/[name]. Honest: unbacked actions render disabled.
export function GatewayControl() {
  const [data, setData] = useState<NodesResponse | null>(null);

  const refetch = async () => {
    try {
      const r = await fetch('/api/v1/gateway/nodes', { cache: 'no-store' });
      setData((await r.json()) as NodesResponse);
    } catch {
      /* keep last snapshot */
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
      </CardHeader>
      <CardContent>
        {data && !data.available ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Control plane unavailable — the cluster gateway is not reachable.
          </div>
        ) : nodes.length && data ? (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
            {nodes.map((n) => (
              <NodeCard key={n.name} node={n} support={data.support} onDone={refetch} />
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-muted-foreground">
            {data ? 'No nodes discovered in the pool.' : 'Loading nodes…'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
