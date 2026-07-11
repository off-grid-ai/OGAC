'use client';

import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

// URL-driven search box for the warehouse catalog. Per the nav rule, the filter position lives in
// the URL (`?q=`) — deep-linkable + Back-coherent — not local-only state. Debounced so typing pushes
// one history entry per pause, not per keystroke (replace, so Back doesn't step per character).
export function WarehouseSearch({ initial = '' }: Readonly<{ initial?: string }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set('q', value.trim());
      else next.delete('q');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative w-full sm:max-w-xs">
      <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search tables or databases…"
        aria-label="Search warehouse tables"
        className="pl-8"
      />
    </div>
  );
}
