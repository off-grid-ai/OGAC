'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// URL-driven controls for the Platform-health leaves. LogsQL and the selected trace service live in
// searchParams, so the view is deep-linkable and Back-coherent.

function useSetParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mut(next);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );
}

// LogsQL search box — commits the query to ?logsq on Enter / submit. defaultValue (not value) keeps
// this an uncontrolled input driven by the URL, so typing doesn't round-trip every keystroke.
export function LogsSearchBox({ query }: Readonly<{ query: string }>) {
  const setParam = useSetParam();
  const submit = (raw: string) =>
    setParam((p) => {
      const q = raw.trim();
      if (q) p.set('logsq', q);
      else p.delete('logsq');
    });
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem('logsq') as HTMLInputElement | null;
        submit(input?.value ?? '');
      }}
    >
      <Input
        name="logsq"
        type="search"
        defaultValue={query === '*' ? '' : query}
        placeholder='LogsQL — e.g. _stream:{service="gateway"} error'
        className="flex-1 font-mono text-sm"
      />
      <Button type="submit">Search</Button>
    </form>
  );
}

// Trace service selector — sets ?svc on change.
export function ServiceSelect({
  services,
  selected,
}: Readonly<{
  services: string[];
  selected: string | null;
}>) {
  const setParam = useSetParam();
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>Service</span>
      <select
        value={selected ?? ''}
        onChange={(e) => setParam((p) => p.set('svc', e.target.value))}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      >
        {services.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}
