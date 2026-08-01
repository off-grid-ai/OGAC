'use client';

import {
  ArrowLeft,
  ChatCircleDots,
  Cube,
  FileText,
  Globe,
  NotePencil,
  ShareNetwork,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { explainResponse } from '@/lib/api-failure';
import { noteDocumentName } from '@/lib/knowledge-note';
import { SUPPORTED_UPLOAD_ACCEPT } from '@/lib/upload-formats';
import { accentHue, initials, relativeTime } from '@/lib/workspace-grid';
import { KnowledgeTextSheet } from '@/components/knowledge/KnowledgeTextSheet';
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
interface ProjectArtifact {
  id: string;
  title: string;
  kind: string;
  language: string | null;
  conversationId: string | null;
  published: boolean;
  updatedAt: string;
}

// eslint-disable-next-line complexity
export function ProjectDetail({ projectId }: Readonly<{ projectId: string }>) {
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [docs, setDocs] = useState<Doc[]>([]);
  // Document preview. Holds the loaded document (or an error string) so a failed read is SHOWN rather
  // than silently leaving the panel closed.
  const [preview, setPreview] = useState<
    { name: string; chunks: { position: number; content: string }[]; error?: string } | null
  >(null);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [visibility, setVisibility] = useState('private');
  const [access, setAccess] = useState<string | null>(null);
  const [memory, setMemory] = useState<MemoryRow[]>([]);
  const [newFact, setNewFact] = useState('');
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);
  // Paste-a-note knowledge. Not every source is a file — a policy clause, an email, a decision from a
  // meeting is text someone has in their clipboard, and making them save a .txt first is friction for
  // exactly the non-technical operator this surface is for.
  const [noteOpen, setNoteOpen] = useState(false);
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

  const loadArtifacts = useCallback(async () => {
    const r = await fetch(`/api/v1/chat/projects/${projectId}/artifacts`);
    if (r.ok) setArtifacts((await r.json()).artifacts ?? []);
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
    await loadArtifacts();
    setLoaded(true);
  }, [projectId, loadDocs, loadMemory, loadArtifacts]);

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

  // One embed path for both entry modes (a file's text and pasted text are the same thing to the
  // indexer), so a fix to either lands once.
  async function addDocument(docName: string, content: string) {
    const r = await fetch(`/api/v1/chat/projects/${projectId}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: docName, content }),
    });
    if (r.ok) {
      const { chunks } = await r.json();
      toast.success(`${docName} · ${chunks} chunks embedded`);
      return true;
    }
    // A refusal is not a failure: a read-only demo account is the system working, so it gets an info
    // toast carrying the server's own words instead of "something went wrong".
    const failure = await explainResponse(r, `add ${docName}`);
    (failure.refusal ? toast.info : toast.error)(failure.message);
    return false;
  }

  // Files go up as multipart so the SERVER extracts the text — a PDF read here with file.text() indexes
  // its container bytes and reports a healthy chunk count, which is worse than refusing it.
  async function uploadFile(file: File) {
    const form = new FormData();
    form.append('file', file);
    const r = await fetch(`/api/v1/chat/projects/${projectId}/documents`, {
      method: 'POST',
      body: form,
    });
    if (r.ok) {
      const { chunks, pages } = await r.json();
      toast.success(
        `${file.name} · ${chunks} chunks embedded${pages ? ` from ${pages} page${pages === 1 ? '' : 's'}` : ''}`,
      );
      return;
    }
    const failure = await explainResponse(r, `add ${file.name}`);
    (failure.refusal ? toast.info : toast.error)(failure.message);
  }

  async function upload(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      await uploadFile(f);
    }
    setBusy(false);
    await loadDocs();
  }

  // The composer lives in the side panel (KnowledgeTextSheet) and hands back the derived name + text.
  async function saveNote(docName: string, body: string): Promise<boolean> {
    setBusy(true);
    const ok = await addDocument(docName, body);
    setBusy(false);
    if (ok) await loadDocs();
    return ok;
  }

  async function openDoc(docId: string, name: string) {
    setPreview({ name, chunks: [] });
    try {
      const res = await fetch(`/api/v1/chat/projects/${projectId}/documents/${docId}`);
      if (!res.ok) {
        setPreview({ name, chunks: [], error: 'Could not read this document.' });
        return;
      }
      const { document } = (await res.json()) as {
        document: { chunks: { position: number; content: string }[] };
      };
      setPreview({ name, chunks: document.chunks ?? [] });
    } catch {
      setPreview({ name, chunks: [], error: 'Could not reach the server.' });
    }
  }

  async function removeDoc(docId: string) {
    await fetch(`/api/v1/chat/documents/${docId}`, { method: 'DELETE' });
    await loadDocs();
  }

  const hue = accentHue(projectId);
  const displayName = loaded ? name || 'Project' : 'Loading…';

  // FULL WIDTH, top-left. This page was `mx-auto max-w-6xl`, which on a wide screen left roughly a third
  // of the viewport empty on each side — the most repeated piece of design feedback on this product. The
  // console shell already pads; a page fills what it is given.
  return (
    <div className="w-full space-y-6">
      <Link
        href="/work/projects"
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
            <Link href={`/work/chat?project=${projectId}`}>
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
      <div className="grid gap-6 lg:grid-cols-3 xl:grid-cols-4">
        <div className="space-y-6 lg:col-span-2 xl:col-span-3">
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
                      href={`/work/chat?c=${c.id}`}
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

          {/* Artifacts this project produced. The work a project generated is part of the project — it
              used to be findable only in the global Artifacts library, with nothing on the project page
              tying an output back to the chat that made it. Each card deep-links into the existing
              viewer panel (?artifact=<id>) rather than re-implementing a renderer here. */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Artifacts ({artifacts.length})</CardTitle>
              <p className="text-xs text-muted-foreground">
                Documents, diagrams and apps produced by this project&apos;s chats.
              </p>
            </CardHeader>
            <CardContent>
              {artifacts.length === 0 ? (
                <p className="px-1 py-6 text-xs text-muted-foreground">
                  No artifacts yet. When a chat in this project produces a document, diagram, table or
                  small app, it is saved here.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {artifacts.map((a) => {
                    const from = chats.find((c) => c.id === a.conversationId);
                    return (
                      <Link
                        key={a.id}
                        href={`/work/artifacts?artifact=${a.id}`}
                        className="group flex min-w-0 flex-col gap-1.5 rounded-md border border-border p-2.5 hover:border-primary/50 hover:bg-muted/50"
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Cube className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {a.title}
                          </span>
                          {a.published ? (
                            <span
                              className="shrink-0 text-primary"
                              title="Published to a public link"
                            >
                              <Globe className="size-3.5" />
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="rounded border border-border px-1 py-0.5 font-mono uppercase">
                            {a.language || a.kind}
                          </span>
                          <span>{relativeTime(a.updatedAt)}</span>
                          {from ? (
                            <>
                              <span aria-hidden>·</span>
                              <span className="min-w-0 truncate">from {from.title}</span>
                            </>
                          ) : null}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-sm">Knowledge ({docs.length})</CardTitle>
                <p className="text-xs text-muted-foreground">
                  PDF, text or Markdown — embedded so this project&rsquo;s chats retrieve and cite them.
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept={SUPPORTED_UPLOAD_ACCEPT}
                multiple
                hidden
                onChange={(e) => upload(e.target.files)}
              />
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setNoteOpen(true)}
                  className="gap-1.5"
                >
                  <NotePencil className="size-3.5" /> Add text
                </Button>
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
              </div>
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
                  <p className="px-1 py-3 text-xs text-muted-foreground">
                    No documents. Add text/markdown files to ground answers.
                  </p>
                ) : (
                  docs.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted"
                    >
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      {/* Clickable. This panel claims these documents ground the project's answers, so a
                          reviewer must be able to READ one — a name plus a delete button is not enough to
                          trust a citation. Opens the indexed chunks, i.e. exactly what retrieval sees. */}
                      <button
                        type="button"
                        onClick={() => void openDoc(d.id, d.name)}
                        className="flex-1 truncate text-left underline decoration-border decoration-dotted underline-offset-2 hover:decoration-primary"
                        title={`Preview ${d.name}`}
                      >
                        {d.name}
                      </button>
                      <Trash
                        onClick={() => removeDoc(d.id)}
                        className="size-3.5 shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
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
                  {/* Short placeholder: in this third-width column the long one was clipped mid-word
                      ("Add a fact the project shoul"), which reads as a broken field rather than a hint. */}
                  <Input
                    className="min-w-0 flex-1"
                    value={newFact}
                    placeholder="Add a fact…"
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
                  <p className="px-1 py-3 text-xs text-muted-foreground">
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

      <KnowledgeTextSheet
        open={noteOpen}
        onOpenChange={setNoteOpen}
        target={displayName}
        busy={busy}
        onSave={saveNote}
      />

      {/* Document preview. A side panel rather than a route: this is a quick look at a source, not a place
          with its own sub-resources — and the reviewer's context is the project they are standing in. */}
      <Sheet open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <SheetContent side="right" className="flex w-full max-w-2xl flex-col gap-0 p-0">
          <SheetHeader className="gap-1 border-b border-border px-4 py-3 pr-10">
            <SheetTitle className="font-mono text-sm">{preview?.name ?? 'Document'}</SheetTitle>
            <p className="text-xs text-muted-foreground">
              The indexed text this project&apos;s chats retrieve and cite.
            </p>
          </SheetHeader>
          <SheetBody className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {preview?.error ? (
              <p className="text-sm text-amber-600">{preview.error}</p>
            ) : preview && preview.chunks.length === 0 ? (
              // Indexed but empty is a real state and must not look like a failed load.
              <p className="text-sm text-muted-foreground">
                This document is registered but has no indexed text yet.
              </p>
            ) : (
              preview?.chunks.map((c) => (
                <pre
                  key={c.position}
                  className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed"
                >
                  {c.content}
                </pre>
              ))
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
