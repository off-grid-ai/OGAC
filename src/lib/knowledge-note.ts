// ─── Naming a pasted knowledge note — pure ────────────────────────────────────────────────────────
//
// Knowledge arrives two ways: a file (which carries its own name) and text someone pastes (which does
// not). Requiring a title before pasted text can be saved is friction for exactly the non-technical
// operator these surfaces are for — a policy clause out of an email should go in as-is — so a title is
// derived from the text when none is given.
//
// Pure and shared because BOTH surfaces do this (the project knowledge panel and the org collection
// detail); the same rule in two components is how they drift.

const MAX_TITLE = 60;

/** The first non-blank line, stripped of markdown heading marks and clipped. */
export function firstMeaningfulLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  const cleaned = line
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*[-*>]\s*/, '')
    .trim();
  return cleaned.slice(0, MAX_TITLE);
}

/**
 * The name to store a pasted note under. An operator-supplied title always wins; otherwise the first
 * line becomes the name, with a `.md` suffix so it reads like the document it sits beside in the list.
 * Empty/whitespace-only text yields 'Note.md' rather than an empty name — a nameless row is unusable.
 */
export function noteDocumentName(text: string, provided?: string | null): string {
  const explicit = provided?.trim();
  if (explicit) return explicit.slice(0, 200);
  const derived = firstMeaningfulLine(text);
  return derived ? `${derived}.md` : 'Note.md';
}
