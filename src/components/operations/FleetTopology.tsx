'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { deriveClusters, type FleetNode } from '@/lib/fleet';

type TopologyMode = 'nodes' | 'clusters' | 'node' | 'cluster';

function NodeFacts({ node }: Readonly<{ node: FleetNode }>) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
      <div>
        <dt className="text-xs text-muted-foreground">Role</dt>
        <dd>{node.role}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Host</dt>
        <dd className="font-mono text-xs">
          {node.host}:{node.port}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Model</dt>
        <dd>{node.model || 'No model assigned'}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Routing</dt>
        <dd>
          {node.clusterHead ? 'Cluster worker' : node.enabled ? 'Enabled' : 'Out of rotation'}
        </dd>
      </div>
    </dl>
  );
}

export function FleetTopology({
  mode,
  resourceId,
}: Readonly<{ mode: TopologyMode; resourceId?: string }>) {
  const [nodes, setNodes] = useState<FleetNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/gateway/fleet', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { nodes?: FleetNode[]; error?: string };
        if (!response.ok)
          throw new Error(body.error ?? `Fleet registry failed (${response.status})`);
        setNodes(body.nodes ?? []);
      })
      .catch((cause: unknown) => {
        if ((cause as Error).name !== 'AbortError') setError((cause as Error).message);
      });
    return () => controller.abort();
  }, []);

  const topology = useMemo(() => deriveClusters(nodes ?? []), [nodes]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!nodes) return <p className="text-sm text-muted-foreground">Loading fleet registry…</p>;

  if (mode === 'node') {
    const node = nodes.find((candidate) => candidate.name === resourceId);
    if (!node)
      return (
        <p className="text-sm text-muted-foreground">
          Node “{resourceId}” is not present in the fleet registry.
        </p>
      );
    const cluster = node.clusterHead
      ? topology.clusters.find((candidate) => candidate.head.name === node.clusterHead)
      : topology.clusters.find((candidate) => candidate.head.name === node.name);
    return (
      <div className="w-full space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold">{node.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Physical node from the fleet registry.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link
              href={`/runtime/models?tab=control&panel=configure-node&node=${encodeURIComponent(node.name)}`}
            >
              Configure node
            </Link>
          </Button>
        </div>
        <Card>
          <CardContent className="pt-6">
            <NodeFacts node={node} />
          </CardContent>
        </Card>
        {cluster ? (
          <p className="text-sm text-muted-foreground">
            Cluster:{' '}
            <Link
              className="text-primary hover:underline"
              href={`/operations/clusters/${encodeURIComponent(cluster.head.name)}`}
            >
              {cluster.head.name}
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  if (mode === 'cluster') {
    const cluster = topology.clusters.find((candidate) => candidate.head.name === resourceId);
    if (!cluster)
      return (
        <p className="text-sm text-muted-foreground">
          Cluster “{resourceId}” is not present in the fleet registry.
        </p>
      );
    const members = [cluster.head, ...cluster.workers];
    return (
      <div className="w-full space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-semibold">{cluster.head.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compute cluster derived from registry head/member relationships.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {members.map((node) => (
            <Link key={node.name} href={`/operations/nodes/${encodeURIComponent(node.name)}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between font-mono text-base">
                    {node.name}
                    <Badge variant="outline">
                      {node.name === cluster.head.name ? 'head' : 'worker'}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <NodeFacts node={node} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  if (mode === 'clusters') {
    return (
      <div className="w-full space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Compute clusters</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Derived live from fleet registry head/member relationships.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {topology.clusters.map((cluster) => (
            <Link
              key={cluster.head.name}
              href={`/operations/clusters/${encodeURIComponent(cluster.head.name)}`}
            >
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <CardTitle className="font-mono text-base">{cluster.head.name}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {cluster.workers.length + 1} nodes · {cluster.workers.length} workers
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
        {topology.clusters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No clustered relationships are registered.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Physical nodes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every instance is populated from the fleet registry; routes contain no fixed node names.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {nodes.map((node) => (
          <Link key={node.name} href={`/operations/nodes/${encodeURIComponent(node.name)}`}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader>
                <CardTitle className="flex items-center justify-between font-mono text-base">
                  {node.name}
                  <Badge variant={node.enabled ? 'secondary' : 'outline'}>{node.role}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <NodeFacts node={node} />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No physical nodes are registered.</p>
      ) : null}
    </div>
  );
}
