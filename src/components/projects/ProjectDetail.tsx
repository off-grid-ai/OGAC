'use client';

import {
  ArrowLeft,
  ChatCircleDots,
  FileText,
  ShareNetwork,
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
import { accentHue, initials } from '@/lib/workspace-grid';
import { ShareDialog } from './ShareDialog';

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
interface MemoryRow {
  id: string;
  fact: string;
  source: string;
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
  const [shareOpen, setShareOpen] = useState(false);
  const [visibility, setVisibility] = useState('private');
  const [access, setAccess] = useState<string | null>(null);
  const [memory, setMemory] = useState<MemoryRow[]>([]);
  const [newFact, setNewFact] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const canManage = access === 'owner';
  const canEdit = access === 'owner' || access === 'edit';

  // Knowledge capacity — approximate tokens from document bytes (~4 chars/token, desktop default).
  // Under the full-context threshold the whole corpus fits in the window; above it, chat falls back
  // to RAG retrieval (mirrors Claude's "project knowledge" behavior).
  const FULL_CONTEXT_TOKENS = 100_000;
  const usedTokens = Math.round(docs.reduce((sum, d) => sum + (d.size ?? 0), 0) / 4);
  const pct = Math.min(100, Math.round((usedTokens / FULL_CONTEXT_TOKENS) * 100));
  const retrievalMode = usedTokens <= FULL_CONTEXT_TOKENS ? 'full-context' : 'RAG';

  const loadDocs = useCallback(async () => {
    const r = await fetch(`/api/v1/chat/projects/${projectId}/documents`);
    if (r.ok) setDocs((await r.json()).documents ?? []);
  }, [projectId]);

  const loadMemory = useCallback(async () => {
    const r = await fetch(`/api/v1/chat/projects/${projectId}/memory`);
    if (r.ok) setMemory((await r.json()).memory ?? []);
  }, [projectId]);

  async function addFact() {
    const f = newFact.trim();
    if (!f) return;
    setNewFact('');
    await fetch(`/api/v1/chat/projects/${projectId}/memory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fact: f }),
    });
    await loadMemory();
  }

  async function removeFact(memId: string) {
    await fetch(`/api/v1/chat/projects/${projectId}/memory?memId=${memId}`, { method: 'DELETE' });
    await loadMemory();
  }

  // eslint-disable-next-line complexity
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
        setVisibility(found.visibility ?? 'private');
      }
    }
    const sr = await fetch(`/api/v1/chat/projects/${projectId}/share`);
    if (sr.ok) setAccess((await sr.json()).access ?? null);
    if (cr.ok) {
      const all: Conversation[] = (await cr.json()).conversations ?? [];
      setChats(all.filter((c) => c.projectId === projectId));
    }
    await loadDocs();
    await loadMemory();
    setLoaded(true);
  }, [projectId, loadDocs, loadMemory]);

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

  const hue = accentHue(projectId);
  const displayName = loaded ? name || 'Project' : 'Loading…';

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <Link
        href="/workspace/projects"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> All projects
      </Link>

      {/* Hero header — accent tile + name + meta chips + primary actions */}
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div
            className="flex size-14 shrink-0 items-center justify-center rounded-xl text-lg font-semibold"
            style={{
              backgroundColor: `hsl(${hue} 70% 92%)`,
              color: `hsl(${hue} 60% 32%)`,
            }}
          >
            {initials(displayName)}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{displayName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {chats.length} chat{chats.length === 1 ? '' : 's'}
              </span>
              <span aria-hidden>·</span>
              <span>
                {docs.length} doc{docs.length === 1 ? '' : 's'}
              </span>
              <span aria-hidden>·</span>
              <span
                className={
                  retrievalMode === 'full-context'
                    ? 'rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-medium text-primary'
                    : 'rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600'
                }
              >
                retrieval: {retrievalMode}
              </span>
              <span className="rounded border border-border px-1.5 py-0.5">{visibility}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canManage ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setShareOpen(true)}
            >
              <ShareNetwork className="size-4" /> Share
              <span className="text-[10px] text-muted-foreground">({visibility})</span>
            </Button>
          ) : null}
          <Button asChild size="sm" className="gap-1.5">
            <Link href={`/workspace/chat?project=${projectId}`}>
              <ChatCircleDots className="size-4" /> New chat in project
            </Link>
          </Button>
        </div>
      </div>

      {canManage ? (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          projectId={projectId}
          visibility={visibility}
          onVisibilityChange={setVisibility}
        />
      ) : null}

      {/* Two-column workspace: instructions + chats on the left, knowledge + memory on the right */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
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
                  rows={8}
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
            <CardHeader>
              <CardTitle className="text-sm">Chats ({chats.length})</CardTitle>
              <p className="text-xs text-muted-foreground">
                Conversations grouped under this project.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {chats.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                    No chats yet — start one with “New chat in project”.
                  </p>
                ) : (
                  chats.map((c) => (
                    <Link
                      key={c.id}
                      href={`/workspace/chat?c=${c.id}`}
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

        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="flex-row items-start justify-between space-y-0">
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
                className="shrink-0 gap-1.5"
              >
                <UploadSimple className="size-3.5" />
                {busy ? 'Embedding…' : 'Add files'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    ~{usedTokens.toLocaleString()} / {FULL_CONTEXT_TOKENS.toLocaleString()} tokens
                  </span>
                  <span
                    className={
                      retrievalMode === 'full-context'
                        ? 'rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary'
                        : 'rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600'
                    }
                    title={
                      retrievalMode === 'full-context'
                        ? 'The whole knowledge base fits in context each turn.'
                        : 'Knowledge base exceeds the window; chats retrieve relevant chunks (RAG).'
                    }
                  >
                    retrieval: {retrievalMode}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={pct >= 100 ? 'h-full bg-amber-500' : 'h-full bg-primary'}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
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
              <CardTitle className="text-sm">Project memory ({memory.length})</CardTitle>
              <p className="text-xs text-muted-foreground">
                Facts remembered for this project and injected into its chats. Captured automatically
                or added here.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {canEdit ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    value={newFact}
                    placeholder="Add a fact the project should remember…"
                    onChange={(e) => setNewFact(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addFact()}
                  />
                  <Button size="sm" className="shrink-0" onClick={addFact}>
                    Add
                  </Button>
                </div>
              ) : null}
              <div className="space-y-1 rounded-md border border-border p-1.5">
                {memory.length === 0 ? (
                  <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                    No project memory yet.
                  </p>
                ) : (
                  memory.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted"
                    >
                      <span className="flex-1">{m.fact}</span>
                      {canEdit ? (
                        <Trash
                          onClick={() => removeFact(m.id)}
                          className="size-3.5 cursor-pointer text-muted-foreground hover:text-destructive"
                        />
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
