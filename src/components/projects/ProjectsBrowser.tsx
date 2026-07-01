'use client';

import { FolderOpen, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  updatedAt: string;
}

export function ProjectsBrowser() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [shared, setShared] = useState<(ProjectRow & { canEdit: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

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
      window.location.href = `/projects/${id}`;
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Projects</h1>
          <p className="text-xs text-muted-foreground">
            Group chats under shared instructions and a knowledgebase.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={create} disabled={creating}>
          <Plus className="size-4" /> {creating ? 'Creating…' : 'New project'}
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <FolderOpen className="size-8 text-muted-foreground" />
            <p className="text-sm">No projects yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              A project keeps related chats together with a shared system prompt and uploaded
              knowledge the model can cite.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Card key={p.id} className="group relative shadow-sm transition-colors hover:border-primary/50">
              <CardContent className="p-4">
                <Link href={`/projects/${p.id}`} className="block space-y-1.5">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="size-4 text-primary" />
                    <span className="truncate text-sm font-medium">{p.name}</span>
                  </div>
                  <p className="line-clamp-2 min-h-[2rem] text-xs text-muted-foreground">
                    {p.systemPrompt || p.description || 'No instructions set.'}
                  </p>
                </Link>
                <button
                  onClick={() => remove(p.id, p.name)}
                  aria-label="Delete project"
                  className="absolute right-3 top-3 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash className="size-3.5" />
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {shared.length ? (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Shared with me</h2>
            <p className="text-xs text-muted-foreground">
              Projects other people gave you access to.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shared.map((p) => (
              <Card key={p.id} className="shadow-sm transition-colors hover:border-primary/50">
                <CardContent className="p-4">
                  <Link href={`/projects/${p.id}`} className="block space-y-1.5">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="size-4 text-primary" />
                      <span className="truncate text-sm font-medium">{p.name}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {p.canEdit ? 'edit' : 'view'}
                      </span>
                    </div>
                    <p className="line-clamp-2 min-h-[2rem] text-xs text-muted-foreground">
                      {p.systemPrompt || p.description || 'No instructions set.'}
                    </p>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
