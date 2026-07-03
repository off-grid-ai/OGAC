'use client';

import {
  ArrowsClockwise,
  Warning,
  CaretLeft,
  CaretRight,
  Check,
  Copy,
  FileText,
  FolderSimplePlus,
  GearSix,
  Brain,
  Ghost,
  Globe,
  ImageSquare,
  Lightning,
  Paperclip,
  MagnifyingGlass,
  Microphone,
  PaperPlaneRight,
  PencilSimple,
  Plus,
  Quotes,
  SlidersHorizontal,
  Sparkle,
  SpeakerHigh,
  Stop,
  Trash,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type Artifact, artifactTitle, parseArtifact } from '@/lib/artifacts';
import { cn } from '@/lib/utils';
import { ArtifactView } from './ArtifactView';
import { Markdown } from './Markdown';
import { MemoryDialog } from './MemoryDialog';
import { type Project, ProjectDialog } from './ProjectDialog';
import { SettingsDialog } from './SettingsDialog';
import { SkillsDialog } from './SkillsDialog';

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
  // Edit & branch: position among sibling versions of this turn (‹ 2/3 ›).
  branchIndex?: number;
  branchCount?: number;
  // Inline generation error (gateway offline, timeout, etc.) with a Retry affordance.
  error?: string;
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

// Branch navigation ‹ 2/3 › shown on turns that have sibling versions (edited/regenerated).
function BranchNav({
  m,
  onNav,
}: {
  m: Message;
  onNav: (delta: number) => void;
}) {
  if (!m.branchCount || m.branchCount < 2) return null;
  return (
    <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
      <button onClick={() => onNav(-1)} className="rounded p-0.5 hover:bg-muted hover:text-foreground">
        <CaretLeft className="size-3" />
      </button>
      <span className="tabular-nums">
        {(m.branchIndex ?? 0) + 1}/{m.branchCount}
      </span>
      <button onClick={() => onNav(1)} className="rounded p-0.5 hover:bg-muted hover:text-foreground">
        <CaretRight className="size-3" />
      </button>
    </div>
  );
}

// eslint-disable-next-line complexity
function MessageBubble({
  message: m,
  onOpenArtifact,
  onCopy,
  onRegenerate,
  onSpeak,
  onEdit,
  onNavBranch,
  onViewImage,
  canRegenerate,
  canEdit,
}: {
  message: Message;
  onOpenArtifact: (a: Artifact) => void;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
  onSpeak: (text: string) => void;
  onEdit: (id: string, content: string) => void;
  onNavBranch: (id: string, delta: number) => void;
  onViewImage: (src: string) => void;
  canRegenerate: boolean;
  canEdit: boolean;
}) {
  const isAssistant = m.role === 'assistant';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  if (!isAssistant && editing) {
    return (
      <div className="flex justify-end">
        <div className="w-[90%] rounded-lg border border-primary/40 bg-primary/5 p-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(8, draft.split('\n').length + 1)}
            className="w-full resize-none bg-transparent text-sm outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft(m.content); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const t = draft.trim();
                setEditing(false);
                if (t && m.id) onEdit(m.id, t);
              }}
            >
              <Check className="mr-1 size-3.5" /> Send
            </Button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={cn('group flex', m.role === 'user' && 'flex-col items-end')}>
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
              <img
                key={k}
                src={src}
                alt=""
                onClick={() => onViewImage(src)}
                className="max-h-40 cursor-zoom-in rounded border border-border transition-opacity hover:opacity-90"
              />
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
                <button
                  onClick={() => onSpeak(m.content)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Play"
                >
                  <SpeakerHigh className="size-3.5" />
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
        {/* Inline generation error + retry (keeps any partial output above). */}
        {isAssistant && m.error ? (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
            <span className="flex items-center gap-1.5"><Warning className="size-3.5 shrink-0" />{m.error}</span>
            <button onClick={onRegenerate} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-destructive/10">
              <ArrowsClockwise className="size-3" /> Retry
            </button>
          </div>
        ) : null}
      </div>
      {/* Branch navigation ‹ 2/3 › on turns with sibling versions. */}
      {m.id ? <BranchNav m={m} onNav={(d) => onNavBranch(m.id!, d)} /> : null}
      {/* Edit affordance on user turns (creates a new branch). */}
      {!isAssistant && canEdit && m.id ? (
        <button
          onClick={() => { setDraft(m.content); setEditing(true); }}
          className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          title="Edit message"
        >
          <PencilSimple className="size-3" /> Edit
        </button>
      ) : null}
    </div>
  );
}

