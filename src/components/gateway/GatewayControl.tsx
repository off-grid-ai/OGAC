'use client';

import { Trash } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { HEALTH_META, type Health } from '@/components/gateway/GatewayTraffic';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Node {
  name: string;
  host: string;
  model: string;
  vision: boolean;
  health: Health;
  reachable: boolean;
  active: Record<string, string> | null;
  installed: string[];
  catalogCount: number;
}

interface NodesResponse {
  available: boolean;
  nodes: Node[];
}

const selectCls =
  'h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30';

type Action = 'activate' | 'unload' | 'pull' | 'delete';

// One node card: health, current model, and the load/unload/pull/delete controls.
// eslint-disable-next-line complexity
function NodeCard({ node, onDone }: { node: Node; onDone: () => Promise<void> }) {
  const h = HEALTH_META[node.health ?? 'unknown'];
  const activeText = node.active?.text ?? node.model;
  const [selected, setSelected] = useState(activeText);
  const [pullId, setPullId] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const post = async (key: string, body: { action: Action; id?: string; kind?: string }) => {
    setPending(key);
    try {
      await fetch(`/api/v1/gateway/nodes/${encodeURIComponent(node.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await onDone();
    } catch {
      /* refetch on next poll */
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
          <span className={`inline-block size-2 rounded-full ${h.dot}`} />
          {node.name}
        </span>
        <span className={`font-mono text-[10px] font-medium uppercase ${h.text}`}>{h.label}</span>
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{node.host}</div>
      <div className="mt-2 flex items-center justify-between">
        <span className="font-mono text-xs text-foreground">{activeText || '(none)'}</span>
        {node.vision ? (
          <Badge variant="secondary" className="bg-primary/10 font-mono text-[10px] text-primary">
            vision
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <select
          className={selectCls}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={!node.installed.length}
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
          disabled={!selected || pending === 'activate'}
          onClick={() => post('activate', { action: 'activate', id: selected })}
        >
          {pending === 'activate' ? '…' : 'Load / switch'}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={pending === 'unload'}
          onClick={() => post('unload', { action: 'unload', kind: 'text' })}
        >
          {pending === 'unload' ? '…' : 'Unload'}
        </Button>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <Input
          value={pullId}
          onChange={(e) => setPullId(e.target.value)}
          placeholder="pull model id…"
          className="h-8 font-mono text-xs"
        />
        <Button
          size="xs"
          variant="outline"
          disabled={!pullId.trim() || pending === 'pull'}
          onClick={() => post('pull', { action: 'pull', id: pullId.trim() })}
        >
          {pending === 'pull' ? '…' : 'Pull'}
        </Button>
      </div>

      {node.installed.length ? (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {node.installed.map((m) => (
            <div key={m} className="flex items-center justify-between">
              <span className="truncate font-mono text-[11px] text-muted-foreground">{m}</span>
              <Button
                size="icon-xs"
                variant="ghost"
                title={`Delete ${m}`}
                disabled={pending === `delete:${m}`}
                onClick={() => {
                  if (confirm(`Delete ${m} from ${node.name}? This removes the weights.`)) {
                    post(`delete:${m}`, { action: 'delete', id: m });
                  }
                }}
              >
                <Trash className="text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Gateway CONTROL plane — per-node model management (load/switch/unload/pull/delete). Polls
// /api/v1/gateway/nodes every 5s and dispatches actions to /api/v1/gateway/nodes/[name].
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
    tick();
    const id = setInterval(tick, 5000);
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
        ) : nodes.length ? (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
            {nodes.map((n) => (
              <NodeCard key={n.name} node={n} onDone={refetch} />
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
