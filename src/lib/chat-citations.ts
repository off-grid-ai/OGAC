// Pure citation logic for the chat transcript — zero IO, zero React, unit-testable.
//
// The RAG/tool layer attaches an ordered `Citation[]` to an assistant message (name + source
// part + relevance score). Two transforms turn that into an inline-citation render:
//
//   1. buildSources()  — dedupe + number the citations into a stable Sources list ([1], [2] …),
//      where several chunks from the SAME document collapse to one numbered source (a doc is cited
//      once, even if three of its parts matched). Preserves best score + all matched parts.
//   2. parseCitationMarkers() — split answer text into an ordered run of plain-text and clickable
//      [n] marker segments, so the renderer can make each [n] jump to source n in the footer.
//
// The model is told (see citationInstruction) to cite with bracketed numbers keyed to the numbered
// sources; if it doesn't, the footer still lists the sources and the body simply carries no chips —
// clean degradation. No sources → no footer at all (empty arrays), the caller renders nothing.

export interface Citation {
  name: string;
  position: number;
  score: number;
}

// A numbered, de-duplicated source for the footer. `index` is the 1-based [n] the body cites.
export interface Source {
  index: number;
  name: string;
  score: number; // best (max) relevance across the source's matched parts, 0..1
  parts: number[]; // 1-based part numbers of this doc that matched, ascending, de-duped
}

// Collapse an ordered Citation[] into numbered Sources: one entry per distinct document name,
// numbered by first appearance (so [1] is the top-ranked source). Keeps every matched part and the
// best score. Order-stable and idempotent — safe to call on each stream tick.
export function buildSources(citations: Citation[] | null | undefined): Source[] {
  if (!citations?.length) return [];
  const byName = new Map<string, Source>();
  for (const c of citations) {
    const name = (c.name ?? '').trim() || 'source';
    const part = Number.isFinite(c.position) ? c.position + 1 : 1; // stored 0-based → 1-based
    const score = Number.isFinite(c.score) ? c.score : 0;
    const existing = byName.get(name);
    if (existing) {
      if (score > existing.score) existing.score = score;
      if (!existing.parts.includes(part)) existing.parts.push(part);
    } else {
      byName.set(name, { index: byName.size + 1, name, score, parts: [part] });
    }
  }
  const sources = [...byName.values()];
  for (const s of sources) s.parts.sort((a, b) => a - b);
  return sources;
}

// A parsed span of an assistant answer: literal text, or a citation marker referencing source [n].
export type Segment =
  | { type: 'text'; text: string }
  | { type: 'cite'; n: number; valid: boolean };

// Matches [1], [2, 3], [1][2] style bracketed citation markers. A marker is a bracket wrapping
// one-or-more comma/space separated integers. Non-numeric brackets (e.g. [note], [x]) are left as
// plain text so we never eat real prose.
const MARKER = /\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g;

// Split answer text into ordered text/cite segments. A [1,2] group expands into two cite segments
// (so each number is independently clickable). `valid` = the number maps to a known source, so the
// renderer can style dangling markers (model cited [5] but only 3 sources) as inert plain-looking
// text instead of a broken link. When there are no sources every marker is invalid → rendered inert.
export function parseCitationMarkers(text: string, sourceCount: number): Segment[] {
  if (!text) return [];
  const segments: Segment[] = [];
  let last = 0;
  const pushText = (s: string) => {
    if (s) segments.push({ type: 'text', text: s });
  };
  MARKER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER.exec(text)) !== null) {
    pushText(text.slice(last, m.index));
    const nums = m[0]
      .replace(/[[\]\s]/g, '')
      .split(',')
      .map((x) => Number.parseInt(x, 10))
      .filter((n) => Number.isFinite(n));
    for (const n of nums) {
      segments.push({ type: 'cite', n, valid: n >= 1 && n <= sourceCount });
    }
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));
  return segments;
}

// True when the answer contains at least one marker that maps to a real source — i.e. inline chips
// will actually render. Lets the caller decide layout (inline chips vs. footer-only listing).
export function hasInlineCitations(text: string, sourceCount: number): boolean {
  return parseCitationMarkers(text, sourceCount).some((s) => s.type === 'cite' && s.valid);
}

// The instruction appended to the retrieved knowledge block so the model cites with bracketed
// numbers ([1], [2]) that line up with buildSources()' numbering. `names` is the ordered list of
// distinct source names (same order buildSources assigns [1..n]). Pure string builder — the stream
// route injects it as a system block alongside the retrieved context.
export function citationInstruction(names: string[]): string {
  if (!names.length) return '';
  const lines = names.map((name, i) => `[${i + 1}] ${name}`);
  return (
    'When you use a fact from the knowledge base, cite it inline with its bracketed number ' +
    '(e.g. "Revenue rose 12% [1]."). Place the marker right after the sentence it supports. ' +
    'Use only these source numbers:\n' +
    lines.join('\n')
  );
}

// Ordered distinct source names for a citation list — the numbering key shared by
// citationInstruction (prompt side) and buildSources (render side), so [n] means the same doc in
// both. Derived from buildSources to guarantee they never drift.
export function sourceNames(citations: Citation[] | null | undefined): string[] {
  return buildSources(citations).map((s) => s.name);
}
