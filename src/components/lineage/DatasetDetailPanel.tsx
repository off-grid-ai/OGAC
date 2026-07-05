'use client';

import { Database, Tag as TagIcon } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { DatasetDetailView } from '@/lib/lineage-view';

interface Props {
  namespace: string | null;
}

interface Envelope {
  configured: boolean;
  data: DatasetDetailView | null;
  error: string | null;
}

// Dataset detail panel — a navigational place driven by `?dataset=<name>` so Back closes it and
// the URL is deep-linkable. Fetches the dataset's schema fields, tags, and OpenLineage facets from
// Marquez (GET /api/v1/admin/lineage/dataset) and lets the operator tag/untag it in place. Best-
// effort: a Marquez read error is shown as a note, never thrown.
export function DatasetDetailPanel({ namespace }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const dataset = params.get('dataset');

  const [state, setState] = useState<Envelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete('dataset');
    router.push(next.toString() ? `?${next.toString()}` : '?', { scroll: false });
  }, [params, router]);

  const load = useCallback(async () => {
    if (!dataset || !namespace) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/admin/lineage/dataset?namespace=${encodeURIComponent(
          namespace,
        )}&dataset=${encodeURIComponent(dataset)}`,
      );
      if (res.status === 403) {
        setState({ configured: true, data: null, error: 'Admins only.' });
        return;
      }
      setState((await res.json()) as Envelope);
    } catch (e) {
      setState({ configured: true, data: null, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [dataset, namespace]);

  useEffect(() => {
    if (dataset) void load();
    else setState(null);
  }, [dataset, load]);

  async function applyTag(action: 'tag-dataset' | 'untag-dataset') {
    if (!namespace || !dataset || !tag.trim()) return void toast.error('Enter a tag.');
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/lineage/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, namespace, dataset, tag: tag.trim() }),
      });
      if (res.status === 403) return void toast.error('Admins only.');
      if (!res.ok) return void toast.error('Failed.');
      toast.success(action === 'tag-dataset' ? 'Dataset tagged.' : 'Tag removed.');
      setTag('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  const data = state?.data ?? null;

  return (
    <Sheet open={Boolean(dataset)} onOpenChange={(o) => !o && close()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-1.5 font-mono text-sm">
            <Database className="size-4 text-primary" />
            {dataset}
          </SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-5">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading from Marquez…</p>
          ) : state?.error ? (
            <p className="text-xs text-destructive">Marquez: {state.error}</p>
          ) : !data ? (
            <p className="text-xs text-muted-foreground">
              No detail for this dataset — it may not exist in Marquez yet, or Marquez is
              unreachable.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Meta label="Namespace" value={data.namespace ?? namespace ?? '—'} />
                <Meta label="Type" value={data.type ?? '—'} />
                <Meta
                  label="Rows"
                  value={data.rowCount !== null ? data.rowCount.toLocaleString() : '—'}
                />
                <Meta
                  label="Bytes"
                  value={data.bytes !== null ? data.bytes.toLocaleString() : '—'}
                />
                <Meta label="Updated" value={data.updatedAt ?? '—'} />
              </div>

              {data.description ? (
                <p className="text-xs text-muted-foreground">{data.description}</p>
              ) : null}

              <Section title={`Schema (${data.fields.length} field(s))`}>
                {data.fields.length ? (
                  <div className="space-y-1">
                    {data.fields.map((f) => (
                      <div
                        key={f.name}
                        className="flex items-baseline gap-2 rounded-md border border-border px-2 py-1"
                      >
                        <span className="font-mono text-xs text-foreground">{f.name}</span>
                        {f.type ? (
                          <Badge variant="outline" className="text-[10px]">
                            {f.type}
                          </Badge>
                        ) : null}
                        {f.description ? (
                          <span className="truncate text-[11px] text-muted-foreground">
                            {f.description}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No schema facet on this dataset yet.
                  </p>
                )}
              </Section>

              <Section title="OpenLineage facets">
                {data.facetNames.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {data.facetNames.map((n) => (
                      <Badge key={n} variant="secondary" className="text-[10px]">
                        {n}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No facets recorded.</p>
                )}
              </Section>

              <Section title={`Tags (${data.tags.length})`}>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {data.tags.length ? (
                    data.tags.map((t) => (
                      <Badge key={t} className="gap-1 text-[10px]">
                        <TagIcon className="size-3" />
                        {t}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">No tags.</span>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Tag name
                  </Label>
                  <Input
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    placeholder="pii"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="mt-2 flex gap-2">
                  <Button
                    onClick={() => applyTag('tag-dataset')}
                    disabled={busy}
                    className="flex-1 gap-1.5"
                  >
                    <TagIcon className="size-4" />
                    Apply tag
                  </Button>
                  <Button
                    onClick={() => applyTag('untag-dataset')}
                    disabled={busy}
                    variant="outline"
                    className="flex-1"
                  >
                    Remove tag
                  </Button>
                </div>
              </Section>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <p className="truncate font-mono text-xs text-foreground">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t border-border pt-3">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</Label>
      {children}
    </div>
  );
}
