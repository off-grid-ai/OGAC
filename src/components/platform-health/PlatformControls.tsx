'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

// URL-driven controls for the Platform-health page. Every navigational value — the active tab, the
// LogsQL query, the selected trace service — lives in searchParams (a router.push per change), never
// local useState, so the view is deep-linkable and Back-coherent per the navigation mandate.

const TABS: { id: string; label: string }[] = [
  { id: 'metrics', label: 'Metrics' },
  { id: 'logs', label: 'Logs' },
  { id: 'traces', label: 'Traces' },
];

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

export function TabSwitcher({ active }: Readonly<{ active: string }>) {
  const setParam = useSetParam();
  return (
    <div className="flex gap-1 border-b border-border">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-current={active === t.id ? 'page' : undefined}
          onClick={() => setParam((p) => p.set('tab', t.id))}
          className={
            active === t.id
              ? '-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium text-primary'
              : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
          }
        >
          {t.label}
        </button>
      ))}
    </div>
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
      <input
        name="logsq"
        type="search"
        defaultValue={query === '*' ? '' : query}
        placeholder='LogsQL — e.g. _stream:{service="gateway"} error'
        className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
      />
      <button
        type="submit"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Search
      </button>
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
