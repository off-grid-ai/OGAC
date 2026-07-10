'use client';

import {
  ArrowsClockwise,
  At,
  Books,
  Warning,
  CaretLeft,
  CaretRight,
  Check,
  ClockCounterClockwise,
  Copy,
  Cube,
  FileText,
  FolderOpen,
  FolderSimplePlus,
  GearSix,
  Brain,
  Ghost,
  Globe,
  ImageSquare,
  Lightning,
  List,
  Paperclip,
  MagnifyingGlass,
  Microphone,
  Pause,
  PaperPlaneRight,
  PencilSimple,
  Plus,
  Quotes,
  SlidersHorizontal,
  Sparkle,
  SpeakerHigh,
  Stop,
  TextAlignLeft,
  Trash,
  X,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  type ChatSelection,
  selectionEquals,
  selectionFromParams,
  selectionToPath,
} from '@/lib/chat-nav';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type Artifact, artifactTitle, parseArtifact } from '@/lib/artifacts';
import { buildSources } from '@/lib/chat-citations';
import {
  type MentionCandidate,
  type MentionRef,
  activeMention,
  buildRefsPayload,
  candidateToRef,
  matchMentions,
} from '@/lib/chat-mentions';
import { thinkingLabel, thinkingState } from '@/lib/chat-thinking';
import { toDisplayHost } from '@/lib/display-host';
import { resolveConsumerPipeline } from '@/lib/chat-pipeline-policy';
import { PipelineChip } from '@/components/pipelines/PipelineChip';
import { panelHref, withPanelParams } from '@/lib/url-panel';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/workspace-grid';
import { ArtifactView } from './ArtifactView';
import { Markdown } from './Markdown';
import { MemoryDialog } from './MemoryDialog';
import { type Project, ProjectDialog } from './ProjectDialog';
import { SettingsDialog } from './SettingsDialog';
import { SkillsDialog } from './SkillsDialog';
import { useChatAudio } from './useChatAudio';

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
  image?: boolean; // image-generation model (sd-server) — the composer generates instead of chats
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

