'use client';

// ─── PipelineFacetSelect — the ONE pipeline facet control, shared across every Insights roll-up ─────
//
// The Insights surfaces (observability/analytics/siem/audit/accounting/finops/reports) all filter to a
// single pipeline's slice via a `?pipeline=<id>` URL param (events/traces/cost are already tagged
// `pipeline:<id>`). This control is that facet: URL-driven per the nav rule (the selection lives in the
// query string, so the view is deep-linkable + Back-coherent), rendered as a labelled <select> that
// matches the audit filter bar. "All pipelines" clears the facet.

import { GitBranch } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

export interface PipelineFacetOption {
  id: string;
  name: string;
}

export function PipelineFacetSelect({
  pipelines,
  /** The param name (default `pipeline`). Distinct pages could scope it, but keep `pipeline` for deep-link consistency. */
  param = 'pipeline',
  /** Extra params to DROP when the facet changes (e.g. reset `page`/`cursor` pagination). */
  resetParams = ['page', 'cursor'],
  className,
}: Readonly<{
  pipelines: PipelineFacetOption[];
  param?: string;
  resetParams?: string[];
  className?: string;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(param) ?? '';

  const set = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set(param, id);
      else next.delete(param);
      for (const r of resetParams) next.delete(r);
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, router, param, resetParams],
  );

  // Keep a stale/unknown current value visible so the control never silently drops the active filter.
  const known = pipelines.some((p) => p.id === current);

  return (
    <label
      className={`flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ''}`}
    >
      <GitBranch className="size-3.5 text-primary" />
      <span className="whitespace-nowrap">Pipeline</span>
      <select
        value={current}
        onChange={(e) => set(e.target.value)}
        className="max-w-[16rem] rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      >
        <option value="">All pipelines</option>
        {!known && current ? <option value={current}>{current}</option> : null}
        {pipelines.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