// eslint-disable-next-line complexity
export function ChatWorkspace({
  role = 'viewer',
  userEmail = '',
}: {
  role?: string;
  userEmail?: string;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [skillsOpen, setSkillsOpen] = useState(false);
  // Conversation starters surfaced when a fresh chat is opened under an assistant/skill.
  const [activeStarters, setActiveStarters] = useState<string[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<
    { fn: string; toolName: string; input: string; token?: string }[]
  >([]);
  const [lastSendBody, setLastSendBody] = useState<Record<string, unknown> | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Incognito / temporary chat: transcript lives only in the client, no DB row, excluded from the
  // sidebar, never added to memory. Toggling it starts a fresh ephemeral thread.
  const [temporary, setTemporary] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  useEffect(() => {
    if (!lightbox) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [lightbox]);
  // Ad-hoc file attachments (txt/md/csv/pdf) extracted server-side; injected as context for the
  // next turn only. Chips show in the composer.
  const [files, setFiles] = useState<{ name: string; text: string; chars: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  // Tools menu toggles (per-session): extended thinking + org-knowledge ("search your org") search.
  const [thinking, setThinking] = useState(false);
  const [orgKnowledge, setOrgKnowledge] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  // Slash styles: RBAC-permitted skills invocable inline via /name. `turnSkill` applies for the
  // next turn only (its system prompt), shown as a chip in the composer.
  const [skillList, setSkillList] = useState<{ id: string; name: string; description: string }[]>([]);
  const [turnSkill, setTurnSkill] = useState<{ id: string; name: string } | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState('');
  const [gatewayError, setGatewayError] = useState<{ url: string } | null>(null);
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
  const docRef = useRef<HTMLInputElement>(null);

  const activeModel = models.find((m) => m.id === model);
  // A leading /token (no space yet, no skill already picked) opens the slash-styles picker.
  const slashMatch = !turnSkill ? /^\/([\w-]*)$/.exec(input) : null;
  const slashQuery = slashMatch?.[1]?.toLowerCase() ?? '';
  const slashMatches = slashMatch
    ? skillList
        .filter((s) => s.name.toLowerCase().replace(/\s+/g, '-').includes(slashQuery))
        .slice(0, 6)
    : [];
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
        const body = await r.json() as { models?: ModelInfo[]; error?: string; gatewayUrl?: string };
        const list: ModelInfo[] = body.models ?? [];
        setModels(list);
        if (list[0]) setModel(list[0].id);
        if (body.error === 'gateway_unreachable' && body.gatewayUrl) {
          setGatewayError({ url: body.gatewayUrl });
        }
      }
    })();
    // Slash-styles autocomplete source — RBAC-scoped by the skills API.
    void (async () => {
      const r = await fetch('/api/v1/chat/skills');
      if (r.ok) setSkillList((await r.json()).skills ?? []);
    })();
  }, [refreshConversations, refreshProjects]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    setSlashOpen(slashMatches.length > 0);
    setSlashIndex(0);
  }, [slashMatches.length, input]);

  // Pick a slash-style skill: tag the turn with it and clear the /query from the composer.
  function pickSkill(s: { id: string; name: string }) {
    setTurnSkill({ id: s.id, name: s.name });
    setInput('');
    setSlashOpen(false);
  }

  // Composer keydown: drive the slash picker (arrows/enter/tab/escape) when open, else send.
  // eslint-disable-next-line complexity
  function onComposerKey(e: React.KeyboardEvent) {
    if (slashOpen && slashMatches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        return setSlashIndex((i) => (i + 1) % slashMatches.length);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        return setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        return pickSkill(slashMatches[slashIndex]);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        return setSlashOpen(false);
      }
    }
    // Esc stops an in-flight generation (when the slash picker isn't open).
    if (e.key === 'Escape' && streaming) {
      e.preventDefault();
      return stop();
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  // Save-on-open: opening an artifact both shows it in the side panel and persists it to the
  // library (versioned server-side by conversation + title). Fire-and-forget; the panel opens
  // regardless of whether the save succeeds.
  const openArtifact = useCallback(
    (a: Artifact) => {
      setArtifact(a);
      void fetch('/api/v1/chat/artifacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: a.kind,
          code: a.code,
          language: a.language ?? null,
          title: artifactTitle(a),
          conversationId: activeId ?? null,
        }),
      }).catch(() => {});
    },
    [activeId],
  );

  // Enter/leave incognito. Entering clears the thread into an ephemeral session; leaving drops it.
  function toggleTemporary() {
    setTemporary((prev) => {
      const next = !prev;
      setActiveId(null);
      setMessages([]);
      setActiveStarters([]);
      setArtifact(null);
      return next;
    });
  }

  async function openConversation(id: string) {
    setTemporary(false);
    setActiveId(id);
    setArtifact(null);
    setActiveStarters([]);
    const r = await fetch(`/api/v1/chat/conversations/${id}`);
    if (r.ok) setMessages((await r.json()).messages ?? []);
  }

  async function newChat() {
    setTemporary(false);
    setActiveStarters([]);
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

  async function startSkillChat(skillId: string, starters: string[] = []) {
    const r = await fetch('/api/v1/chat/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillId }),
    });
    if (!r.ok) return;
    const { id } = await r.json();
    setActiveProjectId(null);
    setMessages([]);
    setActiveId(id);
    setActiveStarters(starters);
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

  // Route dropped/pasted files: images → inline attachments, everything else → text extraction.
  function ingestFiles(list: FileList | File[]) {
    const toFileList = (fs: File[]) => { const dt = new DataTransfer(); fs.forEach((f) => dt.items.add(f)); return dt.files; };
    const arr = Array.from(list);
    const imgs = arr.filter((f) => f.type.startsWith('image/'));
    const rest = arr.filter((f) => !f.type.startsWith('image/'));
    if (imgs.length) void attachImage(toFileList(imgs));
    if (rest.length) void attachFiles(toFileList(rest));
  }

  // Attach text/markdown/csv/pdf: extract text server-side, keep it client-side as a chip until the
  // next send injects it as context.
  async function attachFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(fileList)) {
        const fd = new FormData();
        fd.append('file', f);
        const r = await fetch('/api/v1/chat/attach', { method: 'POST', body: fd });
        if (!r.ok) {
          toast.error((await r.json().catch(() => ({})))?.error ?? `Could not read ${f.name}`);
          continue;
        }
        const { name, text, chars } = await r.json();
        setFiles((prev) => [...prev, { name, text, chars }]);
      }
    } finally {
      setUploading(false);
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

  // Voice input — record a clip, POST to the gateway transcription endpoint, drop text in composer.
  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const fd = new FormData();
        fd.append('file', blob, 'audio.webm');
        const r = await fetch('/api/v1/chat/transcribe', { method: 'POST', body: fd });
        if (!r.ok) return toast.error('Transcription unavailable');
        const { text } = await r.json();
        if (text) setInput((prev) => (prev ? `${prev} ${text}` : text));
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      toast.error('Microphone unavailable');
    }
  }

  // TTS — play an answer through the gateway speech endpoint.
  async function speak(text: string) {
    try {
      const r = await fetch('/api/v1/chat/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: text }),
      });
      if (!r.ok) return toast.error('Speech unavailable');
      const url = URL.createObjectURL(await r.blob());
      void new Audio(url).play();
    } catch {
      toast.error('Speech failed');
    }
  }

  // Shared SSE loop — updates the trailing assistant placeholder. Caller adds the placeholder.
  // eslint-disable-next-line complexity
  async function streamAssistant(rawBody: Record<string, unknown>) {
    // Fold in the Tools-menu session toggles (thinking / org-knowledge search) unless the caller
    // already set them (e.g. approval replays reuse lastSendBody verbatim).
    const body: Record<string, unknown> = {
      thinking,
      orgKnowledge,
      ...rawBody,
    };
    setStreaming(true);
    setLastSendBody(body);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await fetch('/api/v1/chat/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!r.ok || !r.body) {
        const detail = await r.json().catch(() => null) as { error?: string } | null;
        const reason = detail?.error
          ?? (r.status === 401 || r.status === 403 ? 'Not authorized for this model.'
            : r.status === 429 ? 'Rate limited — try again shortly.'
            : r.status >= 500 ? `Gateway error (${r.status}).`
            : `Request failed (${r.status}).`);
        throw new Error(reason);
      }
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
          if (evt.error) {
            // Surface inline on the assistant bubble (keeps partial output) instead of a toast.
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === 'assistant') last.error = String(evt.error);
              return next;
            });
          }
          if (evt.approvalRequest) {
            setPendingApprovals(evt.approvalRequest);
            // drop the empty assistant placeholder while awaiting approval
            setMessages((prev) => {
              const next = [...prev];
              if (next[next.length - 1]?.role === 'assistant' && !next[next.length - 1].content) {
                next.pop();
              }
              return next;
            });
            continue;
          }
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
      if ((e as Error).name !== 'AbortError') {
        const reason = (e as Error).message || 'Chat failed — is the gateway up?';
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant') { last.error = reason; }
          else next.push({ role: 'assistant', content: '', error: reason });
          return next;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      void refreshConversations();
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    const sentFiles = files.map((f) => ({ name: f.name, text: f.text }));
    const sentSkill = turnSkill?.id ?? null;
    // Incognito: no DB row; the server gets the client-held transcript + a temporary flag.
    if (temporary) {
      const sentImages = images;
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      setInput('');
      setImages([]);
      setFiles([]);
      setTurnSkill(null);
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text, images: sentImages.length ? sentImages : null },
        { role: 'assistant', content: '', reasoning: '' },
      ]);
      await streamAssistant({
        temporary: true,
        history,
        content: text,
        model,
        images: sentImages,
        attachments: sentFiles,
        skillId: sentSkill,
      });
      return;
    }
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
    setFiles([]);
    setTurnSkill(null);
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text, images: sentImages.length ? sentImages : null },
      { role: 'assistant', content: '', reasoning: '' },
    ]);
    await streamAssistant({
      conversationId: convId,
      content: text,
      model,
      images: sentImages,
      attachments: sentFiles,
      skillId: sentSkill,
    });
  }

  // Send a conversation starter immediately (clears the starter chips).
  async function sendStarter(text: string) {
    if (streaming || !text.trim() || !activeId) return;
    setActiveStarters([]);
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', reasoning: '' },
    ]);
    await streamAssistant({ conversationId: activeId, content: text, model, images: [] });
  }

  async function resolveApprovals(approve: boolean) {
    const pend = pendingApprovals;
    setPendingApprovals([]);
    if (!approve || !lastSendBody) {
      if (!approve) toast.info('Tool calls denied');
      return;
    }
    setMessages((prev) => [...prev, { role: 'assistant', content: '', reasoning: '' }]);
    // Echo back the server-minted signed token for each call — the server re-verifies the HMAC
    // against the exact tool call before executing, so a bare function name is not enough.
    await streamAssistant({
      ...lastSendBody,
      approvals: pend.map((p) => ({ fn: p.fn, token: p.token })),
      regenerate: true,
    });
  }

  // Edit a prior user message → server forks a new branch and re-answers from it. Persisted chats
  // only (temporary chats have no message ids). We reload the active-path transcript, then stream.
  async function editMessage(id: string, newContent: string) {
    if (streaming || !activeId || temporary) return;
    setActiveStarters([]);
    setMessages((prev) => {
      const i = prev.findIndex((m) => m.id === id);
      const trimmed = i >= 0 ? prev.slice(0, i) : prev;
      return [
        ...trimmed,
        { role: 'user', content: newContent },
        { role: 'assistant', content: '', reasoning: '' },
      ];
    });
    await streamAssistant({
      conversationId: activeId,
      editMessageId: id,
      content: newContent,
      model,
    });
    await reloadActive(activeId);
  }

  // Reload the persisted active-path transcript (ids + branch metadata) after a branching edit or
  // regenerate so ‹ n/m › controls appear immediately.
  async function reloadActive(id: string) {
    const r = await fetch(`/api/v1/chat/conversations/${id}`);
    if (r.ok) setMessages((await r.json()).messages ?? []);
  }

  // Switch among sibling versions of an edited/regenerated turn; reload the resulting active path.
  async function navBranch(id: string, delta: number) {
    if (streaming || !activeId) return;
    const r = await fetch(`/api/v1/chat/conversations/${activeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branchMessageId: id, branchDelta: delta }),
    });
    if (r.ok) setMessages((await r.json()).messages ?? []);
  }

  async function regenerate() {
    if (streaming || (!activeId && !temporary)) return;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setMessages((prev) => {
      const next = [...prev];
      if (next[next.length - 1]?.role === 'assistant') next.pop();
      next.push({ role: 'assistant', content: '', reasoning: '' });
      return next;
    });
    if (temporary) {
      const history = messages.filter((m) => m !== messages[messages.length - 1]);
      await streamAssistant({
        temporary: true,
        history: history.map((m) => ({ role: m.role, content: m.content })),
        content: lastUser.content,
        model,
        regenerate: true,
      });
      return;
    }
    await streamAssistant({
      conversationId: activeId,
      content: lastUser.content,
      model,
      regenerate: true,
    });
    if (activeId) await reloadActive(activeId);
  }

  return (
    <div className="-m-6 flex h-full">
      {/* Rail: projects + conversations */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
        <div className="space-y-2 p-2">
          <Button onClick={newChat} className="w-full justify-start gap-2" size="sm">
            <Plus className="size-4" /> New chat
          </Button>
          <Button
            onClick={() => setSkillsOpen(true)}
            variant="outline"
            className="w-full justify-start gap-2"
            size="sm"
          >
            <Sparkle className="size-4" /> Skills
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
            {temporary ? <Ghost className="size-4 text-primary" /> : <Sparkle className="size-4 text-primary" />}
            {temporary ? 'Temporary chat' : activeProject ? activeProject.name : 'Chat'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTemporary}
              className={cn(
                'hover:text-foreground',
                temporary ? 'text-primary' : 'text-muted-foreground',
              )}
              title={temporary ? 'Exit temporary chat' : 'Temporary chat (not saved)'}
            >
              <Ghost className="size-4" />
            </button>
            <button
              onClick={() => setMemoryOpen(true)}
              className="text-muted-foreground hover:text-foreground"
              title="Memory"
            >
              <Brain className="size-4" />
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-muted-foreground hover:text-foreground"
              title="Custom instructions"
            >
              <SlidersHorizontal className="size-4" />
            </button>
            {gatewayError ? (
              <a
                href="/gateway"
                title={`AI Gateway unreachable at ${gatewayError.url} — set OFFGRID_GATEWAY_URL`}
                className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 font-mono text-xs text-destructive hover:bg-destructive/10"
              >
                <span>⚠ gateway offline</span>
              </a>
            ) : (
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
            )}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
            {messages.length === 0 ? (
              <div className="pt-24 text-center text-sm text-muted-foreground">
                <p className="text-base text-foreground">
                  {temporary ? 'Temporary chat' : activeProject ? activeProject.name : 'Your own private AI'}
                </p>
                <p className="mt-1">
                  {temporary
                    ? 'This chat won’t be saved, won’t appear in your history, and won’t update memory.'
                    : activeProject
                      ? 'Chats here use this project’s instructions and knowledge.'
                      : 'Answered on-prem by the Off Grid gateways. Ask anything.'}
                </p>
                {activeStarters.length ? (
                  <div className="mx-auto mt-6 grid max-w-lg gap-2 sm:grid-cols-2">
                    {activeStarters.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => sendStarter(s)}
                        className="rounded-lg border border-border p-3 text-left text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-muted"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id ?? i}
                message={m}
                onOpenArtifact={openArtifact}
                onCopy={copy}
                onRegenerate={regenerate}
                onSpeak={speak}
                onEdit={editMessage}
                onNavBranch={navBranch}
                onViewImage={setLightbox}
                canRegenerate={!streaming && i === messages.length - 1}
                canEdit={!streaming && !temporary}
              />
            ))}
          </div>
        </div>

        {/* Tool approval gate */}
        {pendingApprovals.length ? (
          <div className="shrink-0 border-t border-border bg-amber-500/10 px-4 py-3">
            <div className="mx-auto max-w-3xl space-y-2">
              <p className="text-xs font-medium text-foreground">
                The assistant wants to run {pendingApprovals.length} tool
                {pendingApprovals.length > 1 ? 's' : ''} that may change data. Approve?
              </p>
              {pendingApprovals.map((p, k) => (
                <div key={k} className="rounded border border-border bg-card p-2 text-xs">
                  <div className="font-medium">{p.toolName}</div>
                  <div className="truncate text-muted-foreground">{p.input}</div>
                </div>
              ))}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => resolveApprovals(true)}>
                  Approve &amp; run
                </Button>
                <Button size="sm" variant="outline" onClick={() => resolveApprovals(false)}>
                  Deny
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Composer */}
        <div
          className={`relative shrink-0 border-t border-border p-3 ${dragging ? 'bg-primary/5' : ''}`}
          onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) ingestFiles(e.dataTransfer.files); }}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter((f): f is File => !!f);
            if (imgs.length) { e.preventDefault(); ingestFiles(imgs); }
          }}
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80 text-sm font-medium text-primary">
              Drop images or files to attach
            </div>
          )}
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
            {files.length ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {files.map((f, k) => (
                  <div
                    key={k}
                    className="flex items-center gap-1.5 rounded border border-border bg-muted px-2 py-1 text-xs"
                  >
                    <FileText className="size-3.5 text-muted-foreground" />
                    <span className="max-w-[160px] truncate">{f.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {(f.chars / 1000).toFixed(1)}k
                    </span>
                    <button
                      onClick={() => setFiles((p) => p.filter((_, j) => j !== k))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {turnSkill ? (
              <div className="mb-2 flex items-center gap-1.5">
                <span className="flex items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-primary">
                  <Sparkle className="size-3.5" />
                  {turnSkill.name}
                  <button onClick={() => setTurnSkill(null)} className="hover:text-destructive">
                    <X className="size-3" />
                  </button>
                </span>
                <span className="text-[10px] text-muted-foreground">applied to your next message</span>
              </div>
            ) : null}
            {/* Slash-styles autocomplete — pick a skill to apply for the next turn. */}
            {slashOpen ? (
              <div className="mb-2 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                {slashMatches.map((s, i) => (
                  <button
                    key={s.id}
                    onMouseEnter={() => setSlashIndex(i)}
                    onClick={() => pickSkill(s)}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left',
                      i === slashIndex ? 'bg-primary/10' : 'hover:bg-muted',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm text-foreground">
                      <Sparkle className="size-3.5 text-primary" />/{s.name.replace(/\s+/g, '-')}
                    </span>
                    {s.description ? (
                      <span className="line-clamp-1 text-xs text-muted-foreground">{s.description}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              ref={docRef}
              type="file"
              accept=".txt,.md,.markdown,.csv,.tsv,.log,.json,.pdf,text/plain,text/markdown,text/csv,application/pdf"
              multiple
              hidden
              onChange={(e) => {
                void attachFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => attachImage(e.target.files)}
            />
            <div className="flex items-end gap-2 rounded-lg border border-border bg-card p-2">
              {/* Consolidated composer actions — "+" Tools menu (ChatGPT-style). */}
              <DropdownMenu open={toolsOpen} onOpenChange={setToolsOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      'p-1.5 hover:text-foreground',
                      thinking || orgKnowledge ? 'text-primary' : 'text-muted-foreground',
                    )}
                    title="Tools"
                  >
                    <Plus className="size-5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem
                    onSelect={() => docRef.current?.click()}
                    disabled={uploading}
                  >
                    <Paperclip className="mr-2 size-4" /> Attach file
                  </DropdownMenuItem>
                  {activeModel?.vision ? (
                    <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                      <ImageSquare className="mr-2 size-4" /> Attach image
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={orgKnowledge}
                    onCheckedChange={(v) => setOrgKnowledge(Boolean(v))}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <Globe className="mr-2 size-4" /> Search org knowledge
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={thinking}
                    onCheckedChange={(v) => setThinking(Boolean(v))}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <Lightning className="mr-2 size-4" /> Extended thinking
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setSkillsOpen(true)}>
                    <Sparkle className="mr-2 size-4" /> Skills &amp; styles…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                onClick={toggleRecording}
                className={cn(
                  'p-1.5 hover:text-foreground',
                  recording ? 'animate-pulse text-destructive' : 'text-muted-foreground',
                )}
                title={recording ? 'Stop recording' : 'Dictate'}
              >
                <Microphone className="size-5" />
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onComposerKey}
                rows={1}
                placeholder="Message the model…  (type / for skills)"
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
      <MemoryDialog open={memoryOpen} onOpenChange={setMemoryOpen} />
      <SkillsDialog
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
        role={role}
        userEmail={userEmail}
        projects={projects}
        models={models}
        onPick={startSkillChat}
      />

      {/* Image lightbox — click a message image to view it full-size */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setLightbox(null)}
          >
            <X className="size-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
