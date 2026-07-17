'use client';

import {
  ArrowCounterClockwise,
  ClockCounterClockwise,
  Cube,
  Globe,
  LinkSimple,
  MagnifyingGlass,
  Trash,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/Pagination';
import { buildSrcDoc, isLiveKind } from '@/lib/artifacts';
import { panelHref, withPanelParams } from '@/lib/url-panel';
import { usePagination } from '@/lib/use-pagination';
import { accentHue, relativeTime } from '@/lib/workspace-grid';

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

// Artifacts as a Workspace grid — the library of renderable outputs saved from chats. Cards carry a
// live thumbnail (for HTML/SVG/React) or a code snippet, kind/version meta, and open into a
// URL-driven side panel (?artifact=<id>) — a navigational "place", not a modal, so Back closes it
// and it deep-links. This surface is reached through the Work sidebar branch, so it has
// no sidebar row.
// eslint-disable-next-line complexity
export function ArtifactsBrowser() {
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [q, setQ] = useState('');

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeId = searchParams.get('artifact');
  const active = useMemo(
    () => artifacts.find((a) => a.id === activeId) ?? null,
    [artifacts, activeId],
  );

  const load = useCallback(async () => {
    const r = await fetch('/api/v1/chat/artifacts');
    if (r.ok) setArtifacts((await r.json()).artifacts ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Load version history whenever the URL-selected artifact changes (deep-linkable).
  useEffect(() => {
    if (!activeId) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const r = await fetch(`/api/v1/chat/artifacts/${activeId}`);
      if (!cancelled && r.ok) setVersions((await r.json()).versions ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const open = useCallback(
    (id: string) => {
      const query = withPanelParams(searchParams.toString(), { artifact: id });
      router.push(panelHref(pathname, query));
    },
    [router, pathname, searchParams],
  );
  const close = useCallback(() => {
    const query = withPanelParams(searchParams.toString(), { artifact: null });
    router.push(panelHref(pathname, query));
  }, [router, pathname, searchParams]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return artifacts;
    return artifacts.filter(
      (a) => a.title.toLowerCase().includes(needle) || a.kind.toLowerCase().includes(needle),
    );
  }, [artifacts, q]);

  // The library grows unbounded; paginate the (search-filtered) set client-side. URL-namespaced by
  // `arts` so it deep-links alongside the ?artifact side-panel param.
  const paged = usePagination(filtered, { key: 'arts', defaultPageSize: 12 });

  async function remove(id: string) {
    await fetch(`/api/v1/chat/artifacts/${id}`, { method: 'DELETE' });
    if (activeId === id) close();
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
      toast.success(!a.published ? 'Published' : 'Unpublished');
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
      close();
      void load();
    }
  }

  const live = active && isLiveKind(active.kind);

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-mono text-lg font-semibold">Artifacts</h1>
            <p className="text-xs text-muted-foreground">
              Renderable outputs saved from your chats — reopen, preview, version, and publish.
            </p>
          </div>
          {artifacts.length ? (
            <div className="relative">
              <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search artifacts"
                className="w-44 rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none transition-colors focus:border-primary/50"
              />
            </div>
          ) : null}
        </div>

        {loading ? (
          <GridSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
            <Cube className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">{q ? 'No artifacts match' : 'No artifacts yet'}</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              When a chat produces an HTML page, SVG, React component, diagram, or code block, open
              it and it lands here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {paged.pageItems.map((a) => (
                <ArtifactCard
                  key={a.id}
                  a={a}
                  onOpen={() => open(a.id)}
                  onDelete={() => remove(a.id)}
                />
              ))}
            </div>
            <Pagination
              state={paged}
              onPageChange={paged.setPage}
              onPageSizeChange={paged.setPageSize}
              pageSizeOptions={[12, 24, 48, 96]}
              itemLabel="artifacts"
            />
          </div>
        )}
      </div>

      {active ? (
        <aside className="sticky top-0 hidden h-[calc(100vh-7rem)] w-[28rem] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm xl:flex">
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
            <span className="truncate font-mono text-xs uppercase tracking-wide text-muted-foreground">
              {active.title} · {active.kind}
              {active.language ? ` · ${active.language}` : ''} · v{active.currentVersion}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                size="xs"
                variant={active.published ? 'default' : 'outline'}
                className="gap-1"
                onClick={() => void togglePublish(active)}
              >
                <Globe className="size-3" /> {active.published ? 'Published' : 'Publish'}
              </Button>
              {active.published ? (
                <Button
                  size="xs"
                  variant="outline"
                  className="gap-1"
                  onClick={() => copyLink(active.id)}
                >
                  <LinkSimple className="size-3" /> Link
                </Button>
              ) : null}
              <button
                onClick={close}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {live ? (
              <iframe
                title="artifact"
                sandbox="allow-scripts"
                className="h-full w-full border-0 bg-white"
                srcDoc={buildSrcDoc(active)}
              />
            ) : (
              <pre className="m-3 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
                {active.code}
              </pre>
            )}
          </div>
          {versions.length > 1 ? (
            <div className="max-h-40 shrink-0 overflow-auto border-t border-border p-3">
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
        </aside>
      ) : null}
    </div>
  );
}

function ArtifactCard({
  a,
  onOpen,
  onDelete,
}: Readonly<{
  a: ArtifactRow;
  onOpen: () => void;
  onDelete: () => void;
}>) {
  const hue = accentHue(a.id || a.title);
  const live = isLiveKind(a.kind);
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
      <button onClick={onOpen} className="flex flex-1 flex-col text-left">
        {/* Thumbnail: a scaled-down live render for HTML/SVG/React, else a code snippet. */}
        <div className="relative h-32 shrink-0 overflow-hidden border-b border-border bg-white">
          {live ? (
            <iframe
              title={a.title}
              sandbox="allow-scripts"
              scrolling="no"
              tabIndex={-1}
              className="pointer-events-none h-[256px] w-[200%] origin-top-left scale-[0.5] border-0"
              srcDoc={buildSrcDoc(a)}
            />
          ) : (
            <pre className="h-full overflow-hidden whitespace-pre-wrap break-all bg-background p-3 text-[10px] leading-tight text-muted-foreground">
              {a.code.slice(0, 400)}
            </pre>
          )}
          {a.published ? (
            <span className="absolute right-2 top-2 rounded bg-primary px-1.5 py-0.5 text-[9px] font-medium uppercase text-primary-foreground">
              live
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 p-3">
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded"
            style={{ background: `hsl(${hue} 60% 45% / 0.15)`, color: `hsl(${hue} 60% 45%)` }}
          >
            <Cube className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{a.title}</div>
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>{a.kind}</span>
              {a.currentVersion > 1 ? <span>· v{a.currentVersion}</span> : null}
              {a.updatedAt ? <span>· {relativeTime(a.updatedAt)}</span> : null}
            </div>
          </div>
        </div>
      </button>
      <button
        onClick={onDelete}
        aria-label="Delete artifact"
        className="absolute right-2 top-2 rounded bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        <Trash className="size-3.5" />
      </button>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-52 animate-pulse rounded-lg border border-border bg-card" />
      ))}
    </div>
  );
}
