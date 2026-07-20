import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('evaluator and golden-case lists link to real canonical detail routes', () => {
  const evaluatorList = source('src/components/evals/EvalDefsManager.tsx');
  const caseList = source('src/components/evals/GoldenCasesManager.tsx');
  assert.match(evaluatorList, /\/solutions\/quality\/evaluators\/\$\{encodeURIComponent\(d\.id\)\}/);
  assert.match(caseList, /\/solutions\/quality\/golden-cases\/\$\{encodeURIComponent\(c\.id\)\}/);
  assert.equal(
    existsSync(new URL('src/app/(console)/solutions/quality/evaluators/[id]/page.tsx', root)),
    true,
  );
  assert.equal(
    existsSync(new URL('src/app/(console)/solutions/quality/golden-cases/[id]/page.tsx', root)),
    true,
  );
});

test('quality entity detail routes are tenant-scoped and expose real management actions', () => {
  const evaluator = source('src/app/(console)/solutions/quality/evaluators/[id]/page.tsx');
  const goldenCase = source('src/app/(console)/solutions/quality/golden-cases/[id]/page.tsx');
  const actions = source('src/components/evals/QualityEntityActions.tsx');
  for (const page of [evaluator, goldenCase]) {
    assert.match(page, /requireModuleForUser\('evals'\)/);
    assert.match(page, /await currentOrgId\(\)/);
  }
  assert.match(actions, /method: 'PATCH'/);
  assert.match(actions, /method: 'DELETE'/);
  assert.match(actions, /eval-defs\/\$\{definition\.id\}\/run/);
  assert.match(actions, /router\.push\(`\/solutions\/quality\/runs\/\$\{encodeURIComponent\(body\.run\.id\)\}`\)/);
  assert.match(actions, /new URLSearchParams\(params\.toString\(\)\)/);
  assert.match(actions, /router\.replace\(urlWithPanel\(false\)/);
});
