'use client';

import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/Pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { modelLabel } from '@/lib/model-catalog';
import { usePagination } from '@/lib/use-pagination';

interface Hit {
  id: string;
  deviceId: string;
  model: string;
  outcome: string;
  tokens: number;
  leftDevice: boolean;
  keyId?: string | null;
  ts: string;
  score: number | null;
}

interface Result {
  total: number;
  hits: Hit[];
  configured: boolean;
  error?: string;
}

const OUTCOME_VARIANT: Record<string, string> = {
  ok: 'text-muted-foreground',
  redacted: 'bg-primary/10 text-primary',
  blocked: 'bg-destructive/10 text-destructive',
};

// SIEM read-back UI: full-text + filtered search over the shipped audit index in OpenSearch. Unlike
// the 25-row Postgres audit slice below, this queries the whole stream.
// eslint-disable-next-line complexity
export function AuditSearch({ configured }: Readonly<{ configured: boolean }>) {
  const [q, setQ] = useState('');
  const [outcome, setOutcome] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  // The SIEM search can return a large hit set — page it client-side over the returned array with
  // the shared URL-driven control (?auditHitsPage). Page resets to 1 on every new search.
  const hits = result?.hits ?? [];
  const { pageItems, setPage, ...pageState } = usePagination(hits, {
    key: 'auditHits',
    defaultPageSize: 25,
  });

  async function search() {
    setLoading(true);
    setPage(1);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (outcome) params.set('outcome', outcome);
    try {
      const res = await fetch(`/api/v1/admin/audit-search?${params.toString()}`);
      setResult((await res.json()) as Result);
    } catch (e) {
      setResult({ total: 0, hits: [], configured: true, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  if (!configured) {
    return (
      <p className="text-xs text-muted-foreground">
        OpenSearch isn&apos;t connected yet — connect it in Settings to enable full-text SIEM search
        over the shipped audit stream.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search model / device / key…"
          className="max-w-xs"
        />
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">any outcome</option>
          <option value="ok">ok</option>
          <option value="redacted">redacted</option>
          <option value="blocked">blocked</option>
        </select>
        <Button type="submit" size="sm" disabled={loading}>
          <MagnifyingGlass className="mr-1.5 size-4" />
          {loading ? 'Searching…' : 'Search'}
        </Button>
        {result ? (
          <span className="text-xs text-muted-foreground">{result.total} match(es)</span>
        ) : null}
      </form>

      {result?.error ? (
        <p className="text-xs text-destructive">OpenSearch error: {result.error}</p>
      ) : null}

      {result && result.hits.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Device</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Key</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {h.ts?.slice(0, 19).replace('T', ' ')}
                </TableCell>
                <TableCell className="text-muted-foreground">{h.deviceId}</TableCell>
                <TableCell className="font-medium text-foreground">{modelLabel(h.model)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{h.tokens}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className={OUTCOME_VARIANT[h.outcome] ?? ''}>
                    {h.outcome}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {h.keyId ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {result && result.hits.length > 0 ? (
        <Pagination
          state={pageState}
          onPageChange={setPage}
          onPageSizeChange={pageState.setPageSize}
          itemLabel="events"
        />
      ) : null}

      {result?.hits.length === 0 && !result.error ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No matches.</p>
      ) : null}
    </div>
  );
}
