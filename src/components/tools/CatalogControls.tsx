'use client';

import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ─── CatalogControls (#121) — search + category filter for the MCP catalog (18 servers) ───────────
// Both the query and the category live in the URL (?q= / ?cat=) so a filtered view is deep-linkable
// and Back-coherent, and the server page filters from those params (SSR). This component only writes
// the params; it holds no filtering logic of its own (that's the pure filterCatalog in tools-view).
export function CatalogControls({ categories }: { categories: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const cat = params.get('cat');

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const sp = new URLSearchParams(params.toString());
      if (value && value.length) sp.set(key, value);
      else sp.delete(key);
      // Keep us on the catalog tab.
      sp.set('tab', 'catalog');
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full max-w-sm">
        <MagnifyingGlass className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setParam('q', e.target.value)}
          placeholder="Search servers…"
          className="pl-8"
          aria-label="Search the tool catalog"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setParam('cat', null)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs transition-colors',
            !cat
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setParam('cat', c === cat ? null : c)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs transition-colors',
              c === cat
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
