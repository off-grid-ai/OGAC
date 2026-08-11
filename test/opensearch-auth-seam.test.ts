// Every read of the search index must go through `opensearchFetch`, which is the one place auth
// headers are added.
//
// Six call sites did not. Each built its own URL from `OFFGRID_OPENSEARCH_URL` and called bare
// `fetch`, so the moment the index required authentication they all got 401 — and each degraded
// quietly in its own way rather than erroring:
//
//   • /insights/siem, /governance/evidence/security   → rendered the literal string "OpenSearch 401"
//   • /insights/usage/traffic                          → "OpenSearch is unreachable"
//   • gateway finops, token budgets, prompt observability → silently empty
//
// It stayed hidden because every OTHER read went through the helper and worked, so the service
// looked healthy from every angle we normally check. Probing OpenSearch from the box with the
// console's own credentials returns 200 for the identical query. It was only visible by rendering
// the page as a signed-in demo viewer.
//
// This is a source-shape guard, not a behavioural test, because the failure is architectural: the
// bug is "did not use the seam", and no amount of exercising the seam can detect a caller that
// bypassed it.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** The helper itself is the one file allowed to build a URL and call fetch. */
const ALLOWED = new Set([path.join(ROOT, 'lib', 'opensearch-http.ts')]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** `fetch(...)` whose URL is built from an OpenSearch base — the exact shape that shipped. */
const RAW_OPENSEARCH_FETCH =
  /await\s+fetch\(\s*`\$\{\s*OS_URL\s*\}|await\s+fetch\(\s*`\$\{[^}]*OPENSEARCH[^}]*\}/;

test('no module reads the search index with an unauthenticated fetch', () => {
  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    if (ALLOWED.has(file)) continue;
    const src = readFileSync(file, 'utf8');
    if (RAW_OPENSEARCH_FETCH.test(src)) offenders.push(path.relative(ROOT, file));
  }
  assert.deepEqual(
    offenders,
    [],
    `these bypass opensearchFetch and will 401 once the index requires auth:\n  ${offenders.join('\n  ')}`,
  );
});

test('the guard catches the exact shape that shipped', () => {
  // A guard that can only pass is not a guard. This is the line from the gateway analytics route.
  const shipped = 'const r = await fetch(`${OS_URL}/${OS_INDEX}/_search`, {';
  assert.ok(RAW_OPENSEARCH_FETCH.test(shipped), 'must match the real defect');
  // ...and does not fire on the correct form.
  assert.ok(!RAW_OPENSEARCH_FETCH.test('const r = await opensearchFetch(`/${OS_INDEX}/_search`, {'));
});

test('a module that merely NAMES the env var is not an offender', () => {
  // config-registry and services-directory legitimately reference the variable to describe or probe
  // the service. Flagging those would make the guard noisy enough to be switched off.
  assert.ok(!RAW_OPENSEARCH_FETCH.test("key: 'OFFGRID_OPENSEARCH_URL',"));
  assert.ok(!RAW_OPENSEARCH_FETCH.test("url: process.env.OFFGRID_OPENSEARCH_URL ?? 'http://127.0.0.1:9200',"));
});
