// ─── Markdown → one line of plain prose (PURE, zero-IO) ──────────────────────────────────────────
//
// For the places that show a PREVIEW of model output rather than the output itself: a timeline step's
// one-line detail, a list-row summary, a tooltip. Rendering markdown there is wrong — a heading and a
// bullet list cannot live on one line — but showing the source is what put
// `**Retention Action Recommendation:** **Rationale:** - The premium…` in a run's timeline.
//
// So: strip the syntax, keep the words. This is deliberately NOT a markdown parser. It handles the
// marks a model actually emits in prose and leaves anything it does not recognise alone, because a
// preview that mangles unfamiliar text is worse than one that shows a stray character.

/** Inline marks: **bold**, *em*, `code`, ~~strike~~ — keep the content, drop the delimiters. */
const INLINE = [
  [/\*\*(.+?)\*\*/g, '$1'],
  [/(^|\s)\*(?!\s)(.+?)(?<!\s)\*/g, '$1$2'],
  [/(^|\s)_(?!\s)(.+?)(?<!\s)_/g, '$1$2'],
  [/`([^`]+)`/g, '$1'],
  [/~~(.+?)~~/g, '$1'],
  // [label](href) → label. The link target is noise in a one-line preview.
  [/\[([^\]]+)\]\([^)]*\)/g, '$1'],
] as const;

/**
 * Flatten markdown to a single line of readable prose.
 *
 * Block structure becomes separators rather than disappearing: a heading and the paragraph under it
 * are different thoughts, and running them together ("Advisor CallRationale") reads as a typo.
 */
export function toPlainText(markdown: string | null | undefined): string {
  let text = String(markdown ?? '');
  if (!text.trim()) return '';

  // Fenced code: keep the code, lose the fence line (including any language tag).
  text = text.replace(/```[^\n]*\n?/g, ' ');
  // Leading block marks, per line: #, >, -, *, +, 1.
  text = text.replace(/^[ \t]*(?:#{1,6}|>)[ \t]*/gm, '');
  text = text.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '');
  // Horizontal rules carry nothing.
  text = text.replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '');
  for (const [pattern, replacement] of INLINE) text = text.replace(pattern, replacement);
  // Every run of whitespace — including the newlines that separated blocks — becomes one space.
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Plain text, cut to `max` characters on a word boundary with an ellipsis.
 *
 * Cuts on a space so a preview never ends mid-word, which reads as data loss rather than as a
 * deliberate truncation.
 */
export function previewText(markdown: string | null | undefined, max = 160): string {
  const text = toPlainText(markdown);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
