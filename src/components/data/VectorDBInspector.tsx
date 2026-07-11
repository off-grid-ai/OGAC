'use client';

import { Circle, Cube, Database } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toDisplayHost } from '@/lib/display-host';

// The mDNS form shown to the user as the default/placeholder. The server-side vectordb proxy
// still connects over loopback; this value only ever appears in the UI (and, when unchanged,
// is normalized back to the real target server-side — see /api/v1/vectordb).
const QDRANT_DISPLAY_DEFAULT = toDisplayHost('http://127.0.0.1:6333');

interface CollectionInfo {
  name: string;
  vectors: number;
  dim?: number;
  distance?: string;
}
interface ScatterPoint {
  id: string | number;
  x: number;
  y: number;
  payloadPreview: string;
}

const VB = 320; // scatter viewBox size (square)

// Normalize the PCA {x,y} coords into the square SVG viewBox with a small margin.
function normalize(points: ScatterPoint[]): Array<ScatterPoint & { cx: number; cy: number }> {
  if (!points.length) return [];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const m = 16;
  const span = VB - m * 2;
  return points.map((p) => ({
    ...p,
    cx: m + ((p.x - minX) / spanX) * span,
    cy: m + ((p.y - minY) / spanY) * span,
  }));
}

// Vector-DB inspector: connect to a store (Qdrant/LanceDB), list its collections, and render a
// PCA scatter plot of sampled embeddings (inline SVG, no chart libs). Everything routes through
// the server /api/v1/vectordb endpoint so credentials never touch the browser bundle.
// eslint-disable-next-line complexity
export function VectorDBInspector({ urlHint }: { urlHint?: string }) {
  const [kind, setKind] = useState<'qdrant' | 'lancedb'>('qdrant');
  const [url, setUrl] = useState(toDisplayHost(urlHint) || QDRANT_DISPLAY_DEFAULT);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'up' | 'down'>('idle');
  const [collections, setCollections] = useState<CollectionInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [points, setPoints] = useState<ScatterPoint[] | null>(null);
  const [sampling, setSampling] = useState(false);
  const [active, setActive] = useState<ScatterPoint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const post = async (payload: Record<string, unknown>) => {
    const r = await fetch('/api/v1/vectordb', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, url, apiKey: apiKey || undefined, ...payload }),
      cache: 'no-store',
    });
    return r.json() as Promise<Record<string, unknown>>;
  };

  const connect = async () => {
    setStatus('connecting');
    setError(null);
    setCollections(null);
    setPoints(null);
    setSelected(null);
    try {
      const ping = await post({ action: 'ping' });
      if (!ping.ok) {
        setStatus('down');
        if (ping.error) setError(String(ping.error));
        return;
      }
      setStatus('up');
      const cols = await post({ action: 'collections' });
      if (cols.error) setError(String(cols.error));
      setCollections((cols.collections as CollectionInfo[]) ?? []);
    } catch (e) {
      setStatus('down');
      setError(e instanceof Error ? e.message : 'connect failed');
    }
  };

  const sample = async (name: string) => {
    setSelected(name);
    setSampling(true);
    setPoints(null);
    setActive(null);
    setError(null);
    try {
      const res = await post({ action: 'sample', collection: name, n: 128 });
      if (res.error) setError(String(res.error));
      setPoints((res.points as ScatterPoint[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'sample failed');
    } finally {
      setSampling(false);
    }
  };

  const dots = points ? normalize(points) : [];

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="size-4 text-primary" />
          Vector DB inspector
        </CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect a vector store and project sampled embeddings to 2D (PCA) — inline scatter, no
          chart libs.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connect form */}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'qdrant' | 'lancedb')}
              className="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
            >
              <option value="qdrant">qdrant</option>
              <option value="lancedb">lancedb</option>
            </select>
          </label>
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>url</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={QDRANT_DISPLAY_DEFAULT}
              className="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>api key</span>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              placeholder="optional"
              className="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
            />
          </label>
          <button
            onClick={connect}
            disabled={status === 'connecting'}
            className="rounded bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {status === 'connecting' ? 'connecting…' : 'Connect'}
          </button>
          {status !== 'idle' ? (
            <span
              className={`flex items-center gap-1.5 text-xs ${
                status === 'up' ? 'text-primary' : 'text-destructive'
              }`}
            >
              <Circle
                weight="fill"
                className={`size-2 ${status === 'up' ? 'text-primary' : 'text-destructive'}`}
              />
              {status}
            </span>
          ) : null}
        </div>

        {error ? (
          <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-[11px] text-destructive">
            {error}
          </div>
        ) : null}

        {collections ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            {/* Collections list */}
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Collections ({collections.length})
              </div>
              {collections.length ? (
                collections.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => sample(c.name)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left ${
                      selected === c.name
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:bg-muted/40'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 font-mono text-xs text-primary">
                      <Cube className="size-3.5" />
                      {c.name}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="text-foreground">{c.vectors.toLocaleString()}</span> vec
                      {c.dim ? <Badge variant="secondary">{c.dim}d</Badge> : null}
                      {c.distance ? <Badge variant="secondary">{c.distance}</Badge> : null}
                    </span>
                  </button>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No collections found.</p>
              )}
            </div>

            {/* Scatter plot + side panel */}
            <div className="space-y-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {selected ? `Embeddings — ${selected}` : 'Select a collection to sample'}
              </div>
              {sampling ? (
                <p className="text-xs text-muted-foreground">Sampling &amp; projecting…</p>
              ) : selected && points && !points.length ? (
                <p className="text-xs text-muted-foreground">
                  No vectors returned for this collection.
                </p>
              ) : dots.length ? (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
                  <svg
                    viewBox={`0 0 ${VB} ${VB}`}
                    className="w-full rounded border border-border bg-background"
                    role="img"
                    aria-label="embedding scatter plot"
                  >
                    {dots.map((d) => (
                      <circle
                        key={String(d.id)}
                        cx={d.cx}
                        cy={d.cy}
                        r={active?.id === d.id ? 4.5 : 2.5}
                        className={
                          active?.id === d.id ? 'fill-primary' : 'fill-primary/50 hover:fill-primary'
                        }
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setActive(d)}
                        onClick={() => setActive(d)}
                      >
                        <title>{String(d.id)}</title>
                      </circle>
                    ))}
                  </svg>
                  <div className="rounded border border-border bg-background p-2 text-[11px]">
                    {active ? (
                      <>
                        <div className="mb-1 font-mono text-primary">id: {String(active.id)}</div>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
                          {active.payloadPreview || '(no payload)'}
                        </pre>
                      </>
                    ) : (
                      <p className="text-muted-foreground">Hover a dot to inspect its payload.</p>
                    )}
                  </div>
                </div>
              ) : selected ? null : (
                <p className="text-xs text-muted-foreground">
                  Pick a collection on the left to render its embedding cloud.
                </p>
              )}
              {dots.length ? (
                <p className="text-[10px] text-muted-foreground">
                  {dots.length} points · PCA top-2 components
                </p>
              ) : null}
            </div>
          </div>
        ) : status === 'idle' ? (
          <p className="text-xs text-muted-foreground">
            Not connected. Enter a store URL and hit Connect.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
