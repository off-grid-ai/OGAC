'use client';

import {
  ImageSquare,
  PaperPlaneRight,
  Plus,
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

interface Conversation {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
}
interface Message {
  id?: string;
  role: string;
  content: string;
  reasoning?: string | null;
  images?: string[] | null;
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

function MessageBubble({
  message: m,
  onOpenArtifact,
}: {
  message: Message;
  onOpenArtifact: (a: Artifact) => void;
}) {
  return (
    <div className={cn('flex', m.role === 'user' && 'justify-end')}>
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
        {m.role === 'assistant' ? (
          m.content ? (
            <>
              <Markdown>{m.content}</Markdown>
              <ArtifactChip content={m.content} onOpen={onOpenArtifact} />
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeModel = models.find((m) => m.id === model);

  const refreshConversations = useCallback(async () => {
    const r = await fetch('/api/v1/chat/conversations');
    if (r.ok) setConversations((await r.json()).conversations ?? []);
  }, []);

  useEffect(() => {
    void refreshConversations();
    void (async () => {
      const r = await fetch('/api/v1/chat/models');
      if (r.ok) {
        const list: ModelInfo[] = (await r.json()).models ?? [];
        setModels(list);
        if (list[0]) setModel(list[0].id);
      }
    })();
  }, [refreshConversations]);

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
    const r = await fetch('/api/v1/chat/conversations', { method: 'POST' });
    if (!r.ok) return;
    const { id } = await r.json();
    setMessages([]);
    setActiveId(id);
    await refreshConversations();
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

  // eslint-disable-next-line complexity
  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    let convId = activeId;
    if (!convId) {
      const r = await fetch('/api/v1/chat/conversations', { method: 'POST' });
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
    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await fetch('/api/v1/chat/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId: convId, content: text, model, images: sentImages }),
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

  return (
    <div className="-m-6 flex h-full">
      {/* Conversation rail */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
        <div className="p-2">
          <Button onClick={newChat} className="w-full justify-start gap-2" size="sm">
            <Plus className="size-4" /> New chat
          </Button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={cn(
                'group flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                activeId === c.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span className="flex-1 truncate">{c.title}</span>
              <Trash
                onClick={(e) => removeConversation(c.id, e)}
                className="size-3.5 shrink-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              />
            </button>
          ))}
          {conversations.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">No chats yet.</p>
          ) : null}
        </div>
      </aside>

      {/* Thread */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkle className="size-4 text-primary" /> Chat
          </div>
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

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
            {messages.length === 0 ? (
              <div className="pt-24 text-center text-sm text-muted-foreground">
                <p className="text-base text-foreground">Your own private AI</p>
                <p className="mt-1">Answered on-prem by the Off Grid gateways. Ask anything.</p>
              </div>
            ) : null}
            {messages.map((m, i) => (
              <MessageBubble key={m.id ?? i} message={m} onOpenArtifact={setArtifact} />
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
    </div>
  );
}
