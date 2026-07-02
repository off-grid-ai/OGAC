'use client';

import {
  Copy,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  TextAlignLeft,
  Trash,
  TrendUp,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

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

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const p of prompts) for (const t of p.tags) s.add(t);
    return [...s].sort();
  }, [prompts]);

  async function copyPrompt(p: Prompt) {
    await navigator.clipboard.writeText(p.content);
    toast.success('Copied to clipboard');
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
      setDraft(null);
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
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-lg font-semibold">Prompts</h1>
          <p className="text-xs text-muted-foreground">
            Save, organize, and reuse prompts. Use <code className="text-primary">{'{{variable}}'}</code>{' '}
            placeholders for templating.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
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

      {draft ? (
        <PromptForm
          draft={draft}
          saving={saving}
          onChange={setDraft}
          onSave={save}
          onCancel={() => setDraft(null)}
        />
      ) : null}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : prompts.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <TextAlignLeft className="size-8 text-muted-foreground" />
            <p className="text-sm">No prompts yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Save a prompt to reuse it, or pull one from Common Prompts below.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {prompts.map((p) => (
            <Card key={p.id} className="group relative shadow-sm transition-colors hover:border-primary/50">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                  <TextAlignLeft className="size-4 shrink-0 text-primary" />
                  <span className="truncate font-mono text-sm font-medium">{p.title}</span>
                  {p.visibility === 'org' ? (
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      org
                    </Badge>
                  ) : null}
                </div>
                <p className="line-clamp-3 min-h-[3rem] whitespace-pre-wrap text-xs text-muted-foreground">
                  {p.content}
                </p>
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
                <div className="flex items-center gap-2 pt-1">
                  <Button size="xs" variant="outline" className="gap-1" onClick={() => copyPrompt(p)}>
                    <Copy className="size-3" /> Copy
                  </Button>
                  <button
                    onClick={() =>
                      setDraft({
                        id: p.id,
                        title: p.title,
                        content: p.content,
                        tags: p.tags.join(', '),
                        visibility: p.visibility,
                      })
                    }
                    aria-label="Edit prompt"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <PencilSimple className="size-3.5" />
                  </button>
                  <button
                    onClick={() => remove(p)}
                    aria-label="Delete prompt"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash className="size-3.5" />
                  </button>
                  <span className="ml-auto text-[10px] text-muted-foreground">{p.uses} uses</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CommonPromptsPanel
        common={common}
        available={commonAvailable}
        onSave={saveCommon}
      />
    </div>
  );
}

function PromptForm({
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
    <Card className="shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-sm font-semibold">{draft.id ? 'Edit prompt' : 'New prompt'}</h2>
          <button onClick={onCancel} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <Input
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          placeholder="Title"
          className="font-mono"
        />
        <Textarea
          value={draft.content}
          onChange={(e) => onChange({ ...draft, content: e.target.value })}
          placeholder="Prompt text — use {{variable}} for placeholders."
          rows={6}
          className="font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={draft.tags}
            onChange={(e) => onChange({ ...draft, tags: e.target.value })}
            placeholder="tags, comma, separated"
            className="max-w-xs font-mono"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={draft.visibility === 'org'}
              onChange={(e) => onChange({ ...draft, visibility: e.target.checked ? 'org' : 'private' })}
            />
            Share with org
          </label>
          <Button size="sm" className="ml-auto" onClick={onSave} disabled={saving || !draft.content.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
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
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendUp className="size-4 text-primary" />
        <h2 className="font-mono text-sm font-semibold">Common prompts</h2>
        <p className="text-xs text-muted-foreground">Frequently used across the org, from gateway history.</p>
      </div>
      {common === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : !available ? (
        <p className="text-xs text-muted-foreground">
          Usage history unavailable (OpenSearch unreachable).
        </p>
      ) : common.length === 0 ? (
        <p className="text-xs text-muted-foreground">No prompt history yet.</p>
      ) : (
        <div className="space-y-2">
          {common.map((c, i) => (
            <Card key={i} className="shadow-sm">
              <CardContent className="flex items-start gap-3 p-3">
                <Badge variant="secondary" className="mt-0.5 shrink-0 text-[10px]">
                  {c.count}×
                </Badge>
                <p className="line-clamp-2 flex-1 font-mono text-xs text-muted-foreground">{c.prompt}</p>
                <Button size="xs" variant="outline" className="shrink-0 gap-1" onClick={() => onSave(c)}>
                  <Plus className="size-3" /> Save
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
