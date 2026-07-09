'use client';

import { Buildings, CheckCircle, ShieldCheck, Sparkle } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  type CatalogFilter,
  type EngineStatus,
  type GuardrailCatalogItem,
  type GuardrailKind,
  GUARDRAIL_CATALOG,
  GUARDRAIL_CATEGORIES,
  buildEnablePayload,
  catalogByCategory,
  filterCatalog,
  isFilterActive,
  isItemEnabled,
  itemAvailability,
} from '@/lib/guardrails-catalog';
import { enableGuardrailOnPipeline, pipelinesEnforcingGuardrail } from '@/lib/pipeline-governance';

// Browse & enable the STANDARD guardrails (Builder Epic #124). A non-technical operator searches /
// filters the bundled Presidio entities + Guardrails-AI validators and clicks "Enable → choose scope"
// (T3, task #173): the enable is NEVER scope-invisible. They pick
//   • Organization (default) → writes an org guardrail masking rule (POST /api/v1/admin/guardrails/
//     rules), inherited by every pipeline, or
//   • a specific pipeline    → tightens that pipeline's guardrailOverlay (PATCH /api/v1/admin/
//     pipelines/[id]) — the exact mechanism the pipeline Guardrails tab uses.
// The card shows the CURRENT scope as a badge (Org and/or "N pipelines"). All the filter/enable/
// availability logic is PURE in @/lib; this component is thin. Search + kind + category live in the
// URL (?cat_q / ?cat_kind / ?cat_cat) so the browser Back button and deep-links work.

const KIND_LABEL: Record<GuardrailKind, string> = {
  'presidio-entity': 'PII / PHI detection',
  'guardrails-validator': 'Behaviour check',
  'llm-guard-scanner': 'LLM Guard scanner',
};

const AVAIL_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  ready: { label: 'ready', variant: 'default' },
  fallback: { label: 'stored — engine off', variant: 'secondary' },
  floor: { label: 'regex floor', variant: 'outline' },
};

export interface EnabledRuleRef {
  matcher: string;
  pattern: string;
}

export interface PipelineScopeRef {
  id: string;
  name: string;
  guardrailOverlay?: unknown;
}

