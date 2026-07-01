import { auth } from '@/auth';
import {
  addMessage,
  deriveTitle,
  getConversation,
  listMessages,
  projectSystemPrompt,
  renameConversation,
} from '@/lib/chat';
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

  const { conversationId, content = '', model = '', images = [] } = await req.json().catch(() => ({}));
  const convo = conversationId ? await getConversation(userId, conversationId) : null;
  if (!convo) return new Response('conversation not found', { status: 404 });

  const prior = await listMessages(convo.id);
  // First user turn → title the conversation from it (like the desktop does).
  if (prior.length === 0 && content.trim()) {
    await renameConversation(userId, convo.id, deriveTitle(content));
  }

  // Build the OpenAI-style message array: system → history → new user turn (+ images).
  const messages: { role: string; content: string | ContentPart[] }[] = [];
  const sys = await projectSystemPrompt(convo.projectId ?? null);
  if (sys) messages.push({ role: 'system', content: sys });
  // Project chats retrieve from the knowledgebase and cite (desktop RAG behavior).
  let citations: Citation[] = [];
  if (convo.projectId) {
    try {
      const r = await retrieve(convo.projectId, String(content));
      if (r.context) {
        messages.push({ role: 'system', content: r.context });
        citations = r.citations;
      }
    } catch {
      /* knowledgebase optional — chat still answers without it */
    }
  }
  for (const m of prior) {
    if (m.role === 'system') continue;
    messages.push({ role: m.role, content: m.content });
  }
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

  const payload: Record<string, unknown> = {
    messages,
    max_tokens: 2048,
    temperature: 0.7,
    stream: true,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (model) payload.model = model;

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
