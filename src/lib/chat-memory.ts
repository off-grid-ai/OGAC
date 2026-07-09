import { addMemory } from '@/lib/chat';

// Salient-fact extraction — after a chat turn, ask the gateway to pull durable facts about the user
// (preferences, identity, ongoing projects) worth remembering across conversations. Best-effort and
// fire-and-forget; failures never affect the chat. Mirrors the desktop's memory-distill approach
// (enable_thinking:false + a strict "one fact per line, or NONE" instruction).

import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';

const EXTRACT_PROMPT =
  'You extract durable facts about the USER worth remembering across future conversations ' +
  '(stable preferences, identity, role, ongoing projects, constraints). Ignore transient details ' +
  'and anything about the assistant. Output at most 3 facts, one per line, each a short ' +
  'self-contained sentence. If there is nothing durable, output exactly: NONE';

// eslint-disable-next-line complexity
export async function extractMemory(
  userId: string,
  orgId: string,
  userText: string,
  assistantText: string,
  model: string,
): Promise<void> {
  try {
    const payload: Record<string, unknown> = {
      messages: [
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user', content: `User said:\n${userText}\n\nAssistant replied:\n${assistantText}` },
      ],
      max_tokens: 200,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
    };
    if (model) payload.model = model;
    const r = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: gatewayHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return;
    const j = await r.json();
    const text: string = j?.choices?.[0]?.message?.content ?? '';
    if (!text || /^\s*none\s*$/i.test(text.trim())) return;
    for (const line of text.split('\n')) {
      const fact = line.replace(/^[-*\d.\s]+/, '').trim();
      if (fact && !/^none$/i.test(fact)) await addMemory(userId, orgId, fact, 'chat');
    }
  } catch {
    /* best-effort */
  }
}
