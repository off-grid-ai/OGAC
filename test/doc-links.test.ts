import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyLink,
  splitFragment,
  extractLinks,
  gateExitCode,
} from '@/lib/doc-links';

// Pure rules behind the docs:links gate (#226). Internal (relative) links FAIL
// when their target is missing; external links WARN; anchors + in-app routes are
// ignored. These tests pin every branch of that policy.

test('classifyLink: relative paths are internal', () => {
  assert.equal(classifyLink('./ENGINEERING.md'), 'internal');
  assert.equal(classifyLink('../deploy/DEPLOY.md'), 'internal');
  assert.equal(classifyLink('GAPS_BACKLOG.md'), 'internal');
  assert.equal(classifyLink('sub/dir/file.md#section'), 'internal');
});

test('classifyLink: http/https/mailto are external (warn-only)', () => {
  assert.equal(classifyLink('https://example.com'), 'external');
  assert.equal(classifyLink('http://example.com/a'), 'external');
  assert.equal(classifyLink('mailto:team@offgrid.ai'), 'external');
  assert.equal(classifyLink('ftp://host/x'), 'external');
  assert.equal(classifyLink('//cdn.example.com/x'), 'external'); // protocol-relative
});

test('classifyLink: anchors, file:, and repo-absolute app routes are ignored', () => {
  assert.equal(classifyLink('#top'), 'ignored');
  assert.equal(classifyLink('file:///etc/hosts'), 'ignored');
  // Repo-absolute links are in-app routes, not files — must NOT be flagged internal.
  assert.equal(classifyLink('/fleet-control'), 'ignored');
  assert.equal(classifyLink('/handbook/agent-qa'), 'ignored');
});

test('classifyLink: empty / whitespace is ignored', () => {
  assert.equal(classifyLink(''), 'ignored');
  assert.equal(classifyLink('   '), 'ignored');
});

test('splitFragment separates path and fragment', () => {
  assert.deepEqual(splitFragment('./a/b.md#sec'), { path: './a/b.md', fragment: 'sec' });
  assert.deepEqual(splitFragment('./a/b.md'), { path: './a/b.md', fragment: null });
  // A trailing bare '#' yields a null fragment (empty → null).
  assert.deepEqual(splitFragment('x.md#'), { path: 'x.md', fragment: null });
  assert.deepEqual(splitFragment('#top'), { path: '', fragment: 'top' });
});

test('extractLinks: inline links', () => {
  assert.deepEqual(extractLinks('see [the guide](./guide.md) and [x](https://a.b)'), [
    './guide.md',
    'https://a.b',
  ]);
});

test('extractLinks: angle-wrapped and titled targets', () => {
  assert.deepEqual(extractLinks('[a](<./has space.md>) [b](./b.md "title")'), [
    './has space.md',
    './b.md',
  ]);
});

test('extractLinks: reference-style definitions', () => {
  const md = 'text [ref]\n\n[ref]: ./target.md "A title"\n';
  assert.deepEqual(extractLinks(md), ['./target.md']);
});

test('extractLinks: links inside code spans/fences are ignored', () => {
  const md = 'real [a](./a.md)\n\n```\n[fake](./nope.md)\n```\n\ninline `[also](./no.md)`';
  assert.deepEqual(extractLinks(md), ['./a.md']);
});

test('extractLinks: empty doc yields nothing', () => {
  assert.deepEqual(extractLinks(''), []);
});

test('gateExitCode: fails only when an internal link is broken', () => {
  assert.equal(gateExitCode(0), 0);
  assert.equal(gateExitCode(1), 1);
  assert.equal(gateExitCode(5), 1);
});
