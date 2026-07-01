import { auth } from '@/auth';
import {
  addMessage,
  deriveTitle,
  dropLastAssistant,
  getConversation,
  getCustomInstructions,
  getSkill,
  listMessages,
  memoryBlock,
  projectSystemPrompt,
  renameConversation,
} from '@/lib/chat';
import {
  estimateTokens,
  isDenied,
  projectBudget,
  writeChatAudit,
} from '@/lib/chat-governance';
import { extractMemory } from '@/lib/chat-memory';
import { resolveTools } from '@/lib/chat-tools';
import { type Citation, retrieve } from '@/lib/rag';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';
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
    approvals = [],
  } = await req.json().catch(() => ({}));
  const convo = conversationId ? await getConversation(userId, conversationId) : null;
  if (!convo) return new Response('conversation not found', { status: 404 });

  // Regenerate: drop the last assistant turn and re-answer the existing last user turn.
  if (regenerate) await dropLastAssistant(convo.id);

  const prior = await listMessages(convo.id);
  // First user turn → title the conversation from it (like the desktop does).
  if (!regenerate && prior.length === 0 && content.trim()) {
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
  const ci = await getCustomInstructions(userId);
  if (ci.trim()) messages.push({ role: 'system', content: ci });
  const mem = await memoryBlock(userId);
  if (mem) messages.push({ role: 'system', content: mem });
  const sys = await projectSystemPrompt(convo.projectId ?? null);
  if (sys) messages.push({ role: 'system', content: sys });
  // Org skill bound to this conversation: inject its instructions, default its model, and use its
  // knowledge project for RAG when the conversation has none of its own.
  let skillModel = '';
  let ragProjectId = convo.projectId ?? null;
  if (convo.skillId) {
    const skill = await getSkill(convo.skillId);
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
  // Cap history to the most recent turns so we don't overflow the model context (and, on this
  // hardware, don't pay for prefill of a huge transcript every turn). OpenWebUI-style trim.
  const MAX_HISTORY = 24;
  for (const m of prior.slice(-MAX_HISTORY)) {
    if (m.role === 'system') continue;
    messages.push({ role: m.role, content: m.content });
  }
  // On regenerate the last user turn is already in `prior`; only add a new turn otherwise.
  if (!regenerate) {
    const userContent: ContentPart[] = [{ type: 'text', text: String(content) }];
    for (const url of Array.isArray(images) ? images : []) {
      if (typeof url === 'string' && url.startsWith('data:')) {
        userContent.push({ type: 'image_url', image_url: { url } });
      }
    }
    messages.push({ role: 'user', content: userContent.length > 1 ? userContent : String(content) });
    await addMessage({
      conversationId: convo.id,
      role: 'user',
      content: String(content),
      images: userContent.length > 1 ? images : null,
    });
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
  if (convo.skillId && (await isDenied(role, 'chat.skill', convo.skillId))) {
    return deny('this skill is not permitted for your role');
  }
  const budget = await projectBudget(ragProjectId);
  if (!budget.ok) return deny('project budget exhausted for this month');

  // Org connectors (tool-calling): let the model decide whether to call a permitted tool. Mutating
  // tools require human approval — if any is pending, stop and ask the UI to approve before running.
  try {
    const resolved = await resolveTools(role, messages, effectiveModel, approvals);
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
  } catch {
    /* tool layer optional — chat still answers without it */
  }

  const payload: Record<string, unknown> = {
    messages,
    max_tokens: 2048,
    temperature: 0.7,
    stream: true,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (effectiveModel) payload.model = effectiveModel;

  const upstream = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
      // Persist the assistant answer, then tell the client we're done.
      try {
        await addMessage({
          conversationId: convo.id,
          role: 'assistant',
          content: full,
          reasoning: reasoning || null,
          citations: citations.length ? citations : null,
        });
      } catch {
        /* best-effort persistence */
      }
      // Governance: audit this completion so Analytics/FinOps/Regulatory count chat usage, billed
      // to the project's virtual key when one exists.
      void writeChatAudit({
        userId,
        model: effectiveModel,
        tokens: estimateTokens(String(content)) + estimateTokens(full),
        outcome: full ? 'ok' : 'error',
        keyId: budget.keyId,
      });
      // Cross-conversation memory: distill durable facts from this turn (fire-and-forget).
      if (full && String(content).trim()) {
        void extractMemory(userId, String(content), full, effectiveModel);
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
