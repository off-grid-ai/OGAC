// @offgrid/policy — chat-message helpers.
// Reads and rewrites the last user message text, handling both plain-string
// content and OpenAI-style multipart content [{ type:'text', text }, ...].

/** A single OpenAI-style chat message. `content` is a string or a multipart array. */
export interface ChatMessage {
  role?: string;
  content?: unknown;
  [k: string]: unknown;
}

/** Pull the `messages` array out of a request body, or [] if absent/invalid. */
export function getMessages(body: Record<string, unknown>): ChatMessage[] {
  const m = body.messages;
  return Array.isArray(m) ? (m as ChatMessage[]) : [];
}

/** Index of the last message with role 'user', or -1. */
export function lastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return i;
  }
  return -1;
}

/** Extract the text of a message's content (concatenating multipart text parts). */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>;
          if (p.type === 'text' && typeof p.text === 'string') return p.text;
        }
        return '';
      })
      .join('');
  }
  return '';
}

/** Read the last user message text (empty string if none). */
export function readLastUserText(body: Record<string, unknown>): string {
  const messages = getMessages(body);
  const i = lastUserIndex(messages);
  if (i < 0) return '';
  return contentText(messages[i]?.content);
}

/**
 * Rewrite the last user message text in place, preserving content shape:
 * string stays a string; multipart keeps its parts, replacing the first text part
 * (or appending one). Returns true if a rewrite happened.
 */
export function rewriteLastUserText(body: Record<string, unknown>, next: string): boolean {
  const messages = getMessages(body);
  const i = lastUserIndex(messages);
  if (i < 0) return false;
  const msg = messages[i];
  const content = msg.content;
  if (typeof content === 'string') {
    msg.content = next;
    return true;
  }
  if (Array.isArray(content)) {
    const parts = content as Record<string, unknown>[];
    const ti = parts.findIndex((p) => p && p.type === 'text');
    if (ti >= 0) parts[ti].text = next;
    else parts.unshift({ type: 'text', text: next });
    return true;
  }
  // No recognizable content: set a string.
  msg.content = next;
  return true;
}
