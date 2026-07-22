'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RANGE_WINDOWS, type RangeWindow } from '@/lib/victoriametrics-query';

const API = '/api/v1/admin/operations/metrics/saved-queries';

interface SavedQuery {
  id: string;
  name: string;
  query: string;
  range: string;
  description: string;
}

interface FormState {
  id: string | null; // null = create, else edit
  name: string;
  query: string;
  range: RangeWindow;
  description: string;
}

const EMPTY: FormState = { id: null, name: '', query: '', range: '1h', description: '' };

// Saved metric queries — the console-owned CRUD entity. Create/edit/delete named PromQL queries;
// clicking one loads it into the explorer (URL-driven ?q / ?range so it deep-links).
export function MetricsSavedQueries({
  currentQuery,
  currentRange,
}: Readonly<{ currentQuery: string; currentRange: RangeWindow }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<SavedQuery[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(API, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { data?: SavedQuery[] }) => setItems(Array.isArray(d.data) ? d.data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () =>
    setForm({ ...EMPTY, query: currentQuery, range: currentRange, name: '' });
  const openEdit = (q: SavedQuery) =>
    setForm({
      id: q.id,
      name: q.name,
      query: q.query,
      range: (q.range as RangeWindow) || '1h',
      description: q.description,
    });

  const loadIntoExplorer = (q: SavedQuery) => {
    const next = new URLSearchParams();
    next.set('q', q.query);
    next.set('range', q.range || '1h');
    router.push(`${pathname}?${next.toString()}`);
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    const body = JSON.stringify({
      name: form.name,
      query: form.query,
      range: form.range,
      description: form.description,
    });
    const res = await fetch(form.id ? `${API}/${form.id}` : API, {
      method: form.id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? `Request failed (${res.status})`);
      return;
    }
    setForm(null);
    load();
  };

  const remove = async (q: SavedQuery) => {
    if (!confirm(`Delete saved query "${q.name}"?`)) return;
    const res = await fetch(`${API}/${q.id}`, { method: 'DELETE' });
    if (res.ok) load();
  };

  return (
    <Card className="lg:col-span-1">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Saved queries</CardTitle>
        <Button size="sm" variant="outline" onClick={openCreate}>
          + Save current
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {form ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <Input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="text-sm"
            />
            <Textarea
              placeholder="PromQL"
              value={form.query}
              onChange={(e) => setForm({ ...form, query: e.target.value })}
              rows={2}
              className="font-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <select
                value={form.range}
                onChange={(e) => setForm({ ...form, range: e.target.value as RangeWindow })}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
              >
                {RANGE_WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Description (optional)"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="flex-1 text-xs"
              />
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : form.id ? 'Update' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setForm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {items.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            No saved queries yet. Run a query and click “Save current”.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((q) => (
              <li key={q.id} className="rounded-md border border-border p-2">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => loadIntoExplorer(q)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-medium text-foreground">
                      {q.name}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {q.query}
                    </span>
                    {q.description ? (
                      <span className="block truncate text-[11px] text-muted-foreground/70">
                        {q.description}
                      </span>
                    ) : null}
                  </button>
                  <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {q.range}
                  </span>
                </div>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(q)}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(q)}
                    className="text-[11px] text-destructive hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
