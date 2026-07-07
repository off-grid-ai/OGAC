'use client';

import { Cloud, HardDrives } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface PipelineOverviewData {
  id: string;
  name: string;
  description: string;
  status: string;
  version: number;
  visibility: string;
  isTemplate: boolean;
  defaultModel: string | null;
  dataAllowlist: string[];
  gateway?: { id: string; name: string; kind: string; egressClass: string } | null;
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-foreground">{children}</CardContent>
    </Card>
  );
}

// The Overview tab — the pipeline at a glance: its binding, data ceiling, status, and the publish
// action. Publishing freezes an immutable version snapshot (see the Versions tab).
export function PipelineOverview({ pipeline }: { pipeline: PipelineOverviewData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function publish() {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/v1/admin/pipelines/${pipeline.id}/publish`, { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      toast.success(`Published "${pipeline.name}"`);
      router.refresh();
    } else {
      toast.error('Failed to publish');
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-medium text-foreground">{pipeline.name}</h2>
            <Badge variant="outline" className="text-xs">v{pipeline.version}</Badge>
            {pipeline.isTemplate ? (
              <Badge variant="secondary" className="bg-primary/10 text-primary">template</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {pipeline.description || 'No description.'}
          </p>
        </div>
        {pipeline.status !== 'published' ? (
          <Button size="sm" onClick={publish} disabled={busy}>
            Publish
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Status">
          <span className="capitalize">{pipeline.status}</span>
        </StatCard>
        <StatCard label="Runs on">
          {pipeline.gateway ? (
            <div className="flex items-center gap-2">
              <span>{pipeline.gateway.name}</span>
              {pipeline.gateway.egressClass === 'on-prem' ? (
                <Badge variant="secondary" className="bg-primary/10 text-primary">
                  <HardDrives className="size-3" /> on-prem
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Cloud className="size-3" /> cloud
                </Badge>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">Org default gateway</span>
          )}
        </StatCard>
        <StatCard label="Default model">
          <span className="font-mono text-xs">{pipeline.defaultModel || 'gateway default'}</span>
        </StatCard>
        <StatCard label="Visibility">
          <span className="capitalize">{pipeline.visibility}</span>
        </StatCard>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Data ceiling (hard allowlist)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Consumers may only ever touch data inside this set. To use more, edit the pipeline on the
            Gateway &amp; Routing tab.
          </p>
        </CardHeader>
        <CardContent>
          {pipeline.dataAllowlist.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No data domains allowed — this pipeline touches no data (deny-by-default).
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {pipeline.dataAllowlist.map((d) => (
                <Badge key={d} variant="outline" className="font-mono text-xs">
                  {d}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
