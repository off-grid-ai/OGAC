'use client';

import { ArrowLeft, Copy, PencilSimple, Plus, PuzzlePiece, Trash, X } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { extractVariables } from '@/lib/prompt-template';
import { panelHref, withPanelParams } from '@/lib/url-panel';
import { relativeTime } from '@/lib/workspace-grid';

interface Partial {
  id: string;
  name: string;
  title: string;
  content: string;
  owner: string;
  visibility: string;
  updatedAt: string;
}

type Draft = { id?: string; name: string; title: string; content: string; visibility: string };
const EMPTY_DRAFT: Draft = { name: '', title: '', content: '', visibility: 'private' };

// Prompt Partials — CRUD for reusable prompt fragments. A partial is referenced from a prompt with a
// `{{>name}}` token; the renderer inlines it. Edit/create is a URL-driven side panel (?panel=new / id).
export function PromptPartials() {
  const [partials, setPartials] = useState<Partial[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const panel = searchParams.get('panel');

  const load = useCallback(async () => {
    const r = await fetch('/api/v1/prompts/partials');
    if (r.ok) setPartials((await r.json()).partials ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!panel) {
      setDraft(null);
      return;
    }
    if (panel === 'new') {
      setDraft((d) => d ?? { ...EMPTY_DRAFT });
      return;
    }
    const p = partials.find((x) => x.id === panel);
    if (p) {
      setDraft({ id: p.id, name: p.name, title: p.title, content: p.content, visibility: p.visibility });
    }
  }, [panel, partials]);

  const openPanel = useCallback(
    (id: string) => {
      router.push(panelHref(pathname, withPanelParams(searchParams.toString(), { panel: id })));
    },
    [router, pathname, searchParams],
  );
  const closePanel = useCallback(() => {
    router.push(panelHref(pathname, withPanelParams(searchParams.toString(), { panel: null })));
  }, [router, pathname, searchParams]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    const payload = {
      name: draft.name || draft.title,
      title: draft.title,
      content: draft.content,
      visibility: draft.visibility,
    };
    const r = draft.id
      ? await fetch(`/api/v1/prompts/partials/${draft.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/v1/prompts/partials', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (r.ok) {
      toast.success(draft.id ? 'Partial updated' : 'Partial saved');
      closePanel();
      void load();
    } else {
      toast.error('Could not save partial');
    }
  }

  async function remove(p: Partial) {
    if (!confirm(`Delete partial “${p.name}”?`)) return;
    const r = await fetch(`/api/v1/prompts/partials/${p.id}`, { method: 'DELETE' });
    if (r.ok) {
      toast.success('Partial deleted');
      void load();
    } else {
      toast.error('Could not delete');
    }
  }

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/workspace/prompts"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3" /> Prompts
            </Link>
            <h1 className="mt-1 font-mono text-lg font-semibold">Partials</h1>
            <p className="text-xs text-muted-foreground">
              Reusable prompt fragments. Reference one from any prompt with{' '}
              <code className="text-primary">{'{{>name}}'}</code> — it is inlined when the prompt runs.
            </p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => openPanel('new')}>
            <Plus className="size-4" /> New partial
          </Button>
        </div>

        {loading ? (
          <GridSkeleton />
        ) : partials.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
            <PuzzlePiece className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No partials yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Create a fragment once — a shared header, a tone-of-voice block, a disclaimer — and drop
              it into any prompt with <code className="text-primary">{'{{>name}}'}</code>.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {partials.map((p) => (
              <PartialCard key={p.id} p={p} onEdit={() => openPanel(p.id)} onDelete={() => remove(p)} />
            ))}
          </div>
        )}
      </div>

      {draft ? (
        <PartialEditPanel
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

function PartialCard({ p, onEdit, onDelete }: { p: Partial; onEdit: () => void; onDelete: () => void }) {
  const vars = extractVariables(p.content);
  async function copyRef() {
    await navigator.clipboard.writeText(`{{>${p.name}}}`);
    toast.success(`Copied {{>${p.name}}} — paste it into a prompt`);
  }
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <PuzzlePiece className="size-4 shrink-0 text-primary" />
        <button
          onClick={copyRef}
          title="Copy the {{>reference}} token"
          className="truncate font-mono text-xs font-medium hover:text-primary hover:underline"
        >
          {`{{>${p.name}}}`}
        </button>
        {p.visibility === 'org' ? (
          <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
            org
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {p.title ? <p className="truncate text-xs font-medium text-foreground">{p.title}</p> : null}
        <p className="line-clamp-4 min-h-[4rem] whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
          {p.content || '—'}
        </p>
        {vars.length ? (
          <div className="flex flex-wrap gap-1">
            {vars.map((v) => (
              <Badge key={v} variant="outline" className="text-[10px] text-primary">
                {`{{${v}}}`}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="mt-auto flex items-center gap-2 border-t border-border pt-2.5">
          <Button size="xs" variant="outline" className="gap-1" onClick={copyRef}>
            <Copy className="size-3" /> Ref
          </Button>
          <button
            onClick={onEdit}
            aria-label="Edit partial"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PencilSimple className="size-3.5" />
          </button>
          <button
            onClick={onDelete}
            aria-label="Delete partial"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          >
            <Trash className="size-3.5" />
          </button>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {p.updatedAt ? relativeTime(p.updatedAt) : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

function PartialEditPanel({
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
        <h2 className="font-mono text-sm font-semibold">{draft.id ? 'Edit partial' : 'New partial'}</h2>
        <button onClick={onCancel} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <label className="space-y-1 text-xs text-muted-foreground">
          Reference name
          <Input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="e.g. disclaimer"
            className="font-mono"
          />
          <span className="text-[10px] text-muted-foreground/70">
            Referenced as <code className="text-primary">{`{{>${draft.name || 'name'}}}`}</code>.
            Spaces and symbols are slugged.
          </span>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Title (optional)
          <Input
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            placeholder="Human-friendly name"
            className="font-mono"
          />
        </label>
        <label className="flex flex-1 flex-col space-y-1 text-xs text-muted-foreground">
          Fragment text
          <Textarea
            value={draft.content}
            onChange={(e) => onChange({ ...draft, content: e.target.value })}
            placeholder="The reusable fragment. It can use {{variable}} placeholders too."
            rows={12}
            className="flex-1 font-mono text-xs"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={draft.visibility === 'org'}
            onChange={(e) => onChange({ ...draft, visibility: e.target.checked ? 'org' : 'private' })}
          />
          <span>Share with org</span>
        </label>
        <div className="mt-auto flex justify-end gap-2 border-t border-border pt-3">
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={saving || !draft.content.trim() || !(draft.name || draft.title).trim()}
            className="gap-1.5"
          >
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
