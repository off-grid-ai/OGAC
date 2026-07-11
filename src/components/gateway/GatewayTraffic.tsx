'use client';

import { Pulse } from '@phosphor-icons/react/dist/ssr';
import { Fragment, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { modelLabel } from '@/lib/model-catalog';

export type Health = 'up' | 'degraded' | 'down' | 'unknown';
interface Stat {
  gateway: string;
  model: string;
  requests: number;
  errors: number;
  avgMs: number;
  tokens: number;
  health?: Health;
  inflight?: number;
  queued?: number;
  peakInflight?: number;
}

// TRUE inference health: up = generating fine, degraded = jammed/slow/erroring (KV-cache
// exhaustion still answers /health), down = unreachable. Green / amber / red.
export const HEALTH_META: Record<Health, { label: string; dot: string; text: string }> = {
  up: { label: 'up', dot: 'bg-primary', text: 'text-primary' },
  degraded: { label: 'degraded', dot: 'bg-amber-500', text: 'text-amber-600' },
  down: { label: 'down', dot: 'bg-destructive', text: 'text-destructive' },
  unknown: { label: 'unknown', dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
};
export interface Call {
  ts: number;
  gateway: string;
  model: string;
  modelServed?: string;
  kind: string;
  status: number;
  ms: number;
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  tps?: number;
  ttfb?: number;
  writeBlocked?: number;
  finish?: string;
  bytes?: number;
  caller?: string;
  corrId?: string;
  input?: string;
  output?: string;
  reasoning?: string;
  toolCalls?: { name: string; args: string }[];
  params?: { temperature?: number; maxTokens?: number; topP?: number; thinking?: boolean; toolsOffered?: number };
  msgs?: { role: string; text: string }[];
  /** Present when the gateway is in raw header mode (OFFGRID_RAW_HEADERS=true). */
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}
interface Traffic {
  available: boolean;
  since?: string;
  stats?: Stat[];
  recent?: Call[];
}

const time = (ts: number) => new Date(ts).toLocaleTimeString();

function Chip({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {label} <span className="font-mono text-foreground">{value}</span>
    </span>
  );
}

// The expanded detail for one gateway call: metadata + tool calls + prompt/completion + reasoning.
// eslint-disable-next-line complexity
export function CallDetail({ c }: Readonly<{ c: Call }>) {
  const p = c.params ?? {};
  return (
    <div className="space-y-2 py-1">
      <div className="flex flex-wrap gap-1.5">
        <Chip label="served" value={modelLabel(c.modelServed ?? c.model)} />
        <Chip label="tokens" value={`${c.promptTokens ?? '?'} → ${c.completionTokens ?? '?'}`} />
        {c.tps ? <Chip label="tok/s" value={c.tps} /> : null}
        {c.finish ? <Chip label="finish" value={c.finish} /> : null}
        {p.temperature != null ? <Chip label="temp" value={p.temperature} /> : null}
        {p.maxTokens != null ? <Chip label="max" value={p.maxTokens} /> : null}
        <Chip label="thinking" value={p.thinking ? 'on' : 'off'} />
        {p.toolsOffered ? <Chip label="tools offered" value={p.toolsOffered} /> : null}
        {c.caller ? <Chip label="caller" value={c.caller} /> : null}
        {c.corrId ? <Chip label="run" value={c.corrId.slice(0, 12)} /> : null}
      </div>
      {c.toolCalls?.length ? (
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Tool calls
          </div>
          {c.toolCalls.map((t, k) => (
            <div key={k} className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px]">
              <span className="text-primary">{t.name}</span>({t.args})
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Prompt in {c.msgs?.length ? `(${c.msgs.length} turns)` : ''}
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 font-mono text-[11px]">
            {c.input || '(none captured)'}
          </pre>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Completion out
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 font-mono text-[11px]">
            {c.output || '(none captured)'}
          </pre>
        </div>
      </div>
      {c.reasoning ? (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">Reasoning</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 font-mono">
            {c.reasoning}
          </pre>
        </details>
      ) : null}
      {(c.requestHeaders || c.responseHeaders) ? (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            <span>Raw headers</span>
            <span className="ml-1.5 rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">raw mode</span>
          </summary>
          <div className="mt-1 grid gap-2 md:grid-cols-2">
            {c.requestHeaders ? (
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide">Request</div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 font-mono text-[11px]">
                  {Object.entries(c.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}
                </pre>
              </div>
            ) : null}
            {c.responseHeaders ? (
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide">Response</div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 font-mono text-[11px]">
                  {Object.entries(c.responseHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}
                </pre>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

// Live gateway traffic — polls the aggregator feed (via /api/v1/gateway/traffic) every 3s and
// shows per-gateway counters plus the most recent calls: which node served each request, its
// latency, tokens, and status. Hidden entirely when the gateway has no traffic feed.
export function GatewayTraffic() {
  const [data, setData] = useState<Traffic | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/v1/gateway/traffic', { cache: 'no-store' });
        const d = (await r.json()) as Traffic;
        if (alive) setData(d);
      } catch {
        /* keep last snapshot */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!data?.available) return null;
  const stats = data.stats ?? [];
  const recent = data.recent ?? [];

  return (
    <>
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm">Traffic by gateway</CardTitle>
          <span className="flex items-center gap-1.5 text-xs text-primary">
            <Pulse className="size-3.5 animate-pulse" />
            live
          </span>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {stats.map((s) => {
            const h = HEALTH_META[s.health ?? 'unknown'];
            return (
            <div key={s.gateway} className="rounded-md border border-border px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
                  <span className={`inline-block size-2 rounded-full ${h.dot}`} />
                  {s.gateway}
                </span>
                <span className={`font-mono text-[10px] font-medium uppercase ${h.text}`}>{h.label}</span>
              </div>
              <div className="mt-0.5 text-right text-[11px] text-muted-foreground">{modelLabel(s.model)}</div>
              <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <dt>requests</dt>
                  <dd className="text-foreground">{s.requests}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>errors</dt>
                  <dd className={s.errors ? 'text-destructive' : 'text-foreground'}>{s.errors}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>avg latency</dt>
                  <dd className="text-foreground">{s.avgMs} ms</dd>
                </div>
                <div className="flex justify-between">
                  <dt>tokens</dt>
                  <dd className="text-foreground">{s.tokens}</dd>
                </div>
                {s.inflight !== undefined ? (
                  <>
                    <div className="mt-1 flex justify-between border-t border-border pt-1">
                      <dt>in-flight</dt>
                      <dd className={s.inflight ? 'text-primary' : 'text-foreground'}>{s.inflight}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>queued</dt>
                      <dd className={s.queued ? 'text-amber-600' : 'text-foreground'}>{s.queued ?? 0}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>peak</dt>
                      <dd className="text-foreground">{s.peakInflight ?? 0}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Recent calls</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Gateway</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.length ? (
                recent.map((c, i) => {
                  const key = `${c.ts}-${c.gateway}-${i}`;
                  const open = openKey === key;
                  return (
                    <Fragment key={key}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setOpenKey(open ? null : key)}
                        title="Click to see prompt + completion"
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {open ? '▾ ' : '▸ '}
                          {time(c.ts)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="bg-primary/10 font-mono text-primary">
                            {c.gateway}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{modelLabel(c.model)}</TableCell>
                        <TableCell className="text-xs">{c.kind}</TableCell>
                        <TableCell
                          className={`font-mono text-xs ${
                            !c.status || c.status >= 400 ? 'text-destructive' : 'text-foreground'
                          }`}
                        >
                          {c.status}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{c.ms} ms</TableCell>
                        <TableCell className="text-right font-mono text-xs">{c.tokens || '—'}</TableCell>
                      </TableRow>
                      {open ? (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/40">
                            <CallDetail c={c} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                    No traffic yet — calls made through the gateway will appear here.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
