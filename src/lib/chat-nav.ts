// Pure chat-navigation mapping — zero imports, no I/O, unit-testable in isolation (see chat-nav.test.ts).
// The NAVIGATIONAL position of the chat surface (which conversation, which project) lives in the URL,
// not in React state: `/workspace/chat/<conversationId>?project=<projectId>`. `/workspace/chat` (no segment) is the
// "no conversation selected" landing (new-chat). This module is the single source of truth for
// URL <-> selection so ChatWorkspace stays a thin consumer of it + the router.

export interface ChatSelection {
  // Active conversation id, or null when none is selected (the new-chat landing at /chat).
  conversationId: string | null;
  // Active project filter, or null for "All chats".
  projectId: string | null;
}

// Normalize a raw param value (Next passes string | string[] | undefined) into a trimmed string or null.
function coerce(value: string | string[] | undefined | null): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

// Read the current selection from the route segment + searchParams.
// `conversationId` is the [conversationId] dynamic segment; `project` is the ?project= query param.
export function selectionFromParams(args: {
  conversationId?: string | string[] | null;
  project?: string | string[] | null;
}): ChatSelection {
  return {
    conversationId: coerce(args.conversationId),
    projectId: coerce(args.project),
  };
}

// Build the URL for a selection. Conversation (if any) is a path segment; project (if any) is a
// query param, so switching project keeps you on the same conversation and vice-versa. Deterministic
// output (stable key order) so equal selections produce identical strings — safe to compare/dedupe.
export function selectionToPath(selection: ChatSelection): string {
  const base = selection.conversationId
    ? `/workspace/chat/${encodeURIComponent(selection.conversationId)}`
    : '/workspace/chat';
  const query = selection.projectId
    ? `?project=${encodeURIComponent(selection.projectId)}`
    : '';
  return `${base}${query}`;
}

// Whether two selections point at the same place — used to avoid pushing a no-op history entry.
export function selectionEquals(a: ChatSelection, b: ChatSelection): boolean {
  return a.conversationId === b.conversationId && a.projectId === b.projectId;
}
