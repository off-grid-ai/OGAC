'use client';

import { PencilSimple, Plus, Sparkle, Trash } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface Skill {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  projectId: string | null;
  allowedRoles: string[];
  enabled: boolean;
}
interface ProjectLite {
  id: string;
  name: string;
}
interface ModelLite {
  id: string;
}

const ROLES = ['admin', 'analyst', 'editor', 'viewer'];
const empty: Skill = {
  id: '',
  name: '',
  description: '',
  systemPrompt: '',
  model: '',
  projectId: null,
  allowedRoles: [],
  enabled: true,
};

// Org skills — RBAC-scoped reusable assistants. Picking one starts a new chat bound to that skill.
// Admins additionally get a create/edit manager (instructions, model, roles, knowledge project).
// eslint-disable-next-line complexity
export function SkillsDialog({
  open,
  onOpenChange,
  role,
  projects,
  models,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  role: string;
  projects: ProjectLite[];
  models: ModelLite[];
  onPick: (skillId: string) => void;
}) {
  const isAdmin = role === 'admin';
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<Skill | null>(null);

  const refresh = () =>
    fetch('/api/v1/chat/skills')
      .then((r) => (r.ok ? r.json() : { skills: [] }))
      .then((d) => setSkills(d.skills ?? []));

  useEffect(() => {
    if (open) {
      void refresh();
      setEditing(null);
    }
  }, [open]);

  async function save() {
    if (!editing) return;
    const url = editing.id ? `/api/v1/chat/skills/${editing.id}` : '/api/v1/chat/skills';
    const r = await fetch(url, {
      method: editing.id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(editing),
    });
    if (!r.ok) return toast.error('Save failed');
    toast.success('Skill saved');
    setEditing(null);
    await refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/v1/chat/skills/${id}`, { method: 'DELETE' });
    await refresh();
  }

  function toggleRole(r: string) {
    if (!editing) return;
    const has = editing.allowedRoles.includes(r);
    setEditing({
      ...editing,
      allowedRoles: has
        ? editing.allowedRoles.filter((x) => x !== r)
        : [...editing.allowedRoles, r],
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Sparkle className="size-4 text-primary" /> Skills
          </DialogTitle>
        </DialogHeader>

        {editing ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Instructions (system prompt)</Label>
              <Textarea
                rows={5}
                value={editing.systemPrompt}
                onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Model (optional)</Label>
                <select
                  value={editing.model}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                >
                  <option value="">default</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Knowledge project</Label>
                <select
                  value={editing.projectId ?? ''}
                  onChange={(e) => setEditing({ ...editing, projectId: e.target.value || null })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                >
                  <option value="">none</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Allowed roles (none = everyone)</Label>
              <div className="flex flex-wrap gap-1.5">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    onClick={() => toggleRole(r)}
                    className={
                      editing.allowedRoles.includes(r)
                        ? 'rounded border border-primary bg-primary/10 px-2 py-0.5 text-xs text-primary'
                        : 'rounded border border-border px-2 py-0.5 text-xs text-muted-foreground'
                    }
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {isAdmin ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => setEditing({ ...empty })}
              >
                <Plus className="size-4" /> New skill
              </Button>
            ) : null}
            <div className="max-h-80 space-y-1.5 overflow-y-auto">
              {skills.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">No skills yet.</p>
              ) : null}
              {skills.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-md border border-border p-2"
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      onPick(s.id);
                      onOpenChange(false);
                    }}
                  >
                    <div className="flex items-center gap-1.5 text-sm">
                      {s.name || 'Untitled'}
                      {!s.enabled ? (
                        <span className="text-[10px] text-muted-foreground">(disabled)</span>
                      ) : null}
                    </div>
                    {s.description ? (
                      <div className="truncate text-xs text-muted-foreground">{s.description}</div>
                    ) : null}
                  </button>
                  {isAdmin ? (
                    <>
                      <PencilSimple
                        onClick={() => setEditing(s)}
                        className="size-4 cursor-pointer text-muted-foreground hover:text-foreground"
                      />
                      <Trash
                        onClick={() => remove(s.id)}
                        className="size-4 cursor-pointer text-muted-foreground hover:text-destructive"
                      />
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
