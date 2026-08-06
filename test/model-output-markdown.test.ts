// A model writes markdown. Rendering its output raw puts literal `**Retention Action
// Recommendation**` and `-` bullets on screen, which is the difference between a considered
// recommendation and something that looks broken — and it has now been missed three times, each time
// found by a person looking at a screenshot rather than by anything in this suite.
//
// So this is a repo-hygiene check, not a unit test: a field that holds MODEL OUTPUT must not be
// rendered inside a <pre> or a whitespace-pre-wrap block.
//
// Deliberately narrow. It only knows about `.answer`, because that is the field whose meaning is
// unambiguous — it is always something a model wrote. A user's submitted query, a prompt template and
// a raw log line all legitimately render literally, and a broader rule would flag those and get
// switched off.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** `<pre …>{something.answer}` — the exact shape that shipped on the run-detail page. */
const RAW_ANSWER = /<pre\b[^>]*>\s*\{[^{}]*\.answer[^{}]*\}/s;
/** A `whitespace-pre-wrap` element whose body is an answer expression. */
const PREWRAP_ANSWER = /whitespace-pre-wrap[^>]*>\s*\{[^{}]*\.answer[^{}]*\}/s;

test('no surface renders a model answer as literal text', () => {
  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8');
    if (RAW_ANSWER.test(src) || PREWRAP_ANSWER.test(src)) {
      offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these render a model answer raw — wrap it in <Markdown>:\n  ${offenders.join('\n  ')}`,
  );
});

test('the guard actually catches the shape that shipped', () => {
  // A test that can only pass is not a guard. This is the literal line that was on
  // /operations/runs/[id] when the founder screenshotted it.
  const shipped = '<pre className="whitespace-pre-wrap text-sm text-foreground">{agent.answer}</pre>';
  assert.ok(RAW_ANSWER.test(shipped), 'the regex must match the real defect');
  assert.ok(!RAW_ANSWER.test('<pre className="whitespace-pre-wrap">{parsedQuery.request}</pre>'));
});
