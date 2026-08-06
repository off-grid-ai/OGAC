import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSources,
  parseCitationMarkers,
  hasInlineCitations,
  citationInstruction,
  sourceNames,
  type Citation,
} from '../src/lib/chat-citations.ts';

// Pure tests for the inline-citation transforms — NO React, NO DB, NO mocks. These functions are the
// contract between RAG output (Citation[]) and the transcript render ([n] chips + Sources footer),
// so a regression here breaks grounding attribution silently.

test('buildSources: empty / nullish → no sources (footer hidden)', () => {
  assert.deepEqual(buildSources(undefined), []);
  assert.deepEqual(buildSources(null), []);
  assert.deepEqual(buildSources([]), []);
});

test('buildSources: numbers distinct docs by first appearance', () => {
  const cites: Citation[] = [
    { name: 'Handbook.pdf', position: 3, score: 0.9 },
    { name: 'Policy.md', position: 0, score: 0.7 },
  ];
  const s = buildSources(cites);
  assert.equal(s.length, 2);
  assert.deepEqual(
    s.map((x) => [x.index, x.name]),
    [[1, 'Handbook.pdf'], [2, 'Policy.md']],
  );
  // position stored 0-based → part is 1-based.
  assert.deepEqual(s[0].parts, [4]);
  assert.deepEqual(s[1].parts, [1]);
});

test('buildSources: collapses multiple parts of one doc, keeps best score + all parts sorted', () => {
  const cites: Citation[] = [
    { name: 'Handbook.pdf', position: 5, score: 0.4 },
    { name: 'Handbook.pdf', position: 1, score: 0.95 },
    { name: 'Handbook.pdf', position: 1, score: 0.6 }, // duplicate part → not repeated
  ];
  const s = buildSources(cites);
  assert.equal(s.length, 1);
  assert.equal(s[0].index, 1);
  assert.equal(s[0].score, 0.95); // best
  assert.deepEqual(s[0].parts, [2, 6]); // 1-based, ascending, de-duped
});

test('buildSources: blank name falls back to "source"', () => {
  // A missing name stays EMPTY. It used to become the literal string 'source', which the footer then
  // rendered as a document title — the reader could not tell an unnamed document from one actually
  // called "source". The renderer says "Unnamed document" instead; that wording is presentation, and
  // the pure layer refuses to invent a fact.
  assert.equal(buildSources([{ name: '  ', position: 0, score: 1 }])[0].name, '');
});

test('parseCitationMarkers: interleaves text and clickable markers in order', () => {
  const segs = parseCitationMarkers('Revenue rose [1]. Costs fell [2].', 2);
  assert.deepEqual(segs, [
    { type: 'text', text: 'Revenue rose ' },
    { type: 'cite', n: 1, valid: true },
    { type: 'text', text: '. Costs fell ' },
    { type: 'cite', n: 2, valid: true },
    { type: 'text', text: '.' },
  ]);
});

test('parseCitationMarkers: [1,2] group expands into independent cites', () => {
  const segs = parseCitationMarkers('Both agree [1, 2].', 2);
  assert.deepEqual(segs, [
    { type: 'text', text: 'Both agree ' },
    { type: 'cite', n: 1, valid: true },
    { type: 'cite', n: 2, valid: true },
    { type: 'text', text: '.' },
  ]);
});

test('parseCitationMarkers: dangling marker (no such source) is marked invalid', () => {
  const segs = parseCitationMarkers('See [5].', 2);
  assert.deepEqual(segs, [
    { type: 'text', text: 'See ' },
    { type: 'cite', n: 5, valid: false },
    { type: 'text', text: '.' },
  ]);
});

test('parseCitationMarkers: non-numeric brackets are left as plain text', () => {
  const segs = parseCitationMarkers('An array a[i] and a [note].', 2);
  assert.deepEqual(segs, [{ type: 'text', text: 'An array a[i] and a [note].' }]);
});

test('parseCitationMarkers: no sources → every marker inert (valid=false)', () => {
  const segs = parseCitationMarkers('Grounded [1].', 0);
  assert.deepEqual(segs, [
    { type: 'text', text: 'Grounded ' },
    { type: 'cite', n: 1, valid: false },
    { type: 'text', text: '.' },
  ]);
});

test('parseCitationMarkers: empty text → no segments', () => {
  assert.deepEqual(parseCitationMarkers('', 3), []);
});

test('hasInlineCitations: true only when a valid marker is present', () => {
  assert.equal(hasInlineCitations('Fact [1].', 2), true);
  assert.equal(hasInlineCitations('Fact [9].', 2), false); // dangling
  assert.equal(hasInlineCitations('No markers here.', 2), false);
});

test('citationInstruction: numbers names to match buildSources order; empty → empty', () => {
  assert.equal(citationInstruction([]), '');
  const txt = citationInstruction(['Handbook.pdf', 'Policy.md']);
  assert.match(txt, /\[1\] Handbook\.pdf/);
  assert.match(txt, /\[2\] Policy\.md/);
});

test('sourceNames: ordered distinct names, aligned with buildSources numbering', () => {
  const cites: Citation[] = [
    { name: 'A.pdf', position: 0, score: 0.9 },
    { name: 'B.md', position: 0, score: 0.8 },
    { name: 'A.pdf', position: 2, score: 0.7 }, // dup doc → not repeated
  ];
  assert.deepEqual(sourceNames(cites), ['A.pdf', 'B.md']);
  // The prompt numbering and the render numbering share this list, so they can't drift.
  assert.equal(sourceNames(cites)[0], buildSources(cites)[0].name);
});


