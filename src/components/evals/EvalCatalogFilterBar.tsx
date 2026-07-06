'use client';

import { MagnifyingGlass, X } from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CatalogFacets, CatalogSortKey } from '@/lib/eval-catalog-filter';

// Thin, presentational filter bar for the evaluator-template catalog. All state is owned by the
// parent (URL-driven); this only renders controls and reports changes. Facets come from the pure
// catalogFacets() so category/engine chips reflect the REAL catalog, never a stale list.

const SORT_LABEL: Record<CatalogSortKey, string> = {
  name: 'Name',
  category: 'Category',
  engine: 'Engine',
  threshold: 'Threshold',
};

interface Props {
  q: string;
  category: string;
  engine: string;
  sortKey: CatalogSortKey;
  facets: CatalogFacets;
  // Full label (tooltip). Short chip label falls back to the category id.
  categoryLabel: Record<string, string>;
  categoryShort: Record<string, string>;
  active: boolean;
  resultCount: number;
  total: number;
  onQ: (v: string) => void;
  onCategory: (v: string) => void;
  onEngine: (v: string) => void;
  onSort: (v: string) => void;
  onClear: () => void;
}

export function EvalCatalogFilterBar({
  q,
  category,
  engine,
  sortKey,
  facets,
  categoryLabel,
  categoryShort,
  active,
  resultCount,
  total,
  onQ,
  onCategory,
  onEngine,
  onSort,
  onClear,
}: Props) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      {/* Search + sort + count, one band on wide screens. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Search templates by name or description…"
            aria-label="Search evaluator templates"
            className="h-9 pl-8"
          />
          {q && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQ('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Engine
            <select
              value={engine}
              onChange={(e) => onEngine(e.target.value)}
              aria-label="Filter by engine"
              className="h-9 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            >
              <option value="">All</option>
              {facets.engines.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.value} ({f.count})
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Sort
            <select
              value={sortKey}
              onChange={(e) => onSort(e.target.value)}
              aria-label="Sort templates"
              className="h-9 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            >
              {(Object.keys(SORT_LABEL) as CatalogSortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Category chips, derived from the catalog. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onCategory('')}
          className={chipClass(category === '')}
        >
          All categories
        </button>
        {facets.categories.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => onCategory(category === f.value ? '' : f.value)}
            className={chipClass(category === f.value)}
            title={categoryLabel[f.value] ?? f.value}
          >
            {categoryShort[f.value] ?? f.value} ({f.count})
          </button>
        ))}
      </div>

      {/* Result count + clear, only when a filter is active. */}
      {active && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-[11px]">
            {resultCount} of {total}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={onClear}
          >
            <X className="mr-1 size-3" />
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}

function chipClass(selected: boolean): string {
  return [
    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
    selected
      ? 'border-primary bg-primary/10 text-primary'
      : 'border-border bg-background text-muted-foreground hover:text-foreground',
  ].join(' ');
}
