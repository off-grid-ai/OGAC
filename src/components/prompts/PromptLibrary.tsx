'use client';

import {
  ArrowRight,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  TextAlignLeft,
  Trash,
  TrendUp,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/Pagination';
import { Textarea } from '@/components/ui/textarea';
import { LoadingBlock, Spinner } from '@/components/ui/spinner';
import { PromptStarterLibrary } from '@/components/prompts/PromptStarterLibrary';
import { usePagination } from '@/lib/use-pagination';
import { accentHue, preview, relativeTime } from '@/lib/workspace-grid';
import { panelHref, withPanelParams } from '@/lib/url-panel';
import { cn } from '@/lib/utils';

interface Prompt {
  id: string;
  title: string;
  content: string;
  tags: string[];
  variables: string[];
  owner: string;
  visibility: string;
  uses: number;
  updatedAt: string;
}

interface CommonPrompt {
  prompt: string;
  count: number;
  lastSeen: string;
}

type Draft = { id?: string; title: string; content: string; tags: string; visibility: string };

const EMPTY_DRAFT: Draft = { title: '', content: '', tags: '', visibility: 'private' };

export function PromptLibrary() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [common, setCommon] = useState<CommonPrompt[] | null>(null);
  const [commonAvailable, setCommonAvailable] = useState(true);

  // The edit/create panel is a navigational "place" — its open state lives in the URL (?panel=new
  // or ?panel=<id>) so Back closes it and it's deep-linkable. No modal.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const panel = searchParams.get('panel');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (tag) params.set('tag', tag);
    const r = await fetch(`/api/v1/prompts?${params.toString()}`);
    if (r.ok) setPrompts((await r.json()).prompts ?? []);
    setLoading(false);
  }, [q, tag]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/v1/prompts/common');
      if (r.ok) {
        const d = await r.json();
        setCommonAvailable(d.available !== false);
        setCommon(d.common ?? []);
      }
    })();
  }, []);

  // Hydrate the draft from the URL panel param (new = blank; an id = that prompt's fields). Runs
  // when the panel param changes or prompts load, so a deep-link to ?panel=<id> opens populated.
  useEffect(() => {
    if (!panel) {
      setDraft(null);
      return;
    }
    if (panel === 'new') {
      setDraft((d) => d ?? { ...EMPTY_DRAFT });
      return;
    }
    const p = prompts.find((x) => x.id === panel);
    if (p) {
      setDraft({
        id: p.id,
        title: p.title,
        content: p.content,
        tags: p.tags.join(', '),
        visibility: p.visibility,
      });
    }
  }, [panel, prompts]);

  const openPanel = useCallback(
    (id: string) => {
      const query = withPanelParams(searchParams.toString(), { panel: id });
      router.push(panelHref(pathname, query));
    },
    [router, pathname, searchParams],
  );
  const closePanel = useCallback(() => {
    const query = withPanelParams(searchParams.toString(), { panel: null });
    router.push(panelHref(pathname, query));
  }, [router, pathname, searchParams]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const p of prompts) for (const t of p.tags) s.add(t);
    return [...s].sort();
  }, [prompts]);

  // The library grid grows unbounded; paginate the (search/tag-filtered) fetched set client-side.
  // URL-namespaced by `prompts` so it deep-links alongside the ?panel edit param.
  const paged = usePagination(prompts, { key: 'prompts', defaultPageSize: 12 });

  async function usePrompt(p: Prompt) {
    await navigator.clipboard.writeText(p.content);
    toast.success('Copied — paste it into any chat');
    await fetch(`/api/v1/prompts/${p.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ use: true }),
    });
    setPrompts((ps) => ps.map((x) => (x.id === p.id ? { ...x, uses: x.uses + 1 } : x)));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    const tags = draft.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const payload = {
      title: draft.title,
      content: draft.content,
      tags,
      visibility: draft.visibility,
    };
    const r = draft.id
      ? await fetch(`/api/v1/prompts/${draft.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/v1/prompts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (r.ok) {
      toast.success(draft.id ? 'Prompt updated' : 'Prompt saved');
      closePanel();
      void load();
    } else {
      toast.error('Could not save prompt');
    }
  }

  async function remove(p: Prompt) {
    if (!confirm(`Delete prompt “${p.title}”?`)) return;
    const r = await fetch(`/api/v1/prompts/${p.id}`, { method: 'DELETE' });
    if (r.ok) {
      toast.success('Prompt deleted');
      void load();
    } else {
      toast.error('Could not delete');
    }
  }

  function saveCommon(c: CommonPrompt) {
    setDraft({
      title: c.prompt.slice(0, 60),
      content: c.prompt,
      tags: 'common',
      visibility: 'private',
    });
    const query = withPanelParams(searchParams.toString(), { panel: 'new' });
    router.push(panelHref(pathname, query));
  }

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-mono text-lg font-semibold">Prompts</h1>
            <p className="text-xs text-muted-foreground">
              Your reusable prompt library. Use{' '}
              <code className="text-primary">{'{{variable}}'}</code> placeholders for templating —
              copy one straight into chat.
            </p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => openPanel('new')}>
            <Plus className="size-4" /> New prompt
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search prompts…"
              className="pl-8 font-mono"
            />
          </div>
          {allTags.map((t) => (
            <Badge
              key={t}
              variant={tag === t ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setTag(tag === t ? null : t)}
            >
              {t}
            </Badge>
          ))}
          {tag ? (
            <button
              onClick={() => setTag(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              clear
            </button>
          ) : null}
        </div>

        {loading ? (
          <GridSkeleton />
        ) : prompts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
            <TextAlignLeft className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No prompts yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Save a prompt to reuse it, or pull one from Common prompts below.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {paged.pageItems.map((p) => (
                <PromptCard
                  key={p.id}
                  p={p}
                  onUse={() => usePrompt(p)}
                  onEdit={() => openPanel(p.id)}
                  onDelete={() => remove(p)}
                />
              ))}
            </div>
            <Pagination
              state={paged}
              onPageChange={paged.setPage}
              onPageSizeChange={paged.setPageSize}
              pageSizeOptions={[12, 24, 48, 96]}
              itemLabel="prompts"
            />
          </div>
        )}

        <PromptStarterLibrary onAdded={load} />

        <CommonPromptsPanel common={common} available={commonAvailable} onSave={saveCommon} />
      </div>

      {draft ? (
        <PromptEditPanel
          draft={draft}
          saving={saving}
          onChange={setDraft}
          onSave={save}
          onCancel={closePanel}
        />
      ) : null}
    </div>
  );
}

