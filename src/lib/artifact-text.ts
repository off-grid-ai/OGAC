// ─── Artifact body text — pure ─────────────────────────────────────────────────────────────────────
//
// Artifacts rendered with literal `\n\n` visible in the preview: the body had been stored JSON-escaped
// (a string that went through JSON.stringify once too often) and was displayed verbatim. On screen that
// reads as broken output in a product whose whole pitch is trustworthy generated work.
//
// Decoding is deliberately CONSERVATIVE. Real content can legitimately contain a backslash-n — a regex,
// a Windows path, a code sample — so this only decodes when the text shows the signature of an escaped
// blob: it contains escape sequences and NO actual newline at all. A body that already has real newlines
// is returned untouched.

/** True when the text looks like a single-line JSON-escaped blob rather than real multi-line content. */
export function looksEscaped(text: string): boolean {
  if (!text || text.includes('\n')) return false;
  return /\\n|\\r|\\t/.test(text);
}

/** Decode the common JSON escapes. Returns the input unchanged when it is not an escaped blob. */
export function decodeArtifactText(text: string): string {
  if (!looksEscaped(text)) return text;
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}
