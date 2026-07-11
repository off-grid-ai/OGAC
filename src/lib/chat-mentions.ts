// Chat @-mention references — PURE logic (zero imports, zero IO, unit-tested). The chat composer
// lets an operator `@`-mention stored memories and knowledge (projects/KBs + specific docs) to pull
// them into a single turn as grounding context. This module owns the three pure decisions:
//   1. detect the active `@token` at the caret (open the picker + extract its query),
//   2. filter/rank the candidate list by that query,
//   3. fold the chosen references into the request payload the stream route understands.
// The React component stays thin: it renders the list this returns and posts buildRefsPayload().

// A thing the user can reference. `memory` = a stored fact; `project` = a whole KB (retrieval scoped
// to the project); `doc` = one document inside a KB (retrieval scoped to that doc).
export type MentionKind = 'memory' | 'project' | 'doc';

export interface MentionCandidate {
  kind: MentionKind;
  id: string; // memory fact id, project id, or document id
  label: string; // shown in the picker + chip (fact text, project name, or doc name)
  // For a doc candidate, the project it belongs to — needed to scope retrieval to that project.
  projectId?: string;
  // Optional secondary line in the picker (e.g. the project a doc lives under).
  hint?: string;
}

// A chosen reference, carried by the composer as a removable chip and posted with the turn.
export interface MentionRef {
  kind: MentionKind;
  id: string;
  label: string;
  projectId?: string;
}

// The wire shape the stream route consumes: explicit memory ids + KB scopes (project, optional doc).
export interface RefsPayload {
  memoryIds: string[];
  kb: { projectId: string; docId?: string }[];
}

// ─── 1. Detect the active @token at the caret ────────────────────────────────
// Returns the query (text after the `@`, may be empty) and the [start,end) range of the token
// (including the `@`) so the caller can replace it when a candidate is picked — or null when the
// caret isn't inside a mention token. A token starts at `@` that is at string start or preceded by
// whitespace, and runs until whitespace. We only trigger on the token the caret is *within*.
export function activeMention(
  text: string,
  caret: number,
): { query: string; start: number; end: number } | null {
  if (caret < 0 || caret > text.length) return null;
  // Walk left from the caret to find a `@`, stopping at whitespace (no mention) or string start.
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '@') break;
    if (/\s/.test(ch)) return null; // hit whitespace before an @ → not in a token
    i--;
  }
  if (i < 0 || text[i] !== '@') return null;
  // The `@` must be at string start or preceded by whitespace (so emails like a@b don't trigger).
  if (i > 0 && !/\s/.test(text[i - 1])) return null;
  // The token ends at the next whitespace after the @ (or end of string).
  let end = i + 1;
  while (end < text.length && !/\s/.test(text[end])) end++;
  // Only active if the caret sits inside this token.
  if (caret < i || caret > end) return null;
  return { query: text.slice(i + 1, end), start: i, end };
}

// ─── 2. Filter + rank candidates by the query ─────────────────────────────────
// Case-insensitive substring match on the label (and doc/project hint). Ranks exact prefix matches
// first, then earliest substring position, stable within a rank. Empty query → the full list
// (already-selected refs filtered out). Caps the result so the picker stays scannable.
export function matchMentions(
  candidates: MentionCandidate[],
  query: string,
  opts: { limit?: number; exclude?: MentionRef[] } = {},
): MentionCandidate[] {
  const limit = opts.limit ?? 8;
  const excluded = new Set((opts.exclude ?? []).map((r) => `${r.kind}:${r.id}`));
  const q = query.trim().toLowerCase();
  const scored = candidates
    .filter((c) => !excluded.has(`${c.kind}:${c.id}`))
    .map((c, i) => {
      const hay = `${c.label} ${c.hint ?? ''}`.toLowerCase();
      const pos = q ? hay.indexOf(q) : 0;
      const prefix = q ? c.label.toLowerCase().startsWith(q) : false;
      return { c, i, pos, prefix, keep: !q || pos >= 0 };
    })
    .filter((s) => s.keep)
    .sort((a, b) => {
      if (a.prefix !== b.prefix) return a.prefix ? -1 : 1;
      if (a.pos !== b.pos) return a.pos - b.pos;
      return a.i - b.i; // stable
    });
  return scored.slice(0, limit).map((s) => s.c);
}

