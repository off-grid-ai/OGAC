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
  assert.equal(buildSources([{ name: '  ', position: 0, score: 1 }])[0].name, 'source');
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
