'use client';

import { FileText, Trash, UploadSimple } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface Project {
  id: string;
  name: string;
  systemPrompt: string;
}
interface Doc {
  id: string;
  name: string;
  size: number;
}

// Project settings — name, system instructions, and knowledgebase (upload text/markdown files,
// which the gateway embeds so project chats retrieve + cite them). Mirrors the desktop project view.
export function ProjectDialog({
  project,
  open,
  onOpenChange,
  onSaved,
}: {
  project: Project | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async (id: string) => {
    const r = await fetch(`/api/v1/chat/projects/${id}/documents`);
    if (r.ok) setDocs((await r.json()).documents ?? []);
  }, []);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setSystemPrompt(project.systemPrompt);
      void loadDocs(project.id);
    }
  }, [project, loadDocs]);

  async function save() {
    if (!project) return;
    await fetch(`/api/v1/chat/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, systemPrompt }),
    });
    toast.success('Project saved');
    onSaved();
    onOpenChange(false);
  }

  async function upload(files: FileList | null) {
    if (!files || !project) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      const content = await f.text();
      const r = await fetch(`/api/v1/chat/projects/${project.id}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: f.name, content }),
      });
      if (r.ok) {
        const { chunks } = await r.json();
        toast.success(`${f.name} · ${chunks} chunks embedded`);
      } else {
        toast.error(`${f.name} failed`);
      }
    }
    setBusy(false);
    await loadDocs(project.id);
  }

  async function removeDoc(docId: string) {
    await fetch(`/api/v1/chat/documents/${docId}`, { method: 'DELETE' });
    if (project) await loadDocs(project.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Project settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Instructions (system prompt)</Label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              placeholder="How should the model behave in this project? e.g. 'You are our support agent. Cite policy docs.'"
              className="text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Knowledge ({docs.length})</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.markdown,.csv,.json,text/*"
                multiple
                hidden
                onChange={(e) => upload(e.target.files)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="h-7 gap-1.5 text-xs"
              >
                <UploadSimple className="size-3.5" />
                {busy ? 'Embedding…' : 'Add files'}
              </Button>
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
              {docs.length === 0 ? (
                <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                  No documents. Add text/markdown files to ground answers.
                </p>
              ) : (
                docs.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted"
                  >
                    <FileText className="size-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{d.name}</span>
                    <Trash
                      onClick={() => removeDoc(d.id)}
                      className="size-3.5 cursor-pointer text-muted-foreground hover:text-destructive"
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <DialogFooterRow onCancel={() => onOpenChange(false)} onSave={save} />
      </DialogContent>
    </Dialog>
  );
}

function DialogFooterRow({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button variant="outline" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" onClick={onSave}>
        Save
      </Button>
    </div>
  );
}