export function GuardrailCatalog({
  engineStatus,
  enabledRules,
  pipelines,
}: {
  engineStatus: EngineStatus;
  enabledRules: EnabledRuleRef[];
  /** Pipelines the operator can scope an enable to, with their current guardrail overlays. */
  pipelines: PipelineScopeRef[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busyId, setBusyId] = useState<string | null>(null);
  // The item whose scope picker is open (null = closed). URL is unchanged — this is a transient
  // create/edit form, which the nav rule explicitly permits as a modal.
  const [scopeItem, setScopeItem] = useState<GuardrailCatalogItem | null>(null);

  // URL-driven filter state (navigational, not client-only).
  const filter: CatalogFilter = useMemo(
    () => ({
      q: params.get('cat_q') ?? '',
      category: params.get('cat_cat') ?? '',
      kind: (params.get('cat_kind') as GuardrailKind | null) ?? undefined,
    }),
    [params],
  );

  const setParam = useCallback(
    (key: string, value: string) => {
      const p = new URLSearchParams(params.toString());
      if (value) p.set(key, value);
      else p.delete(key);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const filtered = useMemo(() => filterCatalog(GUARDRAIL_CATALOG, filter), [filter]);
  const active = isFilterActive(filter);
  const groups = useMemo(
    () => (active ? [{ category: null as null, items: filtered }] : catalogByCategory()),
    [active, filtered],
  );

  // Enable at ORG scope — the existing org guardrail masking rule (every pipeline inherits).
  async function enableOrg(item: GuardrailCatalogItem) {
    setBusyId(item.id);
    const res = await fetch('/api/v1/admin/guardrails/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildEnablePayload(item)),
    });
    setBusyId(null);
    setScopeItem(null);
    if (res.ok) {
      toast.success(`Enabled org-wide: ${item.name}`);
      router.refresh();
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? `Failed to enable ${item.name}`);
    }
  }

  // Enable on ONE pipeline — tighten its guardrailOverlay (same path as the pipeline Guardrails tab).
  // GET current overlay → compute next → PATCH. The pure enableGuardrailOnPipeline validates first.
  async function enablePipeline(item: GuardrailCatalogItem, pipeline: PipelineScopeRef) {
    setBusyId(item.id);
    try {
      const result = enableGuardrailOnPipeline(pipeline.guardrailOverlay, item.entity);
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      const res = await fetch(`/api/v1/admin/pipelines/${pipeline.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guardrailOverlay: result.overlay }),
      });
      if (res.ok) {
        toast.success(`Enabled on ${pipeline.name}: ${item.name}`);
        setScopeItem(null);
        router.refresh();
      } else {
        const d = await res.json().catch(() => null);
        toast.error(d?.error ?? `Failed to enable on ${pipeline.name}`);
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pick a protection and click <span className="font-medium text-foreground">Enable</span>,
        then choose its <span className="font-medium text-foreground">scope</span> — your whole
        organization or a single pipeline. No regex, no setup. Everything runs on your own network;
        nothing is sent out.
      </p>

      {/* Search + filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          placeholder="Search protections (e.g. email, SSN, toxic, secrets)…"
          value={filter.q}
          onChange={(e) => setParam('cat_q', e.target.value)}
          className="sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={!filter.kind ? 'default' : 'outline'}
            onClick={() => setParam('cat_kind', '')}
          >
            All
          </Button>
          {(['presidio-entity', 'guardrails-validator', 'llm-guard-scanner'] as GuardrailKind[]).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={filter.kind === k ? 'default' : 'outline'}
              onClick={() => setParam('cat_kind', filter.kind === k ? '' : k)}
            >
              {KIND_LABEL[k]}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {GUARDRAIL_CATEGORIES.map((c) => (
            <Button
              key={c}
              size="sm"
              variant={filter.category === c ? 'secondary' : 'ghost'}
              onClick={() => setParam('cat_cat', filter.category === c ? '' : c)}
              title={c}
            >
              {c}
            </Button>
          ))}
        </div>
      </div>

      {/* Cards, grouped by category when idle, flat when filtering */}
      {groups.every((g) => g.items.length === 0) ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No protections match your search.
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.category ?? 'results'} className="space-y-2">
            {g.category ? (
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.category}
              </h3>
            ) : null}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.items.map((item) => {
                const avail = itemAvailability(item, engineStatus);
                const orgEnabled = isItemEnabled(item, enabledRules);
                const scopedPipelines = pipelinesEnforcingGuardrail(item.entity, pipelines);
                const badge = AVAIL_BADGE[avail.status];
                return (
                  <div
                    key={item.id}
                    className="flex flex-col gap-2 rounded-md border border-border p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {item.kind === 'presidio-entity' ? (
                          <ShieldCheck className="size-4 shrink-0 text-primary" />
                        ) : (
                          <Sparkle className="size-4 shrink-0 text-primary" />
                        )}
                        <span className="text-sm font-medium text-foreground">{item.name}</span>
                      </div>
                      {item.defaultEnabled ? (
                        <Badge variant="secondary" className="bg-primary/10 text-primary">
                          recommended
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {item.entity}
                      </Badge>
                      <Badge variant={badge.variant} title={avail.detail}>
                        {badge.label}
                      </Badge>
                    </div>

                    {/* CURRENT SCOPE — never scope-invisible. */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {orgEnabled ? (
                        <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary">
                          <Buildings className="size-3" /> Organization
                        </Badge>
                      ) : null}
                      {scopedPipelines.length ? (
                        <Badge
                          variant="secondary"
                          title={scopedPipelines.map((p) => p.name).join(', ')}
                        >
                          {scopedPipelines.length} pipeline
                          {scopedPipelines.length === 1 ? '' : 's'}
                        </Badge>
                      ) : null}
                      {!orgEnabled && !scopedPipelines.length ? (
                        <span className="text-xs text-muted-foreground/70">Not enabled</span>
                      ) : null}
                    </div>

                    <div className="mt-auto pt-1">
                      {orgEnabled ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
                          <CheckCircle className="size-4" /> Enabled org-wide
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={busyId === item.id}
                          onClick={() => setScopeItem(item)}
                        >
                          {busyId === item.id ? 'Enabling…' : 'Enable → choose scope'}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Scope picker — org-default OR a specific pipeline. */}
      <Dialog open={scopeItem !== null} onOpenChange={(o) => !o && setScopeItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Enable {scopeItem?.name} — choose scope</DialogTitle>
            <DialogDescription>
              Turn this protection on for your whole organization, or scope it to a single pipeline.
            </DialogDescription>
          </DialogHeader>
          {scopeItem ? (
            <div className="space-y-4">
              <button
                type="button"
                disabled={busyId === scopeItem.id}
                onClick={() => void enableOrg(scopeItem)}
                className="flex w-full items-start gap-3 rounded-md border border-border p-3 text-left hover:bg-accent disabled:opacity-60"
              >
                <Buildings className="mt-0.5 size-5 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    Organization (default)
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Every pipeline inherits it. Writes the org guardrail rule.
                  </span>
                </span>
              </button>

              <div>
                <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  Or a specific pipeline
                </p>
                {pipelines.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                    No pipelines yet — create one to scope a protection to it.
                  </p>
                ) : (
                  <ul className="max-h-56 space-y-1 overflow-auto">
                    {pipelines.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          disabled={busyId === scopeItem.id}
                          onClick={() => void enablePipeline(scopeItem, p)}
                          className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60"
                        >
                          <span className="font-medium text-foreground">{p.name}</span>
                          <span className="text-xs text-muted-foreground">scope here</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
