'use client';

import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

// URL-driven search box for the orchestration plugin catalog. Per the nav rule the filter position
// lives in the URL (`?q=`) — deep-linkable + Back-coherent — not local-only state. Debounced so
// typing pushes one replace per pause, not per keystroke.
export function KestraCatalogSearch({
  initial = '',
  placeholder = 'Search plugins, actions, categories…',
}: Readonly<{ initial?: string; placeholder?: string }>) {
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
    <div className="relative w-full sm:max-w-sm">
      <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label="Search orchestration plugin catalog"
        className="pl-8 font-mono"
      />
    </div>
  );
}
