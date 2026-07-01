'use client';

import {
  ArrowLeft,
  ChatCircleDots,
  FileText,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Doc {
  id: string;
  name: string;
  size: number;
}
interface Conversation {
  id: string;
  title: string;
  projectId: string | null;
  updatedAt: string;
}

// eslint-disable-next-line complexity
export function ProjectDetail({ projectId }: { projectId: string }) {
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    const r = await fetch(`/api/v1/chat/projects/${projectId}/documents`);
    if (r.ok) setDocs((await r.json()).documents ?? []);
  }, [projectId]);

  const load = useCallback(async () => {
    const [pr, cr] = await Promise.all([
      fetch('/api/v1/chat/projects'),
      fetch('/api/v1/chat/conversations'),
    ]);
    if (pr.ok) {
      const found = ((await pr.json()).projects ?? []).find(
        (p: { id: string }) => p.id === projectId,
      );
      if (found) {
        setName(found.name ?? '');
        setSystemPrompt(found.systemPrompt ?? '');
      }
    }
    if (cr.ok) {
      const all: Conversation[] = (await cr.json()).conversations ?? [];
      setChats(all.filter((c) => c.projectId === projectId));
    }
    await loadDocs();
    setLoaded(true);
  }, [projectId, loadDocs]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    await fetch(`/api/v1/chat/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, systemPrompt }),
    });
    setSaving(false);
    toast.success('Project saved');
  }

  async function upload(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      const content = await f.text();
      const r = await fetch(`/api/v1/chat/projects/${projectId}/documents`, {
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
    await loadDocs();
  }

  async function removeDoc(docId: string) {
    await fetch(`/api/v1/chat/documents/${docId}`, { method: 'DELETE' });
    await loadDocs();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/projects"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Back to projects"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-lg font-semibold">{loaded ? name || 'Project' : 'Loading…'}</h1>
        </div>
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link href={`/chat?project=${projectId}`}>
            <ChatCircleDots className="size-4" /> New chat in project
          </Link>
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Instructions</CardTitle>
          <p className="text-xs text-muted-foreground">
            Applied as the system prompt for every chat in this project.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">System prompt</Label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={5}
              placeholder="How should the model behave in this project? e.g. 'You are our support agent. Cite policy docs.'"
              className="text-sm"
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">Knowledge ({docs.length})</CardTitle>
            <p className="text-xs text-muted-foreground">
              Text/markdown files, embedded so project chats retrieve and cite them.
            </p>
          </div>
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
            className="gap-1.5"
          >
            <UploadSimple className="size-3.5" />
            {busy ? 'Embedding…' : 'Add files'}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 rounded-md border border-border p-1.5">
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
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Chats ({chats.length})</CardTitle>
          <p className="text-xs text-muted-foreground">Conversations grouped under this project.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {chats.length === 0 ? (
              <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                No chats yet — start one with “New chat in project”.
              </p>
            ) : (
              chats.map((c) => (
                <Link
                  key={c.id}
                  href={`/chat?c=${c.id}`}
                  className="flex items-center gap-2 rounded px-1.5 py-1.5 text-xs hover:bg-muted"
                >
                  <ChatCircleDots className="size-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">{c.title}</span>
                </Link>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
