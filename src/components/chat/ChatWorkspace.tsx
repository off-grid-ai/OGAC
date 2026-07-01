'use client';

import {
  ArrowsClockwise,
  Copy,
  FolderSimplePlus,
  GearSix,
  ImageSquare,
  MagnifyingGlass,
  PaperPlaneRight,
  Plus,
  Quotes,
  SlidersHorizontal,
  Sparkle,
  Stop,
  Trash,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { type Artifact, parseArtifact } from '@/lib/artifacts';
import { cn } from '@/lib/utils';
import { ArtifactView } from './ArtifactView';
import { Markdown } from './Markdown';
import { type Project, ProjectDialog } from './ProjectDialog';
import { SettingsDialog } from './SettingsDialog';

interface Conversation {
  id: string;
  title: string;
  model: string;
  projectId: string | null;
  updatedAt: string;
}
interface Citation {
  name: string;
  position: number;
  score: number;
}
interface Message {
  id?: string;
  role: string;
  content: string;
  reasoning?: string | null;
  images?: string[] | null;
  citations?: Citation[] | null;
}
interface ModelInfo {
  id: string;
  vision: boolean;
}

function ArtifactChip({ content, onOpen }: { content: string; onOpen: (a: Artifact) => void }) {
  const art = parseArtifact(content);
  if (!art) return null;
  return (
    <button
      onClick={() => onOpen(art)}
      className="mt-2 rounded border border-primary/40 px-2 py-1 text-xs text-primary hover:bg-primary/10"
    >
      Open artifact · {art.kind}
    </button>
  );
}

// eslint-disable-next-line complexity
function MessageBubble({
  message: m,
  onOpenArtifact,
  onCopy,
  onRegenerate,
  canRegenerate,
}: {
  message: Message;
  onOpenArtifact: (a: Artifact) => void;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
  canRegenerate: boolean;
}) {
  const isAssistant = m.role === 'assistant';
  return (
    <div className={cn('group flex', m.role === 'user' && 'justify-end')}>
      <div
        className={cn(
          'max-w-[90%] rounded-lg px-3.5 py-2.5',
          m.role === 'user' ? 'bg-primary/10 text-foreground' : 'border border-border bg-card',
        )}
      >
        {m.reasoning ? (
          <details className="mb-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Reasoning</summary>
            <div className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-2">{m.reasoning}</div>
          </details>
        ) : null}
        {m.images?.length ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {m.images.map((src, k) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={k} src={src} alt="" className="max-h-40 rounded border border-border" />
            ))}
          </div>
        ) : null}
        {isAssistant ? (
          m.content ? (
            <>
              <Markdown>{m.content}</Markdown>
              <ArtifactChip content={m.content} onOpen={onOpenArtifact} />
              {m.citations?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border pt-2">
                  {m.citations.map((c, k) => (
                    <span
                      key={k}
                      className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      title={`relevance ${(c.score * 100).toFixed(0)}%`}
                    >
                      <Quotes className="size-3" />
                      {c.name} · part {c.position + 1}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => onCopy(m.content)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Copy"
                >
                  <Copy className="size-3.5" />
                </button>
                {canRegenerate ? (
                  <button
                    onClick={onRegenerate}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Regenerate"
                  >
                    <ArrowsClockwise className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <span className="inline-block h-4 w-2 animate-pulse bg-primary" />
          )
        ) : (
          <p className="whitespace-pre-wrap text-sm">{m.content}</p>
        )}
      </div>
    </div>
  );
}

// eslint-disable-next-line complexity
export function ChatWorkspace() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [dialogProject, setDialogProject] = useState<Project | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeModel = models.find((m) => m.id === model);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const visibleConversations = conversations
    .filter((c) => (activeProjectId ? c.projectId === activeProjectId : !c.projectId))
    .filter((c) => c.title.toLowerCase().includes(search.toLowerCase()));

  const refreshConversations = useCallback(async () => {
    const r = await fetch('/api/v1/chat/conversations');
    if (r.ok) setConversations((await r.json()).conversations ?? []);
  }, []);
  const refreshProjects = useCallback(async () => {
    const r = await fetch('/api/v1/chat/projects');
    if (r.ok) setProjects((await r.json()).projects ?? []);
  }, []);

  useEffect(() => {
    void refreshConversations();
    void refreshProjects();
    void (async () => {
      const r = await fetch('/api/v1/chat/models');
      if (r.ok) {
        const list: ModelInfo[] = (await r.json()).models ?? [];
        setModels(list);
        if (list[0]) setModel(list[0].id);
      }
    })();
  }, [refreshConversations, refreshProjects]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function openConversation(id: string) {
    setActiveId(id);
    setArtifact(null);
    const r = await fetch(`/api/v1/chat/conversations/${id}`);
    if (r.ok) setMessages((await r.json()).messages ?? []);
  }

  async function newChat() {
    const r = await fetch('/api/v1/chat/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: activeProjectId }),
    });
    if (!r.ok) return;
    const { id } = await r.json();
    setMessages([]);
    setActiveId(id);
    await refreshConversations();
  }

  async function newProject() {
    const name = window.prompt('Project name');
    if (!name) return;
    const r = await fetch('/api/v1/chat/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) return;
    const { id } = await r.json();
    await refreshProjects();
    setActiveProjectId(id);
    setDialogProject({ id, name, systemPrompt: '' });
  }

  async function removeConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/v1/chat/conversations/${id}`, { method: 'DELETE' });
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    await refreshConversations();
  }

  async function commitRename(id: string) {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    await fetch(`/api/v1/chat/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    await refreshConversations();
  }

  async function attachImage(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      const dataUri = await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result as string);
        fr.readAsDataURL(f);
      });
      setImages((prev) => [...prev, dataUri]);
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    toast.success('Copied');
  }

  // Shared SSE loop — updates the trailing assistant placeholder. Caller adds the placeholder.
  // eslint-disable-next-line complexity
  async function streamAssistant(body: Record<string, unknown>) {
    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await fetch('/api/v1/chat/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!r.ok || !r.body) throw new Error('stream failed');
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 2);
          if (!chunk.startsWith('data:')) continue;
          const evt = JSON.parse(chunk.slice(5).trim());
          if (evt.error) toast.error(evt.error);
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') {
              if (evt.content) last.content += evt.content;
              if (evt.reasoning) last.reasoning = (last.reasoning ?? '') + evt.reasoning;
              if (evt.citations) last.citations = evt.citations;
            }
            return next;
          });
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('Chat failed — is the gateway up?');
    } finally {
      setStreaming(false);
      abortRef.current = null;
      void refreshConversations();
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    let convId = activeId;
    if (!convId) {
      const r = await fetch('/api/v1/chat/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: activeProjectId }),
      });
      if (!r.ok) return;
      convId = (await r.json()).id;
      setActiveId(convId);
    }
    const sentImages = images;
    setInput('');
    setImages([]);
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text, images: sentImages.length ? sentImages : null },
      { role: 'assistant', content: '', reasoning: '' },
    ]);
    await streamAssistant({ conversationId: convId, content: text, model, images: sentImages });
  }

  async function regenerate() {
    if (streaming || !activeId) return;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setMessages((prev) => {
      const next = [...prev];
      if (next[next.length - 1]?.role === 'assistant') next.pop();
      next.push({ role: 'assistant', content: '', reasoning: '' });
      return next;
    });
    await streamAssistant({
      conversationId: activeId,
      content: lastUser.content,
      model,
      regenerate: true,
    });
  }

  return (
    <div className="-m-6 flex h-full">
      {/* Rail: projects + conversations */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
        <div className="space-y-2 p-2">
          <Button onClick={newChat} className="w-full justify-start gap-2" size="sm">
            <Plus className="size-4" /> New chat
          </Button>
          <div className="flex items-center justify-between px-1 pt-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Projects
            </span>
            <FolderSimplePlus
              onClick={newProject}
              className="size-4 cursor-pointer text-muted-foreground hover:text-foreground"
            />
          </div>
          <div className="space-y-0.5">
            <button
              onClick={() => setActiveProjectId(null)}
              className={cn(
                'w-full rounded-md px-2.5 py-1.5 text-left text-sm',
                !activeProjectId ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              All chats
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveProjectId(p.id)}
                className={cn(
                  'group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
                  activeProjectId === p.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span className="flex-1 truncate">{p.name}</span>
                <GearSix
                  onClick={(e) => {
                    e.stopPropagation();
                    setDialogProject(p);
                  }}
                  className="size-3.5 shrink-0 opacity-0 hover:text-foreground group-hover:opacity-100"
                />
              </button>
            ))}
          </div>
          <div className="relative pt-1">
            <MagnifyingGlass className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs outline-none"
            />
          </div>
        </div>

        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {visibleConversations.map((c) => (
            <div
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={cn(
                'group flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                activeId === c.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {renamingId === c.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(c.id);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 rounded border border-border bg-background px-1 text-sm outline-none"
                />
              ) : (
                <span
                  className="flex-1 truncate"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenamingId(c.id);
                    setRenameValue(c.title);
                  }}
                >
                  {c.title}
                </span>
              )}
              <Trash
                onClick={(e) => removeConversation(c.id, e)}
                className="size-3.5 shrink-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              />
            </div>
          ))}
          {visibleConversations.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">No chats yet.</p>
          ) : null}
        </div>
      </aside>

      {/* Thread */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkle className="size-4 text-primary" />
            {activeProject ? activeProject.name : 'Chat'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-muted-foreground hover:text-foreground"
              title="Custom instructions"
            >
              <SlidersHorizontal className="size-4" />
            </button>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
            >
              {models.length === 0 ? <option value="">no models</option> : null}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                  {m.vision ? ' (vision)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
            {messages.length === 0 ? (
              <div className="pt-24 text-center text-sm text-muted-foreground">
                <p className="text-base text-foreground">
                  {activeProject ? activeProject.name : 'Your own private AI'}
                </p>
                <p className="mt-1">
                  {activeProject
                    ? 'Chats here use this project’s instructions and knowledge.'
                    : 'Answered on-prem by the Off Grid gateways. Ask anything.'}
                </p>
              </div>
            ) : null}
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id ?? i}
                message={m}
                onOpenArtifact={setArtifact}
                onCopy={copy}
                onRegenerate={regenerate}
                canRegenerate={!streaming && i === messages.length - 1}
              />
            ))}
          </div>
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-border p-3">
          <div className="mx-auto max-w-3xl">
            {images.length ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {images.map((src, k) => (
                  <div key={k} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="h-14 w-14 rounded border border-border object-cover" />
                    <button
                      onClick={() => setImages((p) => p.filter((_, j) => j !== k))}
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-background p-0.5 text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-2 rounded-lg border border-border bg-card p-2">
              {activeModel?.vision ? (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => attachImage(e.target.files)}
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="p-1.5 text-muted-foreground hover:text-foreground"
                    title="Attach image"
                  >
                    <ImageSquare className="size-5" />
                  </button>
                </>
              ) : null}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Message the model…"
                className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none"
              />
              {streaming ? (
                <Button size="icon" variant="outline" onClick={stop} title="Stop">
                  <Stop className="size-4" />
                </Button>
              ) : (
                <Button size="icon" onClick={send} disabled={!input.trim()} title="Send">
                  <PaperPlaneRight className="size-4" />
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
              Runs on your on-prem gateways · nothing leaves your network
            </p>
          </div>
        </div>
      </section>

      {artifact ? <ArtifactView artifact={artifact} onClose={() => setArtifact(null)} /> : null}
      <ProjectDialog
        project={dialogProject}
        open={!!dialogProject}
        onOpenChange={(o) => !o && setDialogProject(null)}
        onSaved={refreshProjects}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
