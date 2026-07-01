'use client';

import { Cube, Trash, X } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';

interface ArtifactRow {
  id: string;
  kind: string;
  code: string;
  language: string | null;
  title: string;
  conversationId: string | null;
  createdAt: string;
}

function srcDocFor(a: ArtifactRow): string {
  if (a.kind === 'svg') {
    return `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0a0a0a">${a.code}`;
  }
  return a.code;
}

// eslint-disable-next-line complexity
export function ArtifactsBrowser() {
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ArtifactRow | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/v1/chat/artifacts');
    if (r.ok) setArtifacts((await r.json()).artifacts ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    await fetch(`/api/v1/chat/artifacts/${id}`, { method: 'DELETE' });
    if (active?.id === id) setActive(null);
    toast.success('Artifact removed');
    void load();
  }

  const live = active && (active.kind === 'html' || active.kind === 'svg');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Artifacts</h1>
        <p className="text-xs text-muted-foreground">
          Renderable outputs saved from your chats — reopen, preview, and clean up.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : artifacts.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Cube className="size-8 text-muted-foreground" />
            <p className="text-sm">No artifacts yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              When a chat produces an HTML page, SVG, React component, diagram, or code block, open
              it and it lands here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {artifacts.map((a) => (
            <Card
              key={a.id}
              className="group relative cursor-pointer shadow-sm transition-colors hover:border-primary/50"
            >
              <CardContent className="p-4" onClick={() => setActive(a)}>
                <div className="mb-1.5 flex items-center gap-2">
                  <Cube className="size-4 text-primary" />
                  <span className="truncate text-sm font-medium">{a.title}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  <span>{a.kind}</span>
                  {a.language ? <span>· {a.language}</span> : null}
                  <span>· {new Date(a.createdAt).toLocaleDateString()}</span>
                </div>
                <pre className="mt-2 line-clamp-3 overflow-hidden whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
                  {a.code.slice(0, 200)}
                </pre>
              </CardContent>
              <button
                onClick={() => remove(a.id)}
                aria-label="Delete artifact"
                className="absolute right-3 top-3 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <Trash className="size-3.5" />
              </button>
            </Card>
          ))}
        </div>
      )}

      {active ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={() => setActive(null)}
        >
          <div
            className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                {active.title} · {active.kind}
                {active.language ? ` · ${active.language}` : ''}
              </span>
              <button
                onClick={() => setActive(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {live ? (
                <iframe
                  title="artifact"
                  sandbox="allow-scripts"
                  className="h-full w-full border-0 bg-white"
                  srcDoc={srcDocFor(active)}
                />
              ) : (
                <pre className="m-4 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
                  {active.code}
                </pre>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
