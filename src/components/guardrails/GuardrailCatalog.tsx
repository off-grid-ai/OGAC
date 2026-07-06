'use client';

import { CheckCircle, ShieldCheck, Sparkle } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

// Browse & one-click-enable the STANDARD guardrails (Builder Epic #124). A non-technical operator
// searches/filters the bundled Presidio entities + Guardrails-AI validators and clicks "Enable" —
// which writes a masking rule through the EXISTING guardrails rules path (POST
// /api/v1/admin/guardrails/rules). No regex, no config. All the filter/enable/availability logic is
// PURE in @/lib/guardrails-catalog; this component is thin. Search + kind + category live in the
// URL (?cat_q / ?cat_kind / ?cat_cat) so the browser Back button and deep-links work.

const KIND_LABEL: Record<GuardrailKind, string> = {
  'presidio-entity': 'PII / PHI detection',
  'guardrails-validator': 'Behaviour check',
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

export function GuardrailCatalog({
  engineStatus,
  enabledRules,
}: {
  engineStatus: EngineStatus;
  enabledRules: EnabledRuleRef[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function enable(item: GuardrailCatalogItem) {
    setBusyId(item.id);
    const res = await fetch('/api/v1/admin/guardrails/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildEnablePayload(item)),
    });
    setBusyId(null);
    if (res.ok) {
      toast.success(`Enabled: ${item.name}`);
      router.refresh();
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? `Failed to enable ${item.name}`);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pick a protection and click <span className="font-medium text-foreground">Enable</span> —
        no regex, no setup. Each one turns on detection for a common kind of sensitive data or a
        safety check. Everything runs on your own network; nothing is sent out.
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
          {(['presidio-entity', 'guardrails-validator'] as GuardrailKind[]).map((k) => (
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
                const enabled = isItemEnabled(item, enabledRules);
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
                    <div className="mt-auto pt-1">
                      {enabled ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
                          <CheckCircle className="size-4" /> Enabled
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={busyId === item.id}
                          onClick={() => void enable(item)}
                        >
                          {busyId === item.id ? 'Enabling…' : 'Enable'}
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
    </div>
  );
}
