'use client';

import {
  ArrowSquareOut,
  Globe,
  PencilSimple,
  Plus,
  Sparkle,
  Trash,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { panelHref, withPanelParams } from '@/lib/url-panel';
import { accentHue, initials, relativeTime } from '@/lib/workspace-grid';

export interface StudioApp {
  id: string;
  title: string;
  summary: string;
  visibility: string;
  slug: string | null;
  published: boolean;
  updatedAt: string;
  agentId: string | null;
}

const VIS_LABEL: Record<string, string> = {
  private: 'Just me',
  org: 'My org',
  public: 'Shared link',
};

interface Draft {
  title: string;
  summary: string;
  visibility: string;
  published: boolean;
}

function AppCard({
  app,
  onEdit,
  onDelete,
}: Readonly<{
  app: StudioApp;
  onEdit: () => void;
  onDelete: () => void;
}>) {
  const hue = accentHue(app.id || app.title);
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded font-mono text-[11px] font-medium"
          style={{ background: `hsl(${hue} 60% 45% / 0.15)`, color: `hsl(${hue} 60% 45%)` }}
          aria-hidden
        >
          {initials(app.title)}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">{app.title}</span>
        <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
          {VIS_LABEL[app.visibility] ?? app.visibility}
        </Badge>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="line-clamp-3 min-h-[3rem] text-xs leading-relaxed text-muted-foreground">
          {app.summary || '—'}
        </p>
        {app.published && app.slug ? (
          <a
            href={`/app/${app.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
          >
            <ArrowSquareOut className="size-3.5" />
            /app/{app.slug}
          </a>
        ) : null}
        <div className="mt-auto flex items-center gap-1.5 border-t border-border pt-2.5">
          {app.agentId ? (
            <Button asChild size="xs" variant="outline">
              <Link href={`/solutions/agents/${app.agentId}`}>Open &amp; try</Link>
            </Button>
          ) : null}
          <button
            onClick={onEdit}
            aria-label="Edit assistant"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PencilSimple className="size-3.5" />
          </button>
          <button
            onClick={onDelete}
            aria-label="Delete assistant"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          >
            <Trash className="size-3.5" />
          </button>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {app.published ? (
              <span className="inline-flex items-center gap-1 text-primary">
                <Globe className="size-3" />
                live
              </span>
            ) : (
              'draft'
            )}
            {app.updatedAt ? ` · ${relativeTime(app.updatedAt)}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

// The Studio gallery: a responsive card grid of saved assistants with URL-driven edit (title,
// summary, visibility, publish) and delete. Publishing mints /app/<slug>. Navigation lives in the
// URL (?panel=st-edit:<id>) so Back closes the panel and it's deep-linkable.
export function StudioGallery({ apps }: Readonly<{ apps: StudioApp[] }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const panel = params.get('panel') ?? '';
  const editId = panel.startsWith('st-edit:') ? panel.slice('st-edit:'.length) : null;
  const editing = editId ? apps.find((a) => a.id === editId) : undefined;
  const open = editId !== null;

  const [draft, setDraft] = useState<Draft>({
    title: '',
    summary: '',
    visibility: 'private',
    published: false,
  });
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (open && editing) {
      setDraft({
        title: editing.title,
        summary: editing.summary,
        visibility: editing.published ? 'public' : editing.visibility,
        published: editing.published,
      });
      setTouched(false);
    }
  }, [open, editId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setTouched(true);
    if (!draft.title.trim()) {
      toast.error('A title is required');
      return;
    }
    if (!editId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/studio/templates/${editId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: draft.title,
          summary: draft.summary,
          visibility: draft.published ? 'public' : draft.visibility,
          published: draft.published,
        }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Saved "${draft.title}"`);
      setPanel(null);
      router.refresh();
    } catch {
      toast.error('Failed to save assistant');
    } finally {
      setBusy(false);
    }
  }

  async function remove(app: StudioApp) {
    if (!confirm(`Delete "${app.title}"?`)) return;
    try {
      const res = await fetch(`/api/v1/studio/templates/${app.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      toast.success(`${app.title} removed`);
      router.refresh();
    } catch {
      toast.error('Delete failed');
    }
  }

  if (apps.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card py-10 text-center shadow-sm">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkle className="size-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          No assistants yet. Describe one in plain language and Studio builds it.
        </p>
        <Button asChild size="sm">
          <Link href="/build/studio/new">
            <Plus className="size-4" />
            Create your first assistant
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {apps.map((app) => (
          <AppCard
            key={app.id}
            app={app}
            onEdit={() => setPanel(`st-edit:${app.id}`)}
            onDelete={() => remove(app)}
          />
        ))}
      </div>

      <Sheet open={open} onOpenChange={(o) => !o && setPanel(null)}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Edit assistant</SheetTitle>
            <SheetDescription>
              Rename it, refine the summary, choose who can see it, and publish a shareable link.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-1.5">
              <Label htmlFor="st-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="st-title"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                aria-invalid={touched && !draft.title.trim() ? true : undefined}
              />
              {touched && !draft.title.trim() ? (
                <p className="text-[11px] text-destructive">A title is required.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-summary">Summary</Label>
              <Textarea
                id="st-summary"
                rows={3}
                value={draft.summary}
                onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
                placeholder="What this assistant does, in a sentence."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-visibility">Visibility</Label>
              <select
                id="st-visibility"
                value={draft.published ? 'public' : draft.visibility}
                disabled={draft.published}
                onChange={(e) => setDraft((d) => ({ ...d, visibility: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm disabled:opacity-60"
              >
                <option value="private">Just me</option>
                <option value="org">My org</option>
              </select>
              {draft.published ? (
                <p className="text-[11px] text-muted-foreground">
                  Published assistants are public via their shared link.
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <Label htmlFor="st-published">Publish as a shared app</Label>
                <p className="text-[11px] text-muted-foreground">
                  Serve it at /app/&lt;slug&gt; for anyone with the link.
                  {editing?.slug ? ` Current: /app/${editing.slug}` : ''}
                </p>
              </div>
              <Switch
                id="st-published"
                checked={draft.published}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, published: v }))}
              />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={save} disabled={busy} className="w-full">
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
