'use client';

import {
  ArrowCounterClockwise,
  ClockCounterClockwise,
  Cube,
  Globe,
  LinkSimple,
  Trash,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { buildSrcDoc, isLiveKind } from '@/lib/artifacts';

interface ArtifactRow {
  id: string;
  kind: string;
  code: string;
  language: string | null;
  title: string;
  conversationId: string | null;
  published: boolean;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface VersionRow {
  id: string;
  version: number;
  kind: string;
  code: string;
  language: string | null;
  createdAt: string;
}

// eslint-disable-next-line complexity
export function ArtifactsBrowser() {
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ArtifactRow | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);

  const load = useCallback(async () => {
    const r = await fetch('/api/v1/chat/artifacts');
    if (r.ok) setArtifacts((await r.json()).artifacts ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(async (a: ArtifactRow) => {
    setActive(a);
    setVersions([]);
    const r = await fetch(`/api/v1/chat/artifacts/${a.id}`);
    if (r.ok) setVersions((await r.json()).versions ?? []);
  }, []);

  async function remove(id: string) {
    await fetch(`/api/v1/chat/artifacts/${id}`, { method: 'DELETE' });
    if (active?.id === id) setActive(null);
    toast.success('Artifact removed');
    void load();
  }

  async function togglePublish(a: ArtifactRow) {
    const r = await fetch(`/api/v1/chat/artifacts/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ published: !a.published }),
    });
    if (r.ok) {
      const next = { ...a, published: !a.published };
      setActive((cur) => (cur?.id === a.id ? next : cur));
      toast.success(next.published ? 'Published' : 'Unpublished');
      void load();
    }
  }

  function copyLink(id: string) {
    void navigator.clipboard.writeText(`${window.location.origin}/artifacts/${id}/view`);
    toast.success('Link copied');
  }

  async function revert(a: ArtifactRow, version: number) {
    const r = await fetch(`/api/v1/chat/artifacts/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revertTo: version }),
    });
    if (r.ok) {
      toast.success(`Reverted to v${version}`);
      setActive(null);
      void load();
    }
  }

  const live = active && isLiveKind(active.kind);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Artifacts</h1>
        <p className="text-xs text-muted-foreground">
          Renderable outputs saved from your chats — reopen, preview, version, and publish.
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
              <CardContent className="p-4" onClick={() => void openDetail(a)}>
                <div className="mb-1.5 flex items-center gap-2">
                  <Cube className="size-4 text-primary" />
                  <span className="truncate text-sm font-medium">{a.title}</span>
                  {a.published ? <Globe className="size-3.5 shrink-0 text-primary" /> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  <span>{a.kind}</span>
                  {a.language ? <span>· {a.language}</span> : null}
                  {a.currentVersion > 1 ? <span>· v{a.currentVersion}</span> : null}
                  <span>· {new Date(a.updatedAt).toLocaleDateString()}</span>
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
              <span className="truncate font-mono text-xs uppercase tracking-wide text-muted-foreground">
                {active.title} · {active.kind}
                {active.language ? ` · ${active.language}` : ''} · v{active.currentVersion}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={active.published ? 'default' : 'outline'}
                  className="h-7 gap-1.5"
                  onClick={() => void togglePublish(active)}
                >
                  <Globe className="size-3.5" /> {active.published ? 'Published' : 'Publish'}
                </Button>
                {active.published ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5"
                    onClick={() => copyLink(active.id)}
                  >
                    <LinkSimple className="size-3.5" /> Copy link
                  </Button>
                ) : null}
                <button
                  onClick={() => setActive(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1">
              <div className="flex-1 overflow-auto">
                {live ? (
                  <iframe
                    title="artifact"
                    sandbox="allow-scripts"
                    className="h-full w-full border-0 bg-white"
                    srcDoc={buildSrcDoc(active)}
                  />
                ) : (
                  <pre className="m-4 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
                    {active.code}
                  </pre>
                )}
              </div>
              {versions.length > 1 ? (
                <div className="w-56 shrink-0 overflow-auto border-l border-border p-3">
                  <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    <ClockCounterClockwise className="size-3.5" /> History
                  </div>
                  <ul className="space-y-1">
                    {versions.map((v) => (
                      <li
                        key={v.id}
                        className="flex items-center justify-between rounded border border-border px-2 py-1 text-[11px]"
                      >
                        <span>
                          v{v.version}
                          {v.version === active.currentVersion ? ' · current' : ''}
                        </span>
                        {v.version !== active.currentVersion ? (
                          <button
                            className="text-muted-foreground hover:text-primary"
                            title={`Revert to v${v.version}`}
                            onClick={() => void revert(active, v.version)}
                          >
                            <ArrowCounterClockwise className="size-3.5" />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
