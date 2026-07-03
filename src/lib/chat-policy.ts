// Pure chat decisions — zero imports, no I/O, unit-testable in isolation (see chat-edit.test.ts).
// The DB/session adapters live in chat.ts; this file holds the rules they lean on.

// Edit-a-prior-user-message truncation rule (Phase 4.6): given an ordered message list and a target
// id, which messages survive an edit at that target. Everything up to AND INCLUDING the target is
// kept; everything after is dropped. An unknown id keeps nothing (empty survivor set → the caller
// treats it as "message not found"). Order is preserved.
export function messagesUpToInclusive<T extends { id: string }>(messages: T[], id: string): T[] {
  const idx = messages.findIndex((m) => m.id === id);
  if (idx < 0) return [];
  return messages.slice(0, idx + 1);
}
