'use client';

import {
  ChatCircleDots,
  FolderOpen,
  MagnifyingGlass,
  Plus,
  Trash,
  Users,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CardRail } from '@/components/workspace/CardRail';
import { cn } from '@/lib/utils';
import { accentHue, initials, preview, relativeTime } from '@/lib/workspace-grid';

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  chatCount?: number;
  updatedAt: string;
}

// Projects as a Workspace grid — each project is a chat context, shown as a scannable tile with an
// accent, its instruction preview, chat count, and last-active time. A modern card library, not a
// thin list. Reuses the existing /api/v1/chat/projects APIs; the detail lives at /projects/[id].
export function ProjectsBrowser() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [shared, setShared] = useState<(ProjectRow & { canEdit: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const [r, sr] = await Promise.all([
      fetch('/api/v1/chat/projects'),
      fetch('/api/v1/chat/projects/shared'),
    ]);
    if (r.ok) setProjects((await r.json()).projects ?? []);
    if (sr.ok) setShared((await sr.json()).projects ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.systemPrompt ?? '').toLowerCase().includes(needle) ||
        (p.description ?? '').toLowerCase().includes(needle),
    );
  }, [projects, q]);

  async function create() {
    setCreating(true);
    const r = await fetch('/api/v1/chat/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New project' }),
    });
    setCreating(false);
    if (r.ok) {
      const { id } = await r.json();
      window.location.href = `/workspace/projects/${id}`;
    } else {
      toast.error('Could not create project');
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete project “${name}”? Its chats are kept but un-grouped.`)) return;
    await fetch(`/api/v1/chat/projects/${id}`, { method: 'DELETE' });
    toast.success('Project deleted');
    void load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold">Projects</h1>
          <p className="text-xs text-muted-foreground">
            Each project is a chat context — shared instructions plus a knowledgebase the model can
            cite.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search projects"
              className="w-44 rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none transition-colors focus:border-primary/50"
            />
          </div>
          <Button size="sm" className="gap-1.5" onClick={create} disabled={creating}>
            <Plus className="size-4" /> {creating ? 'Creating…' : 'New project'}
          </Button>
        </div>
      </div>

      {loading ? (
        <GridSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="size-8 text-muted-foreground" />}
          title={q ? 'No projects match' : 'No projects yet'}
          body={
            q
              ? 'Try a different search.'
              : 'A project keeps related chats together with a shared system prompt and uploaded knowledge the model can cite.'
          }
        />
      ) : (
        <CardRail>
          {filtered.map((p) => (
            <ProjectCard key={p.id} p={p} onDelete={() => remove(p.id, p.name)} />
          ))}
        </CardRail>
      )}

      {shared.length ? (
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-primary" />
            <h2 className="font-mono text-sm font-semibold">Shared with me</h2>
            <span className="text-xs text-muted-foreground">
              Projects other people gave you access to.
            </span>
          </div>
          <CardRail>
            {shared.map((p) => (
              <ProjectCard key={p.id} p={p} badge={p.canEdit ? 'edit' : 'view'} />
            ))}
          </CardRail>
        </div>
      ) : null}
    </div>
  );
}

function ProjectCard({
  p,
  badge,
  onDelete,
}: {
  p: ProjectRow;
  badge?: string;
  onDelete?: () => void;
}) {
  const hue = accentHue(p.id || p.name);
  const instr = preview(p.systemPrompt || p.description, 130);
  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
      <span
        aria-hidden
        className="h-1 w-full shrink-0"
        style={{ background: `hsl(${hue} 70% 45%)` }}
      />
      <Link href={`/workspace/projects/${p.id}`} className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-md font-mono text-xs font-semibold text-white"
            style={{ background: `hsl(${hue} 65% 40%)` }}
          >
            {initials(p.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{p.name}</span>
              {badge ? (
                <span className="shrink-0 rounded border border-border px-1 text-[10px] uppercase text-muted-foreground">
                  {badge}
                </span>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-3 min-h-[3rem] text-xs leading-relaxed text-muted-foreground">
              {instr || 'No instructions set.'}
            </p>
          </div>
        </div>
        <div className="mt-auto flex items-center gap-3 border-t border-border pt-2.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          <span className="flex items-center gap-1">
            <ChatCircleDots className="size-3" /> {p.chatCount ?? 0} chats
          </span>
          {p.updatedAt ? <span>· {relativeTime(p.updatedAt)}</span> : null}
        </div>
      </Link>
      {onDelete ? (
        <button
          onClick={onDelete}
          aria-label="Delete project"
          className={cn(
            'absolute right-2.5 top-2.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity',
            'hover:bg-muted hover:text-destructive group-hover:opacity-100',
          )}
        >
          <Trash className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-lg border border-border bg-card" />
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
      {icon}
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
