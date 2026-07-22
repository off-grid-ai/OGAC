'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { FieldValuesResult, SearchResult } from '@/lib/adapters/victorialogs';
import type { FieldValue, HistogramSeries, LogRow } from '@/lib/victorialogs-query';
import { TIME_RANGES } from '@/lib/victorialogs-query';
import { LogsHistogram } from './LogsHistogram';
import { LogsRetentionPanel } from './LogsRetentionPanel';

const EMPTY_SERIES: HistogramSeries = { buckets: [], total: 0, max: 0 };

// Colour a level chip so errors jump out in an incident.
function levelVariant(level: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const l = level.toLowerCase();
  if (l.includes('error') || l.includes('fatal') || l.includes('crit')) return 'destructive';
  if (l.includes('warn')) return 'default';
  return 'secondary';
}

function fmtTime(t: string): string {
  if (!t) return '—';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : d.toLocaleString(undefined, { hour12: false });
}

// Centralized fleet log search over VictoriaLogs. URL-driven: `?q=` (free text), `?range=`, and the
// `?service=` / `?level=` filter dropdowns are the single source of truth (deep-linkable +
// Back-coherent). The composer edits a draft; submitting pushes it to the URL, which triggers the
// fetch. Row expansion is ephemeral UI (not a navigational place), so it stays local.
export function LogsExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const q = params.get('q') ?? '';
  const range = params.get('range') ?? '1h';
  const service = params.get('service') ?? '';
  const level = params.get('level') ?? '';

  const [draft, setDraft] = useState(q);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [series, setSeries] = useState<HistogramSeries>(EMPTY_SERIES);
  const [services, setServices] = useState<FieldValue[]>([]);
  const [levels, setLevels] = useState<FieldValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => { setDraft(q); }, [q]);

  // Push a partial change into the URL (keeps existing params); resets nothing else so filters +
  // range + query compose.
  const pushParams = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const qs = useCallback(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (range) p.set('range', range);
    if (service) p.set('service', service);
    if (level) p.set('level', level);
    return p.toString();
  }, [q, range, service, level]);

  // Run the search + histogram whenever the URL-driven query changes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setExpanded(null);
    const query = qs();
    Promise.all([
      fetch(`/api/v1/admin/operations/logs/query?${query}`, { cache: 'no-store' }).then((r) => r.json() as Promise<SearchResult>),
      fetch(`/api/v1/admin/operations/logs/hits?${query}`, { cache: 'no-store' }).then((r) => r.json() as Promise<{ series: HistogramSeries }>),
    ])
      .then(([search, hits]) => {
        if (!alive) return;
        setResult(search);
        setSeries(hits.series ?? EMPTY_SERIES);
      })
      .catch(() => { if (alive) setResult({ configured: true, rows: [], query: '', error: 'request failed' }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [qs]);

  // Load filter dropdown options for the active range.
  useEffect(() => {
    let alive = true;
    const load = (field: 'service' | 'level', set: (v: FieldValue[]) => void) =>
      fetch(`/api/v1/admin/operations/logs/field-values?field=${field}&range=${encodeURIComponent(range)}`, { cache: 'no-store' })
        .then((r) => r.json() as Promise<FieldValuesResult>)
        .then((j) => { if (alive) set(j.values ?? []); })
        .catch(() => { if (alive) set([]); });
    void load('service', setServices);
    void load('level', setLevels);
    return () => { alive = false; };
  }, [range]);

  const submit = () => pushParams({ q: draft.trim() });

  const configured = result?.configured !== false;

  return (
    <div className="w-full space-y-4">
      {/* Composer */}
      <div className="space-y-3 rounded-md border border-border bg-card p-4">
        <div className="flex flex-col gap-2 lg:flex-row">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder='LogsQL — e.g.  error   or   _msg:"connection refused"   (blank = everything)'
            className="h-10 flex-1 font-mono text-sm"
            spellCheck={false}
          />
          <Button onClick={submit} disabled={loading} className="h-10 lg:w-28">
            {loading ? 'Searching…' : 'Search'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1">
            {TIME_RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => pushParams({ range: r.key })}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${r.key === range ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}
              >
                {r.key}
              </button>
            ))}
          </div>

          <FilterSelect label="service" value={service} options={services} onChange={(v) => pushParams({ service: v })} />
          <FilterSelect label="level" value={level} options={levels} onChange={(v) => pushParams({ level: v })} />

          {(service || level || q) ? (
            <button
              onClick={() => { setDraft(''); router.replace(`${pathname}?range=${range}`, { scroll: false }); }}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              clear filters
            </button>
          ) : null}

          {result?.query ? (
            <code className="ml-auto truncate rounded bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground" title={result.query}>
              {result.query}
            </code>
          ) : null}
        </div>
      </div>

      {!configured ? (
        <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          VictoriaLogs isn&apos;t configured on this deployment (no <code>OFFGRID_VICTORIALOGS_URL</code>). Centralized
          log search activates once a log backend endpoint is set.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-4">
          <div className="space-y-4 lg:col-span-3">
            <LogsHistogram series={series} loading={loading} />

            {result?.error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                VictoriaLogs error: {result.error}
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48">Time</TableHead>
                    <TableHead className="w-24">Level</TableHead>
                    <TableHead className="w-40">Stream</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(result?.rows ?? []).map((row, i) => (
                    <LogTableRow key={`${row.time}-${i}`} row={row} open={expanded === i} onToggle={() => setExpanded(expanded === i ? null : i)} />
                  ))}
                  {(result && result.rows.length === 0 && !result.error) ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        {loading ? 'Searching…' : 'No log entries match this query in the selected range.'}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="space-y-4">
            <LogsRetentionPanel />
            <div className="rounded-md border border-border bg-card p-4 text-xs text-muted-foreground">
              <h3 className="mb-2 text-sm font-medium text-foreground">LogsQL tips</h3>
              <ul className="space-y-1">
                <li><code>error</code> — free-text match</li>
                <li><code>level:error</code> — field match</li>
                <li><code>_msg:&quot;timed out&quot;</code> — phrase</li>
                <li><code>service:gateway error</code> — AND</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: Readonly<{ label: string; value: string; options: FieldValue[]; onChange: (v: string) => void }>) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground"
      >
        <option value="">all</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value}{o.hits ? ` (${o.hits.toLocaleString()})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function LogTableRow({ row, open, onToggle }: Readonly<{ row: LogRow; open: boolean; onToggle: () => void }>) {
  const level = row.fields.level ?? row.fields.severity ?? '';
  const svc = row.fields.service ?? row.stream ?? '';
  const fieldEntries = Object.entries(row.fields);
  return (
    <>
      <TableRow className="cursor-pointer align-top" onClick={onToggle}>
        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{fmtTime(row.time)}</TableCell>
        <TableCell>{level ? <Badge variant={levelVariant(level)}>{level}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
        <TableCell className="truncate font-mono text-xs">{svc || '—'}</TableCell>
        <TableCell className="font-mono text-xs">{row.message || <span className="text-muted-foreground">(no message)</span>}</TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={4} className="bg-muted/30">
            <div className="space-y-2 p-2">
              {row.stream ? (
                <div className="text-xs"><span className="text-muted-foreground">_stream</span> <span className="font-mono">{row.stream}</span></div>
              ) : null}
              {fieldEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground">No additional fields.</p>
              ) : (
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  {fieldEntries.map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-xs">
                      <span className="shrink-0 text-muted-foreground">{k}</span>
                      <span className="break-all font-mono">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
