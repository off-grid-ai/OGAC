'use client';

import { Trash, UserPlus } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Member {
  userId: string;
  canEdit: boolean;
}

// Project sharing — set visibility (private | org) and manage members with view/edit access.
// Owner/admin only (the API enforces it; the dialog is opened only when the caller may manage).
export function ShareDialog({
  open,
  onOpenChange,
  projectId,
  visibility,
  onVisibilityChange,
}: Readonly<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  visibility: string;
  onVisibilityChange: (v: string) => void;
}>) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [canEdit, setCanEdit] = useState(false);

  const refresh = () =>
    fetch(`/api/v1/chat/projects/${projectId}/share`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setMembers(d.members ?? []));

  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  async function setVisibility(v: string) {
    onVisibilityChange(v);
    await fetch(`/api/v1/chat/projects/${projectId}/share`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: v }),
    });
  }

  async function addMember() {
    const u = email.trim();
    if (!u) return;
    const r = await fetch(`/api/v1/chat/projects/${projectId}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: u, canEdit }),
    });
    if (!r.ok) return toast.error('Could not add member');
    setEmail('');
    setCanEdit(false);
    await refresh();
  }

  async function removeMember(userId: string) {
    await fetch(`/api/v1/chat/projects/${projectId}/share?userId=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
    await refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Share project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Visibility</Label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="private">Private — only me and members below</option>
              <option value="org">Org — discoverable across the org</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Add member (email)</Label>
            <div className="flex items-center gap-1.5">
              <Input
                value={email}
                placeholder="teammate@company.com"
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addMember()}
              />
              <Button size="sm" className="shrink-0 gap-1.5" onClick={addMember}>
                <UserPlus className="size-3.5" /> Add
              </Button>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={canEdit}
                onChange={(e) => setCanEdit(e.target.checked)}
              />
              <span>Can edit (otherwise view only)</span>
            </label>
          </div>

          <div className="space-y-1 rounded-md border border-border p-1.5">
            {members.length === 0 ? (
              <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                No members yet.
              </p>
            ) : (
              members.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted"
                >
                  <span className="flex-1 truncate">{m.userId}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {m.canEdit ? 'edit' : 'view'}
                  </span>
                  <Trash
                    onClick={() => removeMember(m.userId)}
                    className="size-3.5 cursor-pointer text-muted-foreground hover:text-destructive"
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