// A candidate → the removable chip/ref the composer stores.
export function candidateToRef(c: MentionCandidate): MentionRef {
  return { kind: c.kind, id: c.id, label: c.label, projectId: c.projectId };
}

// ─── 3. Fold chosen refs into the request payload ─────────────────────────────
// Split the flat ref list into the stream route's shape. Memory refs → memoryIds. Project/doc refs
// → kb scopes (doc refs carry both projectId + docId; a doc without a projectId is dropped as it
// can't scope retrieval). De-dupes memory ids and (project,doc) scopes. Returns null when empty so
// the composer can omit the field entirely (clean degradation — no refs, no payload key).
export function buildRefsPayload(refs: MentionRef[]): RefsPayload | null {
  const memoryIds: string[] = [];
  const kb: { projectId: string; docId?: string }[] = [];
  const seenMem = new Set<string>();
  const seenKb = new Set<string>();
  for (const r of refs) {
    if (r.kind === 'memory') {
      if (!r.id || seenMem.has(r.id)) continue;
      seenMem.add(r.id);
      memoryIds.push(r.id);
    } else if (r.kind === 'project') {
      const key = `p:${r.id}`;
      if (!r.id || seenKb.has(key)) continue;
      seenKb.add(key);
      kb.push({ projectId: r.id });
    } else if (r.kind === 'doc') {
      if (!r.projectId || !r.id) continue; // a doc scope needs its project
      const key = `d:${r.projectId}:${r.id}`;
      if (seenKb.has(key)) continue;
      seenKb.add(key);
      kb.push({ projectId: r.projectId, docId: r.id });
    }
  }
  if (!memoryIds.length && !kb.length) return null;
  return { memoryIds, kb };
}

// ─── Context-block safety: neutralize untrusted text so it can't break out of a tag ──────────
// Untrusted, user-controlled strings (a stored memory fact, an uploaded filename, extracted file
// text) get interpolated into XML-ish system blocks (`<file>`, `<referenced_memory>`). Without
// escaping, a crafted value can close the wrapper tag early and inject its own instructions into
// what the model reads as trusted system context (a prompt-injection / context-boundary break).
// Neutralizing the angle brackets (and the quote, for attribute values) removes every tag boundary
// a payload could introduce, so the wrapper's own tags stay the ONLY structural tokens. One rule,
// reused by every context-block builder (DRY). Pure.
export function neutralizeForContextBlock(value: string): string {
  return (value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ─── Server-side: format referenced memory facts as a system block ────────────
// Mirrors chat.ts memoryBlock(), but for the EXPLICITLY @-mentioned facts of a single turn (not the
// user's whole memory). Empty in → empty out (no block injected). Pure: the caller resolves ids →
// facts from the DB, then formats here. Each fact is a stored user-controlled string, so it is
// neutralized before interpolation — a fact can't close </referenced_memory> or inject <system>.
export function referencedMemoryBlock(facts: string[]): string {
  const clean = facts.map((f) => f.trim()).filter(Boolean);
  if (!clean.length) return '';
  return (
    '<referenced_memory>\n' +
    'The user explicitly referenced these remembered facts for this message. Use them as context:\n' +
    clean.map((f) => `- ${neutralizeForContextBlock(f)}`).join('\n') +
    '\n</referenced_memory>'
  );
}

// Normalize an unknown request body's refs into a validated RefsPayload (defensive parse at the
// route boundary — the client is trusted-ish but we still coerce shapes). Pure. Returns null when
// there's nothing usable.
// eslint-disable-next-line complexity
export function parseRefsPayload(raw: unknown): RefsPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { memoryIds?: unknown; kb?: unknown };
  const memoryIds = Array.isArray(r.memoryIds)
    ? r.memoryIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];
  const kb: { projectId: string; docId?: string }[] = [];
  if (Array.isArray(r.kb)) {
    for (const item of r.kb) {
      if (!item || typeof item !== 'object') continue;
      const it = item as { projectId?: unknown; docId?: unknown };
      if (typeof it.projectId !== 'string' || !it.projectId) continue;
      const scope: { projectId: string; docId?: string } = { projectId: it.projectId };
      if (typeof it.docId === 'string' && it.docId) scope.docId = it.docId;
      kb.push(scope);
    }
  }
  if (!memoryIds.length && !kb.length) return null;
  return { memoryIds, kb };
}
