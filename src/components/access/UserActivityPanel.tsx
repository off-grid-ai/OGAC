'use client';

import {
  ArrowClockwise,
  ChatCircle,
  Cube,
  Gavel,
  Lightning,
  MagnifyingGlass,
  Robot,
  ShieldWarning,
} from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { LoadingBlock } from '@/components/ui/spinner';

// ── Shapes (mirror the API response — the pure lib's ActivityPage) ────────────────────────────────
type ActivityKind = 'chat' | 'agent-run' | 'app-run' | 'query' | 'governance' | 'action';
type ActivityVerdict = 'allowed' | 'blocked' | 'redacted' | 'denied' | 'error' | 'unknown';

interface UserActivity {
  id: string;
  ts: string;
  kind: ActivityKind;
  action: string;
  summary: string;
  content: string;
  resource: string;
  project: string;
  model: string;
  verdict: ActivityVerdict;
  tokens: number;
  costUsd: number;
  runId: string;
  source: string;
}

interface Rollup {
  total: number;
  byKind: Record<ActivityKind, number>;
  blocked: number;
  redacted: number;
  tokens: number;
  costUsd: number;
  firstTs: string | null;
  lastTs: string | null;
  models: string[];
}

interface ActivityResponse {
  configured?: boolean;
  items?: UserActivity[];
  total?: number;
  page?: number;
  size?: number;
  rollup?: Rollup;
  error?: string;
}

// ── Presentation helpers ──────────────────────────────────────────────────────────────────────────
const KIND_META: Record<ActivityKind, { label: string; Icon: typeof ChatCircle }> = {
  chat: { label: 'Chat', Icon: ChatCircle },
  'agent-run': { label: 'Agent run', Icon: Robot },
  'app-run': { label: 'App run', Icon: Cube },
  query: { label: 'Query', Icon: MagnifyingGlass },
  governance: { label: 'Governance', Icon: Gavel },
  action: { label: 'Action', Icon: Lightning },
};

const KIND_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All activity' },
  { value: 'chat', label: 'Chats' },
  { value: 'agent-run', label: 'Agent runs' },
  { value: 'app-run', label: 'App runs' },
  { value: 'query', label: 'Queries' },
  { value: 'governance', label: 'Governance' },
  { value: 'action', label: 'Actions' },
];

const VERDICT_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'Any outcome' },
  { value: 'allowed', label: 'Allowed' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'redacted', label: 'Redacted' },
  { value: 'denied', label: 'Denied' },
  { value: 'error', label: 'Error' },
];

function verdictBadge(v: ActivityVerdict): { variant: 'default' | 'secondary' | 'destructive'; label: string } {
  switch (v) {
    case 'allowed':
      return { variant: 'default', label: 'Allowed' };
    case 'redacted':
      return { variant: 'secondary', label: 'Redacted' };
    case 'blocked':
      return { variant: 'destructive', label: 'Blocked' };
    case 'denied':
      return { variant: 'destructive', label: 'Denied' };
    case 'error':
      return { variant: 'destructive', label: 'Error' };
    default:
      return { variant: 'secondary', label: 'Pending' };
  }
}