// ── A citation must not assert a relevance it does not have ─────────────────────────────────────────
//
// LIVE FINDING. The footer read `[1] source — part 1 · 0%` under a correct, well-grounded answer. The
// 0% was a MISSING score coerced to zero, which states as fact the opposite of what citing a source
// means. Same rule as ratio()'s `pct: null` in product-metrics.ts: unknown is not zero.
test('buildSources: an unsupplied score is null, never 0', () => {
  const [s] = buildSources([{ name: 'Policy.md', position: 0 } as unknown as Citation]);
  assert.equal(s.score, null, 'unknown relevance must be null so the UI can omit it');
});

test('buildSources: a real 0 score is preserved as 0, not confused with unknown', () => {
  const [s] = buildSources([{ name: 'Policy.md', position: 0, score: 0 }]);
  assert.equal(s.score, 0);
});

test('buildSources: the best KNOWN score wins over an unknown one', () => {
  const [s] = buildSources([
    { name: 'H.pdf', position: 0 } as unknown as Citation,
    { name: 'H.pdf', position: 1, score: 0.8 },
  ]);
  assert.equal(s.score, 0.8, 'a null must not shadow a real score, nor win a max() against it');
});

// ── The identity that makes a citation followable ───────────────────────────────────────────────────
//
// The row was not clickable because nothing in the chain carried a document id: the retriever built
// citations without docId/collectionId while holding both, and the chat route then re-mapped to
// {name, position, score}. The pure layer's job is to keep identity through the dedupe.
test('buildSources: carries docId/collectionId/collection through so the footer can link', () => {
  const [s] = buildSources([
    { name: 'HR Policy.pdf', position: 0, score: 0.9, docId: 'doc_1', collectionId: 'col_hr', collection: 'HR Policies' },
  ]);
  assert.equal(s.docId, 'doc_1');
  assert.equal(s.collectionId, 'col_hr');
  assert.equal(s.collection, 'HR Policies');
});

test('buildSources: two DIFFERENT unnamed documents stay two rows', () => {
  // Keying the dedupe on the name alone collapsed every unnamed document into one row, so an answer
  // grounded in three unnamed sources claimed a single source.
  const s = buildSources([
    { name: '', position: 0, score: 0.9, docId: 'doc_a' } as unknown as Citation,
    { name: '', position: 0, score: 0.8, docId: 'doc_b' } as unknown as Citation,
  ]);
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.docId), ['doc_a', 'doc_b']);
});

// ── The CROSSING assertion for the retriever → route → footer boundary ──────────────────────────────
//
// Both sides typechecked while the route stripped the fields, because {name,position,score} is
// assignable to Citation. The guard belongs on the crossing: whatever the retriever emits must still
// be linkable after the transport the route performs.
test('retriever citation → chat transport → a followable source', () => {
  const fromRetriever: Citation[] = [
    { name: 'Reimbursement Policy 2025.pdf', position: 2, score: 0.82, collection: 'HR Policies', docId: 'doc_9', collectionId: 'col_hr' },
  ];
  const transported: Citation[] = ([] as Citation[]).concat(fromRetriever); // what the route now does
  const [s] = buildSources(transported);
  assert.ok(s.collectionId, 'without this the footer has no destination and the row is inert');
  assert.equal(s.name, 'Reimbursement Policy 2025.pdf');
  assert.equal(s.score, 0.82);
});

// ── Ranges ────────────────────────────────────────────────────────────────────────────────────────
// Watched live 2026-08-06: the copilot writes "[8–9]" and "[1–6]" as readily as "[1, 2]". Those
// stayed literal text while single markers beside them became clickable chips, so a reader saw some
// citations they could click and some they could not, with no visible rule. Note the EN DASH — the
// model emits U+2013, which a hyphen-only pattern misses silently.

test('a range expands to one chip per cited record', () => {
  const segs = parseCitationMarkers('drift scores [8–9].', 12);
  const cites = segs.filter((s) => s.type === 'cite');
  assert.deepEqual(cites.map((c) => c.n), [8, 9]);
  assert.ok(cites.every((c) => c.valid));
});

test('a hyphen range works too, not just the en dash', () => {
  assert.deepEqual(
    parseCitationMarkers('see [1-6]', 10).filter((s) => s.type === 'cite').map((c) => c.n),
    [1, 2, 3, 4, 5, 6],
  );
});

test('ranges and lists mix in one marker', () => {
  assert.deepEqual(
    parseCitationMarkers('[1, 3–5]', 10).filter((s) => s.type === 'cite').map((c) => c.n),
    [1, 3, 4, 5],
  );
});

test('an out-of-range endpoint stays literal rather than becoming a wrong chip', () => {
  // [11–12] with only 10 sources: the second endpoint does not exist, so the marker must not claim it.
  const cites = parseCitationMarkers('[11–12]', 10).filter((s) => s.type === 'cite');
  assert.ok(cites.every((c) => !c.valid), 'no chip may claim a source that is not there');
});

test('an absurd range cannot generate hundreds of chips', () => {
  const cites = parseCitationMarkers('[1–900]', 5).filter((s) => s.type === 'cite');
  assert.ok(cites.length <= 2, `expected the marker to fall through, got ${cites.length} chips`);
});

test('a reversed range is not treated as a range', () => {
  const cites = parseCitationMarkers('[9–8]', 12).filter((s) => s.type === 'cite');
  assert.ok(cites.length <= 2);
});
