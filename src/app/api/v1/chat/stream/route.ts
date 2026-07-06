import { auth } from '@/auth';
import {
  addMessage,
  branchUserMessage,
  deriveTitle,
  getConversation,
  getCustomInstructions,
  getSkill,
  listMessages,
  memoryBlock,
  prepareRegenerate,
  projectMemoryBlock,
  projectSystemPrompt,
  renameConversation,
} from '@/lib/chat';
import { attachmentBlock } from '@/lib/chat-attach';
import {
  estimateTokens,
  isDenied,
  projectBudget,
  writeChatAudit,
} from '@/lib/chat-governance';
import { extractMemory } from '@/lib/chat-memory';
import { resolveTools } from '@/lib/chat-tools';
import { emitChatTrace } from '@/lib/chat-trace';
import { actorFrom } from '@/lib/audit-event';
import { costForTokens } from '@/lib/finops';
import { retrieve as retrieveOrgKnowledge } from '@/lib/org-knowledge';
import { type Citation, retrieve } from '@/lib/rag';
import { citationInstruction, sourceNames } from '@/lib/chat-citations';
import { getOrgSystemPrompt, recordAudit } from '@/lib/store';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
const enc = new TextEncoder();

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

// Streaming chat — assembles the conversation (project system prompt + history + new turn),
// forwards to the gateway with streaming, relays deltas as SSE, and persists the final answer.
// Message shape + params mirror Off Grid AI Desktop's llm.chatStream (enable_thinking:false).
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return new Response('unauthorized', { status: 401 });

  const {
    conversationId,
    content = '',
    model = '',
    images = [],
    regenerate = false,
    // Edit & branch: re-run from an edited prior user message, forking a new branch.
    editMessageId = null,
    approvals = [],
    orgKnowledge = false,
    // Tools menu: extended thinking toggle. Off by default (desktop parity, saves prefill).
    thinking = false,
    // Incognito / temporary chat: no DB writes, no memory. The client owns the transcript and
    // sends prior turns inline via `history`; nothing here is persisted.
    temporary = false,
    history = [],
    // Slash skill invoked inline for this turn only — its system prompt is applied for the turn.
    skillId: turnSkillId = null,
    // Ad-hoc file attachments already extracted to text by /api/v1/chat/attach — injected as a
    // system context block for this turn only (not persisted, not embedded).
    attachments = [],
  } = await req.json().catch(() => ({}));
  // Temporary conversations have no persisted row; synthesize a light stand-in so the rest of the
  // pipeline (system prompt, budget, tools) works unchanged. projectId/skillId stay null.
  const convo = temporary
    ? { id: '', userId, projectId: null, skillId: null }
    : conversationId
      ? await getConversation(userId, conversationId)
      : null;
  if (!convo) return new Response('conversation not found', { status: 404 });

  // Edit & branch: fork a new user turn from an edited prior message (persisted, becomes active).
  // The new user message is the parent of the assistant answer we're about to generate.
  let assistantParentId: string | null = null;
  if (!temporary && editMessageId && content.trim()) {
    assistantParentId = await branchUserMessage(convo.id, String(editMessageId), String(content));
    if (!assistantParentId) return new Response('message not found', { status: 404 });
  } else if (!temporary && regenerate) {
    // Regenerate: branch a fresh answer under the same user turn (old answer kept as a sibling).
    assistantParentId = await prepareRegenerate(convo.id);
  }

  // Temporary chats carry their own history from the client (never touch the DB).
  const prior: { role: string; content: string }[] = temporary
    ? (Array.isArray(history) ? history : []).map((h: { role: string; content: string }) => ({
        role: h.role,
        content: h.content,
      }))
    : (await listMessages(convo.id)).map((m) => ({ role: m.role, content: m.content }));
  // First user turn → title the conversation from it (like the desktop does).
  if (!temporary && !regenerate && !editMessageId && prior.length === 0 && content.trim()) {
    await renameConversation(userId, convo.id, deriveTitle(content));
  }

  // Build the OpenAI-style message array: custom instructions → project prompt → knowledge →
  // history → new user turn (+ images).
  const messages: {
    role: string;
    content: string | ContentPart[];
    tool_call_id?: string;
    tool_calls?: unknown;
  }[] = [];
  // Org-wide instructions: an admin-set system prompt injected into EVERY chat as the
  // highest-precedence system block, BEFORE per-user custom instructions. Best-effort.
  try {
    const orgPrompt = await getOrgSystemPrompt();
    if (orgPrompt.trim()) messages.push({ role: 'system', content: orgPrompt });
  } catch {
    /* org settings optional — chat still answers without them */
  }
  const ci = await getCustomInstructions(userId);
  if (ci.trim()) messages.push({ role: 'system', content: ci });
  const mem = await memoryBlock(userId);
  if (mem) messages.push({ role: 'system', content: mem });
  const sys = await projectSystemPrompt(convo.projectId ?? null);
  if (sys) messages.push({ role: 'system', content: sys });
  // Per-project memory: inject facts scoped to this conversation's project (additive to user memory).
  const projMem = await projectMemoryBlock(convo.projectId ?? null);
  if (projMem) messages.push({ role: 'system', content: projMem });
  // Attached files (ad-hoc chat): inject the extracted text as a system context block for this turn.
  if (Array.isArray(attachments) && attachments.length) {
    const block = attachmentBlock(
      attachments
        .filter((a: unknown) => a && typeof (a as { text?: unknown }).text === 'string')
        .map((a: { name?: string; text: string }) => ({
          name: String(a.name ?? 'file'),
          text: a.text,
          truncated: false,
        })),
    );
    if (block) messages.push({ role: 'system', content: block });
  }
  // Org skill bound to this conversation: inject its instructions, default its model, and use its
  // knowledge project for RAG when the conversation has none of its own.
  let skillModel = '';
  let ragProjectId = convo.projectId ?? null;
  // A slash-invoked skill applies for this turn only; a conversation-bound skill applies for the
  // whole thread. Turn skill takes precedence when both are present.
  const activeSkillId = turnSkillId ?? convo.skillId;
  if (activeSkillId) {
    const skill = await getSkill(activeSkillId);
    if (skill && skill.enabled) {
      if (skill.systemPrompt.trim()) messages.push({ role: 'system', content: skill.systemPrompt });
      skillModel = skill.model ?? '';
      if (!ragProjectId && skill.projectId) ragProjectId = skill.projectId;
    }
  }
  // Project chats retrieve from the knowledgebase and cite (desktop RAG behavior).
  let citations: Citation[] = [];
  if (ragProjectId) {
    try {
      const r = await retrieve(ragProjectId, String(content));
      if (r.context) {
        messages.push({ role: 'system', content: r.context });
        citations = r.citations;
      }
    } catch {
      /* knowledgebase optional — chat still answers without it */
    }
  }
  // Org-wide knowledge base ("Ask Your Org"): when the client opts in, retrieve permission-aware
  // chunks scoped to the session role and inject them as a system block + citations, mirroring the
  // project RAG branch above. Retrieval only ever returns collections the role may access.
  if (orgKnowledge) {
    try {
      const r = await retrieveOrgKnowledge(String(content), session?.user?.role ?? 'viewer');
      if (r.context) {
        messages.push({ role: 'system', content: r.context });
        citations = citations.concat(
          r.citations.map((c) => ({ name: c.name, position: c.position, score: c.score })),
        );
      }
    } catch {
      /* org knowledge optional — chat still answers without it */
    }
  }
  // Inline-citation numbering: tell the model to cite with bracketed numbers ([1], [2] …) keyed to
  // the retrieved sources, in the SAME order buildSources()/the transcript footer number them (via
  // shared sourceNames). This is what lets the answer stream `Revenue rose [1].` and the renderer
  // turn [1] into a clickable chip that jumps to source 1. No sources → no instruction (no-op).
  if (citations.length) {
    const instruction = citationInstruction(sourceNames(citations));
    if (instruction) messages.push({ role: 'system', content: instruction });
  }
  // Cap history to the most recent turns so we don't overflow the model context (and, on this
  // hardware, don't pay for prefill of a huge transcript every turn). OpenWebUI-style trim.
  const MAX_HISTORY = 24;
  for (const m of prior.slice(-MAX_HISTORY)) {
    if (m.role === 'system') continue;
    messages.push({ role: m.role, content: m.content });
  }
  // On regenerate/edit the driving user turn is already in `prior` (edit persisted it as the new
  // branch); only add + persist a brand-new turn otherwise.
  if (!regenerate && !editMessageId) {
    const userContent: ContentPart[] = [{ type: 'text', text: String(content) }];
    for (const url of Array.isArray(images) ? images : []) {
      if (typeof url === 'string' && url.startsWith('data:')) {
        userContent.push({ type: 'image_url', image_url: { url } });
      }
    }
    messages.push({ role: 'user', content: userContent.length > 1 ? userContent : String(content) });
    if (!temporary) {
      await addMessage({
        conversationId: convo.id,
        role: 'user',
        content: String(content),
        images: userContent.length > 1 ? images : null,
      });
    }
  }

  const effectiveModel = model || skillModel;
  const role = session?.user?.role ?? 'viewer';

  // Governance: RBAC gate the model + skill (abacRules deny), and enforce the project's budget.
  const deny = (msg: string) =>
    new Response(`data: ${JSON.stringify({ error: msg })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
    });
  if (effectiveModel && (await isDenied(role, 'chat.model', effectiveModel))) {
    return deny(`model ${effectiveModel} is not permitted for your role`);
  }
  if (activeSkillId && (await isDenied(role, 'chat.skill', activeSkillId))) {
    return deny('this skill is not permitted for your role');
  }
  // Budget GATE — a hard stop, not just an alert. Price the cost this call WOULD incur (prompt
  // estimate + the reply headroom, at this model's finops rate) and ask the pure `checkBudget` gate
  // via projectBudget. Local ($0) models never exceed, so on-prem chat is never blocked; only real
  // cloud egress can be denied. On DENY → 402 (Payment Required) to the client + a budget.deny audit
  // event (outcome=blocked). Enforcement is togglable per org (default ON) — projectBudget honors it.
  const promptChars = messages.reduce(
    (n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length),
    0,
  );
  const estCallTokens = estimateTokens(String(promptChars ? promptChars : content)) + 2048; // + max_tokens reply
  const incomingCost = costForTokens(effectiveModel || 'unknown', estCallTokens);
  // Thread the run's org so the per-org enforce state is honored (chat runs under DEFAULT_ORG, the
  // same org used for this path's audit events above/below — keep them in lockstep).
  const budget = await projectBudget(ragProjectId, incomingCost, DEFAULT_ORG);
  if (!budget.ok) {
    // Record the denial in the audit ledger (canonical event: action=budget.deny, outcome=blocked)
    // so "we can prove spend limits are enforced" holds — the block is attributable + auditable.
    recordAudit({
      actor: actorFrom({ email: userId }),
      org: DEFAULT_ORG,
      project: ragProjectId ?? undefined,
      action: 'budget.deny',
      resource: budget.keyId ? `key:${budget.keyId}` : ragProjectId ? `project:${ragProjectId}` : undefined,
      model: effectiveModel || undefined,
      costUsd: incomingCost,
      outcome: 'blocked',
    });
    return new Response(
      JSON.stringify({
        error: 'budget_exceeded',
        message: `Project budget exceeded — this call would cost ~$${incomingCost.toFixed(4)} and the monthly budget of $${budget.limit} is already at $${budget.spent.toFixed(4)}. Contact an admin to raise it.`,
        spent: budget.spent,
        limit: budget.limit,
        incomingCost,
      }),
      { status: 402, headers: { 'content-type': 'application/json' } },
    );
  }

  // Org connectors (tool-calling): let the model decide whether to call a permitted tool. Mutating
  // tools require human approval — if any is pending, stop and ask the UI to approve before running.
  try {
    const resolved = await resolveTools(role, messages, effectiveModel, approvals, {
      conversationId: convo.id,
      userEmail: userId,
    });
    if (resolved?.pending?.length) {
      const body = `data: ${JSON.stringify({ approvalRequest: resolved.pending })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`;
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
      });
    }
    if (resolved?.messages?.length) {
      for (const m of resolved.messages) messages.push(m as (typeof messages)[number]);
    }
    // Inline citations: when a connector actually returned data, attach it as a source citation
    // (same shape as project-RAG citations: name + position + score) so the answer cites its tools.
    for (const a of resolved?.activity ?? []) {
      if (a.status !== 'executed') continue;
      citations.push({ name: a.ref || a.tool, position: citations.length + 1, score: 1 });
    }
  } catch {
    /* tool layer optional — chat still answers without it */
  }

  const payload: Record<string, unknown> = {
    messages,
    max_tokens: 2048,
    temperature: 0.7,
    stream: true,
    chat_template_kwargs: { enable_thinking: Boolean(thinking) },
  };
  if (effectiveModel) payload.model = effectiveModel;

  // Observability: mark when the upstream request begins so the Langfuse generation observation
  // records real latency once the completion finalizes.
  const traceStart = Date.now();
  const upstream = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    // x-offgrid-user attributes gateway spend to the real signed-in user (captured into the
    // gateway's OpenSearch log as `caller`) rather than the console's user-agent.
    headers: gatewayHeaders({ 'content-type': 'application/json', 'x-offgrid-user': userId }),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(290000),
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    const detail = upstream ? `gateway ${upstream.status}` : 'gateway unreachable';
    return new Response(`data: ${JSON.stringify({ error: detail })}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  const stream = new ReadableStream({
    // eslint-disable-next-line complexity
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';
      let reasoning = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const delta = JSON.parse(data)?.choices?.[0]?.delta;
              if (delta?.reasoning_content) {
                reasoning += delta.reasoning_content;
                send({ reasoning: delta.reasoning_content });
              }
              if (delta?.content) {
                full += delta.content;
                send({ content: delta.content });
              }
            } catch {
              /* partial JSON across chunks — ignore, next read completes it */
            }
          }
        }
      } catch (e) {
        send({ error: (e as Error).message });
      }
      // Persist the assistant answer, then tell the client we're done. Temporary chats skip all
      // persistence — the transcript lives only in the client for the session.
      if (!temporary) {
        try {
          await addMessage({
            conversationId: convo.id,
            role: 'assistant',
            content: full,
            reasoning: reasoning || null,
            citations: citations.length ? citations : null,
            // On regenerate/edit, attach under the driving user turn so the old answer stays as a
            // sibling branch; otherwise default to the active leaf (the just-added user turn).
            ...(assistantParentId ? { parentId: assistantParentId } : {}),
          });
        } catch {
          /* best-effort persistence */
        }
      }
      // Governance: audit this completion so Analytics/FinOps/Regulatory count chat usage, billed
      // to the project's virtual key when one exists.
      void writeChatAudit({
        userId,
        model: effectiveModel,
        tokens: estimateTokens(String(content)) + estimateTokens(full),
        promptTokens: estimateTokens(String(content)),
        completionTokens: estimateTokens(full),
        outcome: full ? 'ok' : 'error',
        keyId: budget.keyId,
        project: convo.projectId ?? null,
      });
      // Cross-conversation memory: distill durable facts from this turn (fire-and-forget).
      // Temporary chats are never added to memory.
      if (!temporary && full && String(content).trim()) {
        void extractMemory(userId, String(content), full, effectiveModel);
      }
      // Observability: push a Langfuse trace for this chat turn so the Observability page has real
      // data (plain chat previously emitted none). Fire-and-forget; skips temporary/incognito chats.
      // On regenerate/edit `content` may be empty, so fall back to the driving user turn.
      if (!temporary) {
        const traceInput = String(content).trim()
          ? String(content)
          : ([...prior].reverse().find((m) => m.role === 'user')?.content ?? '');
        emitChatTrace({
          conversationId: convo.id,
          userId,
          model: effectiveModel,
          input: traceInput,
          output: full,
          startTime: traceStart,
          endTime: Date.now(),
          promptTokens: estimateTokens(traceInput),
          completionTokens: estimateTokens(full),
        });
      }
      if (citations.length) send({ citations });
      send({ done: true });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