function PromptCard({
  p,
  onUse,
  onEdit,
  onDelete,
}: {
  p: Prompt;
  onUse: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hue = accentHue(p.id || p.title);
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded"
          style={{ background: `hsl(${hue} 60% 45% / 0.15)`, color: `hsl(${hue} 60% 45%)` }}
        >
          <TextAlignLeft className="size-3.5" />
        </span>
        <span className="truncate font-mono text-sm font-medium">{p.title}</span>
        {p.visibility === 'org' ? (
          <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
            org
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="line-clamp-4 min-h-[4rem] whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
          {preview(p.content, 240)}
        </p>
        {p.tags.length || p.variables.length ? (
          <div className="flex flex-wrap gap-1">
            {p.tags.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px]">
                {t}
              </Badge>
            ))}
            {p.variables.map((v) => (
              <Badge key={v} variant="outline" className="text-[10px] text-primary">
                {`{{${v}}}`}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="mt-auto flex items-center gap-2 border-t border-border pt-2.5">
          <Button size="xs" className="gap-1" onClick={onUse}>
            Use <ArrowRight className="size-3" />
          </Button>
          <button
            onClick={onEdit}
            aria-label="Edit prompt"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PencilSimple className="size-3.5" />
          </button>
          <button
            onClick={onDelete}
            aria-label="Delete prompt"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          >
            <Trash className="size-3.5" />
          </button>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {p.uses} uses{p.updatedAt ? ` · ${relativeTime(p.updatedAt)}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

function PromptEditPanel({
  draft,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  saving: boolean;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <aside className="sticky top-0 hidden h-[calc(100vh-7rem)] w-96 shrink-0 flex-col overflow-y-auto rounded-lg border border-border bg-card shadow-sm lg:flex">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-mono text-sm font-semibold">{draft.id ? 'Edit prompt' : 'New prompt'}</h2>
        <button onClick={onCancel} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <label className="space-y-1 text-xs text-muted-foreground">
          Title
          <Input
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            placeholder="e.g. Weekly status summary"
            className="font-mono"
          />
        </label>
        <label className="flex flex-1 flex-col space-y-1 text-xs text-muted-foreground">
          Prompt text
          <Textarea
            value={draft.content}
            onChange={(e) => onChange({ ...draft, content: e.target.value })}
            placeholder="Prompt text — use {{variable}} for placeholders."
            rows={12}
            className="flex-1 font-mono text-xs"
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Tags
          <Input
            value={draft.tags}
            onChange={(e) => onChange({ ...draft, tags: e.target.value })}
            placeholder="tags, comma, separated"
            className="font-mono"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={draft.visibility === 'org'}
            onChange={(e) => onChange({ ...draft, visibility: e.target.checked ? 'org' : 'private' })}
          />
          Share with org
        </label>
        <div className="mt-auto flex justify-end gap-2 border-t border-border pt-3">
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving || !draft.content.trim()} className="gap-1.5">
            {saving ? <Spinner className="size-4" /> : null}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </aside>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-48 animate-pulse rounded-lg border border-border bg-card" />
      ))}
    </div>
  );
}

function CommonPromptsPanel({
  common,
  available,
  onSave,
}: {
  common: CommonPrompt[] | null;
  available: boolean;
  onSave: (c: CommonPrompt) => void;
}) {
  return (
    <div className="space-y-3 border-t border-border pt-6">
      <div className="flex items-center gap-2">
        <TrendUp className="size-4 text-primary" />
        <h2 className="font-mono text-sm font-semibold">Common prompts</h2>
        <p className="text-xs text-muted-foreground">
          Frequently used across the org, from gateway history.
        </p>
      </div>
      {common === null ? (
        <LoadingBlock />
      ) : !available ? (
        <p className="text-xs text-muted-foreground">
          Usage history unavailable (OpenSearch unreachable).
        </p>
      ) : common.length === 0 ? (
        <p className="text-xs text-muted-foreground">No prompt history yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {common.map((c, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 shadow-sm"
            >
              <Badge variant="secondary" className="mt-0.5 shrink-0 text-[10px]">
                {c.count}×
              </Badge>
              <p className="line-clamp-3 flex-1 font-mono text-xs text-muted-foreground">{c.prompt}</p>
              <Button
                size="xs"
                variant="outline"
                className="shrink-0 gap-1"
                onClick={() => onSave(c)}
              >
                <Plus className="size-3" /> Save
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
