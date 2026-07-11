'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import type { AuditOutcome } from '@/lib/audit-log-view';

// URL-driven filter bar for the audit log. Per the navigation mandate, EVERY filter is a query-param
// on the route — no local useState for filter values. Changing a filter does a router.push (a new
// history entry) so the view is linkable, shareable, and Back-coherent. Reset to page 1 on any
// filter change so paging never strands the operator on an out-of-range page.
interface Props {
  actors: string[];
  actions: string[];
  projects: string[];
  outcomes: AuditOutcome[];
}

const OUTCOME_OPTIONS: AuditOutcome[] = ['ok', 'blocked', 'redacted', 'denied', 'error', 'unknown'];

export function AuditFilterBar({ actors, actions, projects, outcomes }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('page'); // any filter change resets pagination
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const val = (k: string) => params.get(k) ?? '';
  const outcomeChoices = outcomes.length ? outcomes : OUTCOME_OPTIONS;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {/* Free-text search */}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>Search</span>
        <input
          type="search"
          defaultValue={val('q')}
          placeholder="model, action, resource…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') setParam('q', (e.target as HTMLInputElement).value.trim());
          }}
          onBlur={(e) => setParam('q', e.target.value.trim())}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
      </label>

      <SelectFilter
        label="Actor"
        value={val('actor')}
        options={actors}
        onChange={(v) => setParam('actor', v)}
      />
      <SelectFilter
        label="Action"
        value={val('action')}
        options={actions}
        onChange={(v) => setParam('action', v)}
      />
      <SelectFilter
        label="Project"
        value={val('project')}
        options={projects}
        onChange={(v) => setParam('project', v)}
      />
      <SelectFilter
        label="Outcome"
        value={val('outcome')}
        options={outcomeChoices}
        onChange={(v) => setParam('outcome', v)}
      />

      {/* Time range */}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>From</span>
        <input
          type="datetime-local"
          defaultValue={toLocalInput(val('from'))}
          onChange={(e) => setParam('from', fromLocalInput(e.target.value))}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>To</span>
        <input
          type="datetime-local"
          defaultValue={toLocalInput(val('to'))}
          onChange={(e) => setParam('to', fromLocalInput(e.target.value))}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
      </label>

      <div className="flex items-end">
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Clear filters
        </button>
      </div>
    </div>
  );
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  // Keep the current value selectable even if it isn't in the (page-derived) facet list.
  const opts = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      >
        <option value="">all</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

// datetime-local input works in local wall-clock; the URL/filter contract is ISO. Convert both ways.
function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
