// Pure sanitizer for model control / tool tokens that leak INLINE into assistant `content`.
//
// A local (or misconfigured) model without native structured tool-calling can emit its control
// vocabulary as literal text inside the answer: `<function=search{…}>`, `<think>…</think>`,
// `<tool_call>{…}</tool_call>`, chat-template sentinels like `<|im_start|>` / `<|im_end|>`.
// Nothing downstream should render those to the reader or read them aloud (TTS) — they are engine
// plumbing, not content, and a `<think>` block is a PRIVATE chain-of-thought the UI keeps collapsed.
//
// This is the ONE place that decision lives (DRY): the chat render path and the TTS text path both
// call it. Zero imports, zero IO — a deterministic string→string rule, unit-tested to 100%.

// Paired wrappers whose ENTIRE span (open tag … close tag, inclusive of the inner payload) is
// removed — the inner text is engine reasoning / a tool call, never user-facing content.
const PAIRED = [
  'think',
  'thinking',
  'tool_call',
  'tool_response',
  'tool_result',
  'function_call',
  'reasoning',
  'scratchpad',
] as const;

// Build a single regex that removes `<tag …>…</tag>` for any paired wrapper, case-insensitively,
// across newlines. Non-greedy so adjacent blocks aren't swallowed together.
const PAIRED_RE = new RegExp(`<(${PAIRED.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');

// A `<function=name{…}>` (or `<function=name>`) call token — no closing tag, self-contained.
const FUNCTION_CALL_RE = /<function\s*=[^>]*>/gi;

// Chat-template sentinels: `<|im_start|>`, `<|im_end|>`, `<|endoftext|>`, `<|assistant|>`, etc.
const SENTINEL_RE = /<\|[^|>]*\|>/g;

// Any leftover standalone control tag that keyword-matches our vocabulary but wasn't part of a
// well-formed pair (e.g. an unclosed `<tool_call>` or a stray `</think>`). Stripped so a malformed
// stream can't leak a bare tag.
const STRAY_RE = new RegExp(`<\\/?\\s*(${PAIRED.join('|')})\\b[^>]*>`, 'gi');

/**
 * Strip inline model control / tool tokens from assistant content. Pure. Removes paired
 * reasoning/tool blocks (payload included), function-call tokens, and chat-template sentinels,
 * then collapses the whitespace the removal left behind. Content that contains none of these is
 * returned unchanged (aside from whitespace normalization when something WAS removed).
 */
export function stripControlTokens(input: string): string {
  if (!input) return '';
  const before = input;
  let t = input;
  t = t.replace(PAIRED_RE, ' ');
  t = t.replace(FUNCTION_CALL_RE, ' ');
  t = t.replace(SENTINEL_RE, ' ');
  t = t.replace(STRAY_RE, ' ');
  if (t === before) return input;
  // Collapse the gaps the removal left (multiple spaces, orphaned blank lines), preserving single
  // newlines so prose paragraphs survive.
  t = t
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return t.trim();
}