// Inline extended-thinking block — reasoning tokens rendered ABOVE the answer, never mixed into the
// body. While the model is still thinking (no answer yet) it's expanded and streams live; once the
// answer starts it collapses to a one-line header the reader can re-open. Presentation state is the
// pure `thinkingState` decision (task rule: "collapsed by default once the answer starts"); the only
// local state is the reader's manual open/close override, seeded from that default.
function ThinkingBlock({ reasoning, content, streaming }: {
  reasoning: string;
  content: string;
  streaming: boolean;
}) {
  const state = thinkingState(reasoning, content, streaming);
  const [override, setOverride] = useState<boolean | null>(null);
  // Follow the phase-driven default until the reader intervenes; a manual toggle sticks.
  const open = override ?? state.defaultOpen;
  const scrollRef = useRef<HTMLDivElement>(null);
  // Keep the newest reasoning in view while it streams (transform/opacity-only motion elsewhere).
  useEffect(() => {
    if (open && state.phase === 'streaming') scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [reasoning, open, state.phase]);
  if (!state.hasReasoning) return null;
  return (
    <div className="mb-2 rounded-md border border-border/60 bg-muted/40">
      <button
        type="button"
        onClick={() => setOverride(!open)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <Brain className={cn('size-3.5 shrink-0 text-primary', state.phase === 'streaming' && 'animate-pulse')} />
        <span>{thinkingLabel(state.phase)}</span>
        <CaretRight className={cn('ml-auto size-3 shrink-0 transition-transform duration-200', open && 'rotate-90')} />
      </button>
      {open ? (
        <div
          ref={scrollRef}
          className="max-h-64 overflow-y-auto whitespace-pre-wrap border-t border-border/60 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground"
        >
          {reasoning}
        </div>
      ) : null}
    </div>
  );
}

// "Sources" footer — the numbered, de-duplicated citation list under a grounded answer. Each row is
// [n] doc · parts · relevance, keyed to the inline [n] chips. Clicking an inline chip scrolls to and
// briefly highlights the matching row (setActive). No citations → renders nothing (footer absent).
function SourcesFooter({ citations, activeIndex, registerRef }: {
  citations: Citation[];
  activeIndex: number | null;
  registerRef: (index: number, el: HTMLLIElement | null) => void;
}) {
  const sources = buildSources(citations);
  if (!sources.length) return null;
  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
        <Quotes className="size-3" /> Sources
      </div>
      <ol className="space-y-0.5">
        {sources.map((s) => (
          <li
            key={s.index}
            ref={(el) => registerRef(s.index, el)}
            className={cn(
              'flex items-baseline gap-1.5 rounded px-1 py-0.5 text-[11px] transition-colors duration-300',
              activeIndex === s.index ? 'bg-primary/10' : 'bg-transparent',
            )}
          >
            <span className="font-mono text-[10px] font-medium text-primary">[{s.index}]</span>
            <span className="min-w-0 flex-1 truncate text-foreground" title={s.name}>{s.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              part{s.parts.length > 1 ? 's' : ''} {s.parts.join(', ')} · {(s.score * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ol>
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
  speakActive,
  speakLabel,
  onEdit,
  onNavBranch,
  onViewImage,
  canRegenerate,
  canEdit,
  streaming,
}: {
  message: Message;
  onOpenArtifact: (a: Artifact) => void;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
  onSpeak: (id: string, text: string) => void;
  /** Whether THIS message is the one currently speaking (playing or paused). */
  speakActive: boolean;
  /** Tooltip for this message's play/pause button. */
  speakLabel: string;
  onEdit: (id: string, content: string) => void;
  onNavBranch: (id: string, delta: number) => void;
  onViewImage: (src: string) => void;
  canRegenerate: boolean;
  canEdit: boolean;
  streaming: boolean;
}) {
  const isAssistant = m.role === 'assistant';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  // Inline-citation ↔ Sources-footer wiring: clicking a [n] chip scrolls to source n and highlights
  // it briefly. Refs are registered by the footer; activeIndex drives the transient highlight.
  const sourceRefs = useRef(new Map<number, HTMLLIElement>());
  const [activeSource, setActiveSource] = useState<number | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceCount = buildSources(m.citations).length;
  const jumpToSource = useCallback((n: number) => {
    sourceRefs.current.get(n)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setActiveSource(n);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setActiveSource(null), 1600);
  }, []);
  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);
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
        {isAssistant ? (
          <ThinkingBlock reasoning={m.reasoning ?? ''} content={m.content} streaming={streaming} />
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
              <Markdown sourceCount={sourceCount} onCiteClick={jumpToSource}>{m.content}</Markdown>
              <ArtifactChip content={m.content} onOpen={onOpenArtifact} />
              {m.citations?.length ? (
                <SourcesFooter
                  citations={m.citations}
                  activeIndex={activeSource}
                  registerRef={(index, el) => {
                    if (el) sourceRefs.current.set(index, el);
                    else sourceRefs.current.delete(index);
                  }}
                />
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
                  onClick={() => m.id && onSpeak(m.id, m.content)}
                  className={cn(
                    'rounded p-1 hover:bg-muted hover:text-foreground',
                    speakActive ? 'text-primary' : 'text-muted-foreground',
                  )}
                  title={speakLabel}
                >
                  {speakActive ? (
                    <Pause className="size-3.5" />
                  ) : (
                    <SpeakerHigh className="size-3.5" />
                  )}
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
  const [projects, setProjects] = useState<Project[]>([]);
  // The org chat-binding governance (default chat pipeline + friendly names), read alongside projects
  // from GET /api/v1/chat/projects. Drives the "Runs on: <pipeline>" chip near the model picker so the
  // governing pipeline is legible in chat too (per-project override → org default, most-specific-wins).
  const [chatBinding, setChatBinding] = useState<{
    defaultChatPipelineId: string | null;
    pipelines: { id: string; name: string }[];
  }>({ defaultChatPipelineId: null, pipelines: [] });
  // NAVIGATIONAL position (which conversation, which project) lives in the URL — never useState —
  // so a conversation is shareable, refresh-safe, and Back steps between conversations/projects.
  // Route shape: /chat/<conversationId>?project=<projectId>; /chat = new-chat landing.
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useParams<{ conversationId?: string | string[] }>();
  const searchParams = useSearchParams();
  const selection = selectionFromParams({
    conversationId: routeParams?.conversationId,
    project: searchParams.get('project'),
  });
  const activeId = selection.conversationId;
  const activeProjectId = selection.projectId;
  // Push a new navigational position (a real history entry). No-op if we're already there, so we
  // don't stack duplicate entries when re-selecting the current place.
  const navigate = useCallback(
    (next: ChatSelection) => {
      if (selectionEquals(next, selection)) return;
      router.push(selectionToPath(next));
    },
    [router, selection],
  );
  // Settings / Memory are URL-driven side panels (?panel=settings|memory) — a real navigational
  // position, so Back closes the panel and the panel is deep-linkable, per the console's URL-nav
  // rule (never local useState for a "place").
  const activePanel = searchParams.get('panel');
  const settingsOpen = activePanel === 'settings';
  const memoryOpen = activePanel === 'memory';
  const setPanel = useCallback(
    (p: 'settings' | 'memory' | null) => {
      const query = withPanelParams(searchParams.toString(), { panel: p });
      router.push(panelHref(pathname, query));
    },
    [router, pathname, searchParams],
  );
  // Incognito / temporary chat: transcript lives only in the client, no DB row, excluded from the
  // sidebar, never added to memory. Toggling it starts a fresh ephemeral thread.
  const [temporary, setTemporary] = useState(false);
  // Mobile-only: the conversation/project rail is an off-canvas drawer (< md). Transient UI panel,
  // not a navigational "place" — the active conversation/project stays URL-driven — so local state
  // is correct here. Desktop (md+) always shows the rail inline and ignores this.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  // Audio mode (STT voice input + TTS read-aloud). All browser/network audio I/O + the pure state
  // machines live in useChatAudio; this component only renders from it at the mic + play buttons.
  const audio = useChatAudio({
    onTranscript: (merge) => setInput((prev) => merge(prev)),
    onError: (m) => toast.error(m),
  });
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
  // @-mentions: reference stored memories + knowledge (projects/KBs, specific docs) as grounding
  // context for THIS turn. `refs` are the chosen chips (removable); the picker opens on an `@token`
  // at the caret, filters `mentionCands`, and inserting adds a chip. Threaded into the request as
  // `refs` (memory ids + KB scopes) so the answer is grounded on them. Turn-scoped: cleared on send.
  const [refs, setRefs] = useState<MentionRef[]>([]);
  const [mentionCands, setMentionCands] = useState<MentionCandidate[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  // Caret position in the composer — the pure activeMention() detector needs it to find the token
  // under the cursor. Tracked from the textarea's selectionStart on every change/select/keyup.
  const caretRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState('');
  const [gatewayError, setGatewayError] = useState<{ url: string } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [dialogProject, setDialogProject] = useState<Project | null>(null);
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  // Which conversation the current `messages` array belongs to. Lets the URL-driven load effect
  // skip a refetch when we already hold the transcript — e.g. right after we create a conversation
  // client-side (send/newChat) and navigate to its URL, or when only the ?project= param changed.
  const loadedIdRef = useRef<string | null>(null);
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
  // The @token under the caret (null when not in a mention). Slash + @ are mutually exclusive: a
  // leading `/` is a skill, `@` anywhere is a mention. `mention` drives the picker's query.
  const mention = !slashMatch ? activeMention(input, caretRef.current) : null;
  const mentionMatches = mention
    ? matchMentions(mentionCands, mention.query, { exclude: refs, limit: 8 })
    : [];
  const activeProject = projects.find((p) => p.id === activeProjectId);
  // The pipeline governing THIS chat: the active project's override (if pinned), else the org default —
  // most-specific-wins, the SAME pure rule the run path uses. Named + linked via the chip by the model
  // picker so the governing pipeline is legible in chat. Temporary chats have no project ⇒ org default.
  const chatPipelineId = resolveConsumerPipeline(
    activeProject?.pipelineId ?? null,
    chatBinding.defaultChatPipelineId,
  );
  const chatPipelineChip = chatPipelineId
    ? {
        id: chatPipelineId,
        name:
          chatBinding.pipelines.find((p) => p.id === chatPipelineId)?.name ?? chatPipelineId,
        inherited: !activeProject?.pipelineId,
      }
    : { id: null };
  const visibleConversations = conversations
    .filter((c) => (activeProjectId ? c.projectId === activeProjectId : !c.projectId))
    .filter((c) => c.title.toLowerCase().includes(search.toLowerCase()));

  const refreshConversations = useCallback(async () => {
    const r = await fetch('/api/v1/chat/conversations');
    if (r.ok) setConversations((await r.json()).conversations ?? []);
  }, []);
  const refreshProjects = useCallback(async () => {
    const r = await fetch('/api/v1/chat/projects');
    if (r.ok) {
      const body = await r.json();
      setProjects(body.projects ?? []);
      if (body.chatBinding) {
        setChatBinding({
          defaultChatPipelineId: body.chatBinding.defaultChatPipelineId ?? null,
          pipelines: body.chatBinding.pipelines ?? [],
        });
      }
    }
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

  // URL-driven transcript load: the active conversation comes from the route, so whenever it
  // changes (link, refresh, Back/Forward, sidebar click) we load that conversation's messages —
  // unless we already hold them (loadedIdRef), e.g. right after creating it client-side. Temporary
  // (incognito) chats have no persisted transcript, so we never fetch while temporary.
  useEffect(() => {
    if (temporary) return;
    if (activeId === loadedIdRef.current) return;
    loadedIdRef.current = activeId;
    setArtifact(null);
    setActiveStarters([]);
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const r = await fetch(`/api/v1/chat/conversations/${activeId}`);
      if (!cancelled && r.ok) setMessages((await r.json()).messages ?? []);
    })();
    return () => { cancelled = true; };
  }, [activeId, temporary]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    setSlashOpen(slashMatches.length > 0);
    setSlashIndex(0);
  }, [slashMatches.length, input]);

  // Open the @-mention picker whenever the caret sits inside an @token that has matches; reset the
  // highlighted row. Keyed on input (typing) so it re-evaluates as the query changes.
  useEffect(() => {
    setMentionOpen(!!mention && mentionMatches.length > 0);
    setMentionIndex(0);
  }, [mention?.query, mention?.start, mentionMatches.length]);

  // Build the @-mention candidate list once: the user's memories + their projects (whole-KB refs) +
  // every document across those projects (specific-doc refs). Fetched lazily; degrades to whatever
  // resolves (a project with no docs just contributes a project ref).
  const loadMentionCandidates = useCallback(async () => {
    const out: MentionCandidate[] = [];
    try {
      const mr = await fetch('/api/v1/chat/memory');
      if (mr.ok) {
        const rows = (await mr.json()).memory ?? [];
        for (const m of rows as { id: string; fact: string }[]) {
          out.push({ kind: 'memory', id: m.id, label: m.fact });
        }
      }
    } catch { /* memory optional */ }
    const projs = projects.length
      ? projects
      : await fetch('/api/v1/chat/projects').then((r) => (r.ok ? r.json() : { projects: [] })).then((b) => b.projects ?? []).catch(() => []);
    for (const p of projs as Project[]) {
      out.push({ kind: 'project', id: p.id, label: p.name, hint: 'Knowledge base' });
      try {
        const dr = await fetch(`/api/v1/chat/projects/${p.id}/documents`);
        if (dr.ok) {
          const docs = (await dr.json()).documents ?? [];
          for (const d of docs as { id: string; name: string }[]) {
            out.push({ kind: 'doc', id: d.id, label: d.name, projectId: p.id, hint: p.name });
          }
        }
      } catch { /* project docs optional */ }
    }
    setMentionCands(out);
  }, [projects]);
  // Populate candidates once projects are known (and refresh when they change).
  useEffect(() => {
    void loadMentionCandidates();
  }, [loadMentionCandidates]);

  // Pick a slash-style skill: tag the turn with it and clear the /query from the composer.
  function pickSkill(s: { id: string; name: string }) {
    setTurnSkill({ id: s.id, name: s.name });
    setInput('');
    setSlashOpen(false);
  }

  // Pick a @-mention candidate: add it as a removable chip and strip the @token from the composer
  // (so the reference lives in `refs`, not as literal text). De-dupe by kind+id. The caret is left
  // where the token started so the reader keeps typing naturally.
  function pickMention(c: MentionCandidate) {
    if (!mention) return;
    const before = input.slice(0, mention.start);
    const after = input.slice(mention.end);
    // Collapse the token to nothing; keep a single trailing space if we're mid-sentence.
    const next = `${before}${after}`;
    setInput(next);
    setRefs((prev) =>
      prev.some((r) => r.kind === c.kind && r.id === c.id) ? prev : [...prev, candidateToRef(c)],
    );
    setMentionOpen(false);
    // Restore focus + caret to the strip point on the next tick.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        const pos = before.length;
        el.setSelectionRange(pos, pos);
        caretRef.current = pos;
      }
    });
  }

  // Composer keydown: drive the slash picker (arrows/enter/tab/escape) when open, else send.
  // eslint-disable-next-line complexity
  function onComposerKey(e: React.KeyboardEvent) {
    // @-mention picker takes the arrow/enter/tab/escape keys while open (same interaction as slash).
    if (mentionOpen && mentionMatches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        return setMentionIndex((i) => (i + 1) % mentionMatches.length);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        return setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        return pickMention(mentionMatches[mentionIndex]);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        return setMentionOpen(false);
      }
    }
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

  // Adopt a conversation we just created client-side (send/newChat/skill): we already hold its
  // transcript, so record it as loaded before navigating so the URL-driven load effect won't refetch.
  function adoptConversation(id: string, msgs: Message[]) {
    loadedIdRef.current = id;
    setMessages(msgs);
  }

  // Enter/leave incognito — a client-only ephemeral mode, not a navigational "place". Both directions
  // return to the /chat landing (no conversation) and clear the thread; the transient `temporary`
  // flag stays in useState (correct — it's UI mode, not position).
  function toggleTemporary() {
    setTemporary((prev) => !prev);
    setMessages([]);
    setActiveStarters([]);
    setArtifact(null);
    navigate({ conversationId: null, projectId: activeProjectId });
  }

  // Open an existing conversation = a real history entry. Reading its transcript is the URL-driven
  // effect's job; here we only move the navigational position (and leave incognito if we were in it).
  function openConversation(id: string) {
    setTemporary(false);
    setSidebarOpen(false);
    navigate({ conversationId: id, projectId: activeProjectId });
  }

  // Switch the project filter = a history entry; resets to the new-chat landing under that project
  // (null = "All chats"). The URL-driven effect clears the transcript since conversationId is null.
  function selectProject(projectId: string | null) {
    setTemporary(false);
    setSidebarOpen(false);
    navigate({ conversationId: null, projectId });
  }

  async function newChat() {
    setTemporary(false);
    setSidebarOpen(false);
    const r = await fetch('/api/v1/chat/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: activeProjectId }),
    });
    if (!r.ok) return;
    const { id } = await r.json();
    setActiveStarters([]);
    adoptConversation(id, []);
    navigate({ conversationId: id, projectId: activeProjectId });
    await refreshConversations();
  }

  async function startSkillChat(skillId: string, starters: string[] = []) {
    setTemporary(false);
    const r = await fetch('/api/v1/chat/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillId }),
    });
    if (!r.ok) return;
    const { id } = await r.json();
    adoptConversation(id, []);
    setActiveStarters(starters);
    // Skill chats aren't scoped to a project — drop any project filter.
    navigate({ conversationId: id, projectId: null });
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
    navigate({ conversationId: null, projectId: id });
    setDialogProject({ id, name, systemPrompt: '' });
  }

  async function removeConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/v1/chat/conversations/${id}`, { method: 'DELETE' });
    if (activeId === id) {
      // Falling back to the new-chat landing (keep the project filter) is itself a history entry.
      navigate({ conversationId: null, projectId: activeProjectId });
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

  // Voice input (STT) + read-aloud (TTS) are owned by the `audio` hook — see useChatAudio.

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

  // Image-generation turn: when an image model is selected, the composer generates instead of
  // chatting. The prompt is the user turn; the result renders inline as an assistant image (the
  // message model already carries `images`). The PNG is also saved to Storage (SeaweedFS).
  async function sendImage(text: string) {
    setInput('');
    setImages([]);
    setFiles([]);
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', reasoning: '' },
    ]);
    setStreaming(true);
    try {
      const r = await fetch('/api/v1/images/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });
      const data = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') {
          if (r.ok && data.url) {
            next[next.length - 1] = { ...last, content: '', images: [data.url] };
          } else {
            next[next.length - 1] = { ...last, content: '', error: data.error ?? 'Image generation failed' };
          }
        }
        return next;
      });
    } catch (e) {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') {
          next[next.length - 1] = { ...last, content: '', error: e instanceof Error ? e.message : 'failed' };
        }
        return next;
      });
    } finally {
      setStreaming(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    // Image model selected → generate an image instead of a chat completion.
    if (activeModel?.image) {
      await sendImage(text);
      return;
    }
    const sentFiles = files.map((f) => ({ name: f.name, text: f.text }));
    const sentSkill = turnSkill?.id ?? null;
    // @-mention grounding refs for this turn (memory ids + KB scopes); null when nothing referenced.
    const sentRefs = buildRefsPayload(refs);
    // Incognito: no DB row; the server gets the client-held transcript + a temporary flag.
    if (temporary) {
      const sentImages = images;
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      setInput('');
      setImages([]);
      setFiles([]);
      setTurnSkill(null);
      setRefs([]);
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
        refs: sentRefs,
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
      // Sending from the new-chat landing: adopt the fresh conversation (mark loaded so the
      // URL-driven effect won't clobber the optimistic turns below) then push its URL.
      loadedIdRef.current = convId;
      navigate({ conversationId: convId, projectId: activeProjectId });
    }
    const sentImages = images;
    setInput('');
    setImages([]);
    setFiles([]);
    setTurnSkill(null);
    setRefs([]);
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
      refs: sentRefs,
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
  // Edit a prior user turn and re-run from that point: PATCH truncates the thread after the edited
  // message (Phase 4.6), then reuse the existing regenerate path to re-answer from it.
  async function editMessage(id: string, newContent: string) {
    if (streaming || !activeId || temporary) return;
    setActiveStarters([]);
    const r = await fetch(`/api/v1/chat/conversations/${activeId}/messages/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: newContent }),
    });
    if (!r.ok) return;
    // Adopt the truncated transcript (edited turn is now the tail), then regenerate its answer.
    setMessages((await r.json()).messages ?? []);
    await regenerate();
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
    <div className="-m-6 flex h-[calc(100%+3rem)] min-h-0">
      {/* Mobile backdrop — closes the drawer on tap. Only rendered/interactive below md. */}
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close chats menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-background/60 backdrop-blur-sm md:hidden"
        />
      ) : null}

      {/* Rail: projects + conversations. Inline column on md+; off-canvas drawer below md. */}
      <aside
        className={cn(
          'flex h-full w-64 shrink-0 flex-col border-r border-border bg-card',
          // Mobile: fixed off-canvas drawer, slid in/out by sidebarOpen.
          'fixed inset-y-0 left-0 z-40 transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 md:transition-none',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Top: primary action + search */}
        <div className="space-y-2 p-2.5">
          <Button
            onClick={newChat}
            className="w-full justify-start gap-2 transition-transform duration-150 active:scale-[0.98]"
            size="sm"
          >
            <Plus className="size-4" /> New chat
          </Button>
          <div className="relative">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none transition-colors duration-150 focus:border-primary/50"
            />
          </div>
        </div>

        {/* Projects */}
        <div className="px-2.5 pb-1">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
              Projects
            </span>
            <button
              onClick={newProject}
              aria-label="New project"
              className="text-muted-foreground transition-colors duration-150 hover:text-primary"
            >
              <FolderSimplePlus className="size-4" />
            </button>
          </div>
          <div className="space-y-0.5">
            <button
              onClick={() => selectProject(null)}
              className={cn(
                'w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-all duration-150 active:scale-[0.99]',
                !activeProjectId ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              All chats
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProject(p.id)}
                className={cn(
                  'group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-all duration-150 active:scale-[0.99]',
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
                  className="size-3.5 shrink-0 opacity-0 transition-opacity duration-150 hover:text-foreground group-hover:opacity-100"
                />
              </button>
            ))}
          </div>
        </div>

        {/* Chats */}
        <div className="flex items-center justify-between px-3.5 pb-1 pt-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
            Chats
          </span>
          <button
            onClick={() => setSkillsOpen(true)}
            className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground transition-colors duration-150 hover:text-primary"
          >
            <Sparkle className="size-3" /> Skills
          </button>
        </div>

        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {visibleConversations.map((c) => (
            <div
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={cn(
                'group flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-all duration-150 active:scale-[0.99]',
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
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            {/* Mobile-only: open the conversation/project drawer. ≥44px tap target. */}
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open chats menu"
              className="-ml-1.5 flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
            >
              <List className="size-5" />
            </button>
            {temporary ? <Ghost className="size-4 shrink-0 text-primary" /> : <Sparkle className="size-4 shrink-0 text-primary" />}
            <span className="truncate">{temporary ? 'Temporary chat' : activeProject ? activeProject.name : 'Chat'}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {/* Workspace library — Projects/Prompts/Artifacts are workspace sub-surfaces reached
                from here (Artifacts has no sidebar row, so this keeps it reachable from chat). */}
            <div className="mr-1 hidden items-center gap-0.5 border-r border-border pr-2 sm:flex">
              <Link
                href="/workspace/projects"
                title="Projects"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <FolderOpen className="size-4" />
              </Link>
              <Link
                href="/workspace/prompts"
                title="Prompts library"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <TextAlignLeft className="size-4" />
              </Link>
              <Link
                href="/workspace/artifacts"
                title="Artifacts"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Cube className="size-4" />
              </Link>
            </div>
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
              onClick={() => setPanel('memory')}
              className="text-muted-foreground hover:text-foreground"
              title="Memory"
            >
              <Brain className="size-4" />
            </button>
            <button
              onClick={() => setPanel('settings')}
              className="text-muted-foreground hover:text-foreground"
              title="Custom instructions"
            >
              <SlidersHorizontal className="size-4" />
            </button>
            {/* The pipeline governing this chat (project override → org default). Names + links it so
                the join-key is legible in chat, right by the model picker. */}
            <PipelineChip pipeline={chatPipelineChip} size="xs" />
            {gatewayError ? (
              <a
                href="/gateway/ai"
                title={`AI Gateway unreachable at ${toDisplayHost(gatewayError.url)} — set OFFGRID_GATEWAY_URL`}
                className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 font-mono text-xs text-destructive hover:bg-destructive/10"
              >
                <span>⚠ gateway offline</span>
              </a>
            ) : (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="max-w-[8rem] rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground sm:max-w-none"
              >
                {models.length === 0 ? <option value="">no models</option> : null}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                    {m.image ? ' (image)' : m.vision ? ' (vision)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className={cn('space-y-5 px-4 py-6', messages.length === 0 && !temporary && !activeStarters.length ? 'mx-auto max-w-5xl' : 'mx-auto max-w-3xl')}>
            {messages.length === 0 ? (
              <div className="pt-16 text-center text-sm text-muted-foreground">
                <p className="text-base text-foreground">
                  {temporary ? 'Temporary chat' : activeProject ? activeProject.name : 'Your own private AI'}
                </p>
                <p className="mt-1">
                  {temporary
                    ? 'This chat won’t be saved, won’t appear in your history, and won’t update memory.'
                    : activeProject
                      ? 'Chats here use this project’s instructions and knowledge.'
                      : 'Answered on-prem by the Off Grid AI gateways. Ask anything.'}
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
                {/* Recent-chats grid — the new-chat landing surfaces recent conversations as
                    scannable cards (grid, full width) instead of leaving the space empty. Not
                    shown for temporary chats or skill starters. */}
                {!temporary && !activeStarters.length && visibleConversations.length ? (
                  <div className="mt-10 text-left">
                    <div className="mb-3 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
                      <ClockCounterClockwise className="size-3.5" />
                      {activeProject ? `Recent in ${activeProject.name}` : 'Recent chats'}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {visibleConversations.slice(0, 9).map((c) => (
                        <button
                          key={c.id}
                          onClick={() => openConversation(c.id)}
                          className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-3.5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
                        >
                          <div className="flex items-start gap-2">
                            <Sparkle className="mt-0.5 size-3.5 shrink-0 text-primary" />
                            <span className="line-clamp-2 flex-1 text-sm font-medium text-foreground">
                              {c.title}
                            </span>
                          </div>
                          <div className="mt-auto flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                            <span className="truncate">{c.model}</span>
                            {c.updatedAt ? <span>· {relativeTime(c.updatedAt)}</span> : null}
                          </div>
                        </button>
                      ))}
                    </div>
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
                onSpeak={audio.speak}
                speakActive={!!m.id && audio.speakingId === m.id}
                speakLabel={audio.speakLabel(m.id ?? '')}
                onEdit={editMessage}
                onNavBranch={navBranch}
                onViewImage={setLightbox}
                canRegenerate={!streaming && i === messages.length - 1}
                canEdit={!streaming && !temporary}
                // Only the trailing assistant turn is actively generating — that's the one whose
                // thinking block streams live before collapsing.
                streaming={streaming && i === messages.length - 1}
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
            {/* @-mention reference chips — memories + KBs/docs pulled into this turn as context. */}
            {refs.length ? (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {refs.map((r) => (
                  <span
                    key={`${r.kind}:${r.id}`}
                    className="flex items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-primary"
                    title={r.label}
                  >
                    {r.kind === 'memory' ? (
                      <Brain className="size-3.5 shrink-0" />
                    ) : r.kind === 'doc' ? (
                      <FileText className="size-3.5 shrink-0" />
                    ) : (
                      <Books className="size-3.5 shrink-0" />
                    )}
                    <span className="max-w-[180px] truncate">{r.label}</span>
                    <button
                      onClick={() => setRefs((prev) => prev.filter((x) => !(x.kind === r.kind && x.id === r.id)))}
                      className="hover:text-destructive"
                      aria-label={`Remove reference ${r.label}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <span className="text-[10px] text-muted-foreground">referenced for your next message</span>
              </div>
            ) : null}
            {/* @-mention picker — two sections (Memories, Knowledge). Same interaction as slash. */}
            {mentionOpen ? (
              <div className="mb-2 max-h-72 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
                {(() => {
                  const memRows = mentionMatches.map((c, gi) => ({ c, gi })).filter(({ c }) => c.kind === 'memory');
                  const kbRows = mentionMatches.map((c, gi) => ({ c, gi })).filter(({ c }) => c.kind !== 'memory');
                  return [
                    { key: 'memory', heading: 'Memories', rows: memRows },
                    { key: 'knowledge', heading: 'Knowledge', rows: kbRows },
                  ];
                })().map((section) => {
                  const rows = section.rows;
                  if (!rows.length) return null;
                  return (
                    <div key={section.key}>
                      <div className="border-b border-border/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
                        {section.heading}
                      </div>
                      {rows.map(({ c, gi }) => (
                        <button
                          key={`${c.kind}:${c.id}`}
                          onMouseEnter={() => setMentionIndex(gi)}
                          onClick={() => pickMention(c)}
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-2 text-left',
                            gi === mentionIndex ? 'bg-primary/10' : 'hover:bg-muted',
                          )}
                        >
                          {c.kind === 'memory' ? (
                            <Brain className="size-3.5 shrink-0 text-primary" />
                          ) : c.kind === 'doc' ? (
                            <FileText className="size-3.5 shrink-0 text-primary" />
                          ) : (
                            <Books className="size-3.5 shrink-0 text-primary" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.label}</span>
                          {c.hint ? (
                            <span className="shrink-0 text-[10px] text-muted-foreground">{c.hint}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  );
                })}
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
                  <DropdownMenuItem
                    onSelect={() => {
                      // Insert an `@` and focus the composer so the mention picker opens.
                      const next = input && !/\s$/.test(input) ? `${input} @` : `${input}@`;
                      setInput(next);
                      requestAnimationFrame(() => {
                        const el = textareaRef.current;
                        if (el) {
                          el.focus();
                          el.setSelectionRange(next.length, next.length);
                          caretRef.current = next.length;
                        }
                      });
                    }}
                  >
                    <At className="mr-2 size-4" /> Reference memory or knowledge…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setSkillsOpen(true)}>
                    <Sparkle className="mr-2 size-4" /> Skills &amp; styles…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                onClick={audio.toggleRecording}
                disabled={!audio.sttAvailable || audio.recordPhase === 'transcribing'}
                className={cn(
                  'p-1.5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
                  audio.recording
                    ? 'animate-pulse text-destructive'
                    : audio.recordPhase === 'transcribing'
                      ? 'animate-pulse text-primary'
                      : 'text-muted-foreground',
                )}
                title={audio.micLabel}
              >
                <Microphone className="size-5" />
              </button>
              {(audio.sttModels.length > 0 || audio.ttsModels.length > 0) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="p-1.5 text-muted-foreground hover:text-foreground"
                      title="Voice settings — dictation & read-aloud engine"
                      aria-label="Voice settings"
                    >
                      <SpeakerHigh className="size-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    {audio.sttModels.length > 0 && (
                      <>
                        <DropdownMenuLabel>Dictation engine</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={audio.sttModel} onValueChange={audio.setSttModel}>
                          {audio.sttModels.map((m) => (
                            <DropdownMenuRadioItem key={m.id} value={m.id} className="flex-col items-start">
                              <span>{m.label}</span>
                              <span className="text-[10px] text-muted-foreground">{m.notes}</span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </>
                    )}
                    {audio.ttsModels.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Read-aloud voice</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={audio.ttsModel} onValueChange={audio.setTtsModel}>
                          {audio.ttsModels.map((m) => (
                            <DropdownMenuRadioItem key={m.id} value={m.id} className="flex-col items-start">
                              <span>{m.label}</span>
                              <span className="text-[10px] text-muted-foreground">{m.notes}</span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                        {audio.ttsVoices && audio.ttsVoices.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Voice</DropdownMenuLabel>
                            <DropdownMenuRadioGroup value={audio.ttsVoice} onValueChange={audio.setTtsVoice}>
                              {audio.ttsVoices.map((v) => (
                                <DropdownMenuRadioItem key={v.id} value={v.id}>
                                  {v.label}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </>
                        )}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  caretRef.current = e.target.selectionStart ?? e.target.value.length;
                  setInput(e.target.value);
                }}
                onKeyUp={(e) => { caretRef.current = e.currentTarget.selectionStart ?? 0; }}
                onClick={(e) => { caretRef.current = e.currentTarget.selectionStart ?? 0; }}
                onKeyDown={onComposerKey}
                rows={1}
                placeholder={
                  activeModel?.image
                    ? 'Describe an image to generate…'
                    : 'Message the model…  (/ for skills, @ to reference memory or knowledge)'
                }
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

      {artifact ? <ArtifactView artifact={artifact} onClose={() => setArtifact(null)} title={artifactTitle(artifact)} conversationId={activeId ?? null} onSaved={() => void refreshProjects()} /> : null}
      <ProjectDialog
        project={dialogProject}
        open={!!dialogProject}
        onOpenChange={(o) => !o && setDialogProject(null)}
        onSaved={refreshProjects}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={(o) => !o && setPanel(null)} />
      <MemoryDialog open={memoryOpen} onOpenChange={(o) => !o && setPanel(null)} />
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
