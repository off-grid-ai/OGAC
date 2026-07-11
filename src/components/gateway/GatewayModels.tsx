'use client';

import { useEffect, useState } from 'react';
import { ModelBrowser, useModelCatalog } from '@/components/gateway/ModelPicker';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ModelSpec } from '@/lib/model-catalog';

// Browsable MODEL CATALOG panel on the gateway overview (Task #128). Read-only reference: the full
// curated catalog of known model specs (family / modality / context window / params) reconciled
// against the LIVE fleet SSOT, so operators can see WHAT they can route to and which models the
// fleet is actually serving (badged "live") before authoring a routing rule. The routing-rule
// create/edit flow embeds the same picker to select a model.
export function GatewayModels() {
  const { models, loading, error } = useModelCatalog();
  const [detail, setDetail] = useState<ModelSpec | null>(null);
  const liveCount = models.filter((m) => m.servedOnFleet).length;

  // Pre-select the first model once the catalog loads so the spec pane shows real content
  // instead of an empty "Select a model…" placeholder. Only auto-selects while nothing is
  // chosen — a user's pick is never overridden.
  useEffect(() => {
    if (!detail && models.length > 0) setDetail(models[0]);
  }, [models, detail]);

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-sm">Model catalog</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Known model specs a routing rule can target. Fleet-served models are badged{' '}
            <span className="font-mono text-primary">live</span>.
          </p>
        </div>
        {!loading && !error ? (
          <Badge variant="secondary" className="font-mono text-[10px]">
            {liveCount} live · {models.length} total
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ModelBrowser
          models={models}
          loading={loading}
          error={error}
          selectedId={detail?.id}
          onPick={(m) => setDetail(m)}
        />
        <div className="rounded-md border border-border p-3">
          {detail ? (
            <dl className="space-y-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Model id</dt>
                <dd className="font-mono text-foreground">{detail.id}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Name</dt>
                <dd className="text-foreground">{detail.name}</dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-muted-foreground">Family</dt>
                  <dd className="text-foreground">{detail.family}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Modality</dt>
                  <dd className="text-foreground">{detail.modality}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Context window</dt>
                  <dd className="font-mono text-foreground">
                    {detail.contextWindow != null
                      ? `${detail.contextWindow.toLocaleString()} tokens`
                      : 'unknown'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Parameters</dt>
                  <dd className="font-mono text-foreground">
                    {detail.paramsB != null ? `${detail.paramsB}B` : 'unknown'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">License</dt>
                  <dd className="text-foreground">{detail.license ?? 'unknown'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">On fleet</dt>
                  <dd className="text-foreground">{detail.servedOnFleet ? 'yes (live)' : 'no'}</dd>
                </div>
              </div>
              {detail.note ? (
                <div>
                  <dt className="text-muted-foreground">Note</dt>
                  <dd className="text-foreground">{detail.note}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">
              Select a model to see its full spec (context window, params, license, fleet status).
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
