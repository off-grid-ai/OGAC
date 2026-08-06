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
  /** Human-readable collection holding the document, when the retriever knows it. */
  collection?: string;
  /** Identity of the cited document, so the footer can be a real link. */
  docId?: string;
  /**
   * WHERE the document is opened. A citation comes from one of two knowledge bases and they live at
   * different routes, so the origin is carried as data and the RENDERER owns the route mapping —
   * this module stays free of URL knowledge.
   */
  collectionId?: string; // org-wide knowledge → the collection holding it
  projectId?: string; // a project's own knowledge base → the project
}

// A numbered, de-duplicated source for the footer. `index` is the 1-based [n] the body cites.
export interface Source {
  index: number;
  /** The document name. EMPTY when the retriever did not supply one — see buildSources. */
  name: string;
  /**
   * Best (max) relevance across the source's matched parts, 0..1, or `null` when no score was
   * supplied. Never 0 as a stand-in: a cited source rendered "0% relevant" states as fact the
   * opposite of what citing it means. Same rule as `ratio()` in product-metrics.ts.
   */
  score: number | null;
  /** 0-based chunk indexes that matched. INTERNAL — not for display; see the footer's comment. */
  parts: number[];
  collection?: string;
  docId?: string;
  collectionId?: string;
  projectId?: string;
}

// Collapse an ordered Citation[] into numbered Sources: one entry per distinct document name,
// numbered by first appearance (so [1] is the top-ranked source). Keeps every matched part and the
// best score. Order-stable and idempotent — safe to call on each stream tick.
export function buildSources(citations: Citation[] | null | undefined): Source[] {
  if (!citations?.length) return [];
  const byName = new Map<string, Source>();
  for (const c of citations) {
    // NO FABRICATED NAME. This used to fall back to the literal string 'source', which rendered as
    // a document title — the reader could not tell "the document is called source" from "we do not
    // know what this document is". An unknown name stays empty and the footer says so in words.
    const name = (c.name ?? '').trim();
    const part = Number.isFinite(c.position) ? c.position + 1 : 1; // stored 0-based → 1-based
    // A MISSING score is null, not 0. `0` here printed a confident "0%" under every answer whose
    // retriever did not score its hits.
    const score = Number.isFinite(c.score) ? c.score : null;
    // Dedupe on the document IDENTITY where we have one, falling back to the name. Keying on the
    // name alone collapsed every unnamed document into a single row.
    const key = c.docId?.trim() || name || `#${byName.size + 1}`;
    const existing = byName.get(key);
    if (existing) {
      if (score !== null && (existing.score === null || score > existing.score)) existing.score = score;
      if (!existing.parts.includes(part)) existing.parts.push(part);
      existing.collection ||= c.collection?.trim() || undefined;
      existing.docId ||= c.docId?.trim() || undefined;
      existing.collectionId ||= c.collectionId?.trim() || undefined;
      existing.projectId ||= c.projectId?.trim() || undefined;
    } else {
      byName.set(key, {
        index: byName.size + 1,
        name,
        score,
        parts: [part],
        collection: c.collection?.trim() || undefined,
        docId: c.docId?.trim() || undefined,
        collectionId: c.collectionId?.trim() || undefined,
        projectId: c.projectId?.trim() || undefined,
      });
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

// Matches [1], [2, 3], [1][2] and RANGES like [8-9] or [1–6]. A marker is a bracket wrapping
// integers separated by commas or a dash. Non-numeric brackets (e.g. [note], [x]) are left as plain
// text so we never eat real prose.
//
// Ranges were added 2026-08-06 after watching the live copilot: the model writes "[8–9]" and "[1–6]"
// as naturally as "[1, 2]", and those stayed as literal bracketed text while single markers next to
// them turned into chips. The reader sees some citations they can click and some they cannot, with no
// rule explaining which — worse than none being clickable.
//
// Note the EN DASH as well as the hyphen: the model emits "–" (U+2013), which a hyphen-only pattern
// silently misses. That is exactly how this shipped looking half-broken.
const MARKER = /\[\s*\d+(?:\s*[,–—-]\s*\d+)*\s*\]/g;

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
    // Expand a range ("8–9" → 8, 9) so every cited record gets its own chip. Bounded by the source
    // count so a malformed "[1–900]" cannot generate hundreds of chips: an invalid endpoint makes the
    // whole marker fall through as literal text, which is the honest outcome.
    const body = m[0].replace(/[[\]\s]/g, '');
    const nums: number[] = [];
    for (const part of body.split(',')) {
      const range = part.match(/^(\d+)[–—-](\d+)$/);
      if (range) {
        const from = Number.parseInt(range[1], 10);
        const to = Number.parseInt(range[2], 10);
        if (to >= from && to - from < sourceCount) {
          for (let n = from; n <= to; n++) nums.push(n);
          continue;
        }
      }
      const single = Number.parseInt(part, 10);
      if (Number.isFinite(single)) nums.push(single);
    }
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