function fmt(ts: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

// ── The panel ──────────────────────────────────────────────────────────────────────────────────────
export function UserActivityPanel({ userId }: Readonly<{ userId: string }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const kind = params.get('kind') ?? 'all';
  const verdict = params.get('verdict') ?? 'all';
  const q = params.get('q') ?? '';
  const openId = params.get('item') ?? '';

  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);

  // Drive filters through the URL so the view is deep-linkable + Back-coherent (nav rule).
  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '' || v === 'all') next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (kind !== 'all') qs.set('kind', kind);
      if (verdict !== 'all') qs.set('verdict', verdict);
      if (q) qs.set('q', q);
      qs.set('size', '100');
      const res = await fetch(`/api/v1/admin/users/${userId}/activity?${qs.toString()}`);
      const body = (await res.json()) as ActivityResponse;
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setData(body);
    } catch {
      setError('Failed to load activity.');
    } finally {
      setLoading(false);
    }
  }, [userId, kind, verdict, q]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSearch(q);
  }, [q]);

  const items = data?.items ?? [];
  const rollup = data?.rollup;
  const openItem = useMemo(() => items.find((i) => i.id === openId) ?? null, [items, openId]);

  const stats = rollup
    ? [
        { label: 'Total activity', value: String(rollup.total) },
        { label: 'Chats', value: String(rollup.byKind.chat) },
        { label: 'Agent + app runs', value: String(rollup.byKind['agent-run'] + rollup.byKind['app-run']) },
        { label: 'Queries', value: String(rollup.byKind.query) },
        { label: 'Blocked / denied', value: String(rollup.blocked) },
        { label: 'PII redacted', value: String(rollup.redacted) },
      ]
    : [];

  return (
    <div className="w-full space-y-4">
      {/* Rollup band — full-width multi-column */}
      {rollup && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((s) => (
            <Card key={s.label} className="shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-semibold tabular-nums text-foreground">
                {s.value}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters — all URL-driven */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setParam({ kind: f.value, item: null })}
              className={`rounded border px-2 py-1 text-xs font-mono transition-colors ${
                kind === f.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/60'
              }`}
            >
              {f.label}
              {rollup && f.value !== 'all' && f.value in rollup.byKind
                ? ` (${rollup.byKind[f.value as ActivityKind]})`
                : ''}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {VERDICT_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setParam({ verdict: f.value, item: null })}
              className={`rounded border px-2 py-1 text-xs transition-colors ${
                verdict === f.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/60'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <form
          className="ml-auto flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ q: search.trim() || null, item: null });
          }}
        >
          <div className="relative">
            <MagnifyingGlass className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompts, queries…"
              className="w-56 pl-7 font-mono text-xs"
            />
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Search
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void load()}
            title="Refresh"
          >
            <ArrowClockwise className="size-3.5" />
          </Button>
        </form>
      </div>

      {/* The stream */}
      {loading ? (
        <LoadingBlock label="Loading activity…" />
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          <span className="font-medium">Could not load activity:</span> {error}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
          No activity recorded for this user{q || kind !== 'all' || verdict !== 'all' ? ' matching these filters' : ''}.
          <div className="mt-1 text-xs">
            Prompts, chats, queries, and app or agent runs appear here as soon as this person uses the
            platform.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {items.map((it) => {
            const meta = KIND_META[it.kind];
            const vb = verdictBadge(it.verdict);
            const Icon = meta.Icon;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => setParam({ item: it.id })}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{it.summary}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {meta.label}
                    </Badge>
                    <Badge variant={vb.variant} className="text-[10px]">
                      {it.verdict === 'blocked' || it.verdict === 'denied' ? (
                        <ShieldWarning className="mr-0.5 size-3" />
                      ) : null}
                      {vb.label}
                    </Badge>
                    {it.model && (
                      <span className="font-mono text-[10px] text-muted-foreground">{it.model}</span>
                    )}
                  </div>
                  {it.content && (
                    <p className="mt-1 line-clamp-2 font-mono text-xs text-muted-foreground">
                      {it.content}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{fmt(it.ts)}</span>
                    {it.resource && <span className="font-mono">{it.resource}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* List → detail: the single activity item opens as a deep-linkable side panel (?item=…) */}
      <Sheet
        open={!!openItem}
        onOpenChange={(o) => {
          if (!o) setParam({ item: null });
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {openItem && (
            <>
              <SheetHeader>
                <SheetTitle>{openItem.summary}</SheetTitle>
                <SheetDescription>
                  {KIND_META[openItem.kind].label} · {fmt(openItem.ts)}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={verdictBadge(openItem.verdict).variant} className="text-xs">
                    {verdictBadge(openItem.verdict).label}
                  </Badge>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {openItem.action}
                  </Badge>
                </div>

                <div>
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Content
                  </p>
                  {openItem.content ? (
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">
                      {openItem.content}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No content captured for this event. (Governance and access actions record the
                      action and outcome, not a prompt.)
                    </p>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-3 text-xs">
                  {openItem.resource && (
                    <div>
                      <dt className="text-muted-foreground">Resource</dt>
                      <dd className="font-mono text-foreground break-all">{openItem.resource}</dd>
                    </div>
                  )}
                  {openItem.project && (
                    <div>
                      <dt className="text-muted-foreground">Project</dt>
                      <dd className="font-mono text-foreground">{openItem.project}</dd>
                    </div>
                  )}
                  {openItem.model && (
                    <div>
                      <dt className="text-muted-foreground">Model</dt>
                      <dd className="font-mono text-foreground">{openItem.model}</dd>
                    </div>
                  )}
                  {openItem.tokens > 0 && (
                    <div>
                      <dt className="text-muted-foreground">Tokens</dt>
                      <dd className="font-mono text-foreground tabular-nums">{openItem.tokens}</dd>
                    </div>
                  )}
                  {openItem.costUsd > 0 && (
                    <div>
                      <dt className="text-muted-foreground">Cost</dt>
                      <dd className="font-mono text-foreground tabular-nums">
                        ${openItem.costUsd.toFixed(4)}
                      </dd>
                    </div>
                  )}
                  {openItem.runId && (
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Run id</dt>
                      <dd className="font-mono text-foreground break-all">{openItem.runId}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
