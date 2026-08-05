'use client';

import { useCallback, useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';

// ─── ObjectScopePicker — choose the bucket and folder a data rule reads, from what is really there ──
//
// This field used to be free text. A bucket typed from memory saves cleanly and then fails at RUN
// time, on someone else's screen, as "no records" — the failure-presenting-as-emptiness class this
// codebase keeps having to hunt down. Listing what the source can actually see moves that failure to
// the moment someone can still fix it.
//
// It shows names only, never content: the data rule being configured IS the approval that does not
// exist yet, so previewing an object here would read data nobody has been approved for.

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

interface Bucket { name: string }

export function ObjectScopePicker({
  connectorId,
  value,
  onChange,
}: Readonly<{
  connectorId: string;
  /** The stored `bucket/prefix` resource string. */
  value: string;
  onChange: (resource: string) => void;
}>) {
  const [buckets, setBuckets] = useState<Bucket[] | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const [bucket, ...rest] = value.split('/').filter(Boolean);
  const prefix = rest.length ? `${rest.join('/')}/` : '';

  useEffect(() => {
    if (!connectorId) return;
    let live = true;
    setProblem(null);
    setBuckets(null);
    void (async () => {
      try {
        const res = await fetch(`/api/v1/admin/data-sources/${encodeURIComponent(connectorId)}/discover`, { cache: 'no-store' });
        const j = (await res.json()) as { buckets?: Bucket[]; error?: string };
        if (!live) return;
        // An unreachable source must NOT render as "this source has no buckets" — those two lead an
        // operator to opposite conclusions and only one of them is a typo.
        if (!res.ok) { setProblem(j.error ?? `could not list this source (${res.status})`); setBuckets([]); return; }
        setBuckets(j.buckets ?? []);
      } catch (e) {
        if (live) { setProblem((e as Error).message); setBuckets([]); }
      }
    })();
    return () => { live = false; };
  }, [connectorId]);

  const loadFolders = useCallback(async (b: string) => {
    setFolders([]);
    if (!b) return;
    try {
      const res = await fetch(
        `/api/v1/admin/data-sources/${encodeURIComponent(connectorId)}/discover?bucket=${encodeURIComponent(b)}`,
        { cache: 'no-store' },
      );
      const j = (await res.json()) as { prefixes?: string[] };
      if (res.ok) setFolders(j.prefixes ?? []);
    } catch { /* the bucket is still selectable without its folder list */ }
  }, [connectorId]);

  useEffect(() => { void loadFolders(bucket ?? ''); }, [bucket, loadFolders]);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="dom-bucket">Bucket</Label>
        <select
          id="dom-bucket"
          value={bucket ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={SELECT}
        >
          <option value="">{buckets === null ? 'Looking…' : 'Select a bucket…'}</option>
          {(buckets ?? []).map((b) => (
            <option key={b.name} value={b.name}>{b.name}</option>
          ))}
        </select>
        {problem ? (
          <p className="text-[11px] text-destructive">
            {problem} This is not the same as the source being empty.
          </p>
        ) : buckets?.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">This source has no buckets yet.</p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dom-prefix">Folder</Label>
        <select
          id="dom-prefix"
          value={prefix}
          disabled={!bucket}
          onChange={(e) => onChange(e.target.value ? `${bucket}/${e.target.value}` : (bucket ?? ''))}
          className={SELECT}
        >
          <option value="">Whole bucket</option>
          {folders.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          The rule reads only inside what you pick here. Everything else in the bucket stays out of reach.
        </p>
      </div>
    </div>
  );
}
