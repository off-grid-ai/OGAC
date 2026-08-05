// Bounding the source text a governed step puts in front of the model.
//
// Live finding (2026-08-05): two of the insurer's three demo apps could not finish. The node answered a
// trivial prompt in 3.79s and the same node took 262s on the app's real prompt — a whole claim document
// plus six premium rows — because the composer joined EVERY retrieved snippet in full with no bound.
// On CPU-class hardware prefill dominates, so an unbounded context is an unanswerable prompt.
//
// These tests pin the two properties that make the fix safe: the budget is a real ceiling, and the trim
// is REPORTED rather than silent — in a product whose claim is "grounded in these sources", quietly
// dropping evidence would turn the citation list into a lie.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  boundSourceContext,
  boundedSourceNote,
  DEFAULT_MAX_SOURCES,
  sourceBudgetFromEnv,
  type SourceBudget,
} from '@/lib/source-context';

const BUDGET: SourceBudget = { maxSources: 3, maxCharsPerSource: 50, maxTotalChars: 200 };
const src = (title: string, snippet: string) => ({ title, snippet });

test('a small set passes through whole, numbered from 1', () => {
  // The bank app that always worked: two short rows. It must be unaffected by the bound.
  const r = boundSourceContext([src('Claim 1', 'amount 41346.44'), src('Policy 2', 'in force')], BUDGET);
  assert.equal(r.context, '[1] Claim 1: amount 41346.44\n[2] Policy 2: in force');
  assert.equal(r.includedCount, 2);
  assert.equal(r.droppedCount, 0);
  assert.equal(r.bounded, false, 'nothing trimmed means nothing to report');
  assert.equal(boundedSourceNote(r), null);
});

test('the source COUNT is a real ceiling', () => {
  const many = Array.from({ length: 10 }, (_, i) => src(`S${i}`, 'x'));
  const r = boundSourceContext(many, BUDGET);
  assert.equal(r.includedCount, 3);
  assert.equal(r.droppedCount, 7);
  assert.ok(r.bounded);
});

test('an over-long source is shortened and MARKED as partial', () => {
  // Marked, because a sentence cut mid-clause reads to the model as the whole record, and it will
  // reason confidently from half a fact.
  const r = boundSourceContext([src('Claim doc', 'y'.repeat(500))], BUDGET);
  assert.equal(r.truncatedCount, 1);
  assert.ok(r.context.includes('…'), 'the excerpt is visibly partial');
  assert.ok(r.context.length < 500);
  assert.ok(r.bounded);
});

test('the TOTAL budget bounds many short sources, which a per-source cap alone would not', () => {
  // The actual prefill protection: a hundred small rows cost as much as a few long ones.
  const many = Array.from({ length: 40 }, (_, i) => src(`Premium row ${i}`, 'z'.repeat(40)));
  const r = boundSourceContext(many, { maxSources: 40, maxCharsPerSource: 100, maxTotalChars: 200 });
  assert.ok(r.context.length <= 220, `context was ${r.context.length} chars`);
  assert.ok(r.includedCount < 40);
  assert.ok(r.droppedCount > 0);
});

test('at least one source always survives, however small the budget', () => {
  // Returning an empty context would silently un-ground the answer — strictly worse than a short one,
  // because the model then answers from nothing while the run still claims sources.
  const r = boundSourceContext([src('Huge', 'q'.repeat(10_000))], {
    maxSources: 5,
    maxCharsPerSource: 200,
    maxTotalChars: 10,
  });
  assert.equal(r.includedCount, 1);
  assert.ok(r.context.length > 0);
});

test('empty and whitespace-only snippets are not counted as sources', () => {
  // A blank row must not consume a citation slot or make the answer look better-grounded than it is.
  const r = boundSourceContext(
    [src('A', ''), src('B', '   '), src('C', 'real content'), { title: 'D', snippet: null }],
    BUDGET,
  );
  assert.equal(r.includedCount, 1);
  assert.equal(r.context, '[1] C: real content');
  assert.equal(r.droppedCount, 0, 'unusable rows are not "dropped evidence"');
  assert.equal(r.bounded, false);
});

test('no sources at all is reported as nothing bounded', () => {
  const r = boundSourceContext([], BUDGET);
  assert.equal(r.context, '');
  assert.equal(r.includedCount, 0);
  assert.equal(r.bounded, false, 'having no evidence is not the same as having trimmed it');
  assert.equal(boundedSourceNote(r), null);
});

test('whitespace in a retrieved row is collapsed', () => {
  // Retrieved DB rows arrive as pretty-printed JSON; the padding is pure prefill cost with no meaning.
  const r = boundSourceContext([src('Row', '{\n  "a":  1,\n\n  "b": 2\n}')], BUDGET);
  assert.ok(!r.context.includes('\n  '));
  assert.ok(r.context.includes('{ "a": 1, "b": 2 }'));
});

test('a missing title still yields a usable citation label', () => {
  const r = boundSourceContext([{ snippet: 'content', title: null }], BUDGET);
  assert.equal(r.context, '[1] source: content');
});

test('the note is plain language, names no engine, and states the real numbers', () => {
  const many = Array.from({ length: 10 }, (_, i) => src(`S${i}`, 'x'));
  const note = boundedSourceNote(boundSourceContext(many, BUDGET));
  assert.ok(note);
  assert.match(note, /7 of 10 sources were set aside/);
  for (const jargon of ['token', 'prefill', 'prompt', 'LLM', 'context window']) {
    assert.ok(!note.toLowerCase().includes(jargon.toLowerCase()), `note must not say "${jargon}"`);
  }
});

test('citation numbering is contiguous over what was INCLUDED', () => {
  // The caller builds its citation list from the same included slice, so `[3]` in the prompt must be
  // the third included source. A gap would make a citation point at a source the model never saw.
  const many = Array.from({ length: 6 }, (_, i) => src(`S${i}`, 'x'));
  const r = boundSourceContext(many, { maxSources: 3, maxCharsPerSource: 50, maxTotalChars: 999 });
  assert.deepEqual(
    r.context.split('\n').map((l) => l.slice(0, 3)),
    ['[1]', '[2]', '[3]'],
  );
});

test('the env budget falls back rather than throwing on nonsense', () => {
  // An operator typo must degrade to a working default, never disable grounding while looking like
  // configuration — the same rule the inference timeout follows.
  for (const bad of [undefined, '', 'abc', 'NaN', '-5', '0']) {
    const b = sourceBudgetFromEnv({ OFFGRID_MAX_SOURCES: bad });
    assert.ok(b.maxSources >= 1, `OFFGRID_MAX_SOURCES=${bad} must not disable sources`);
    assert.ok(b.maxCharsPerSource >= 200);
    assert.ok(b.maxTotalChars >= 200);
  }
  assert.equal(sourceBudgetFromEnv({}).maxSources, DEFAULT_MAX_SOURCES);
  assert.equal(sourceBudgetFromEnv({ OFFGRID_MAX_SOURCES: '4' }).maxSources, 4);
});
