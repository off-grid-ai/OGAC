import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const routeRoot = join(process.cwd(), 'src/app/(console)');
const lifecycleLayoutOwners = [
  'build/apps/[id]/',
  'solutions/apps/[id]/',
  'build/pipelines/[id]/',
  'runtime/pipelines/[id]/',
] as const;
const canvasPages = new Set([
  'workspace/chat/page.tsx',
  'workspace/chat/[conversationId]/page.tsx',
]);

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  const nested = await Promise.all(
    entries.map(async (name) => {
      const path = join(directory, name);
      return (await stat(path)).isDirectory() ? walk(path) : [path];
    }),
  );
  return nested.flat();
}

function containsJsx(source: string, path: string): boolean {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = false;
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

test('every rendered route owns a page frame or a deliberate canvas', async () => {
  for (const owner of ['build/apps/[id]/layout.tsx', 'build/pipelines/[id]/layout.tsx']) {
    assert.match(await readFile(join(routeRoot, owner), 'utf8'), /<PageFrame\b/);
  }

  const missing: string[] = [];
  const routeFiles = await walk(routeRoot);
  const contextualLayoutOwners = (
    await Promise.all(
      routeFiles
        .filter((candidate) => candidate.endsWith('/layout.tsx'))
        .map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
    )
  )
    .filter(({ source }) => /(?:ContextualModule|DataContextual)Shell/.test(source))
    .map(({ path }) => `${relative(routeRoot, path).replace(/layout\.tsx$/, '')}`);

  for (const path of routeFiles.filter((candidate) => candidate.endsWith('/page.tsx'))) {
    const route = relative(routeRoot, path);
    const source = await readFile(path, 'utf8');
    if (
      source.includes("from '@/components/PageFrame'") ||
      source.includes('EtlJobDetailContent') ||
      /^export \{ default \}/m.test(source) ||
      !containsJsx(source, path) ||
      lifecycleLayoutOwners.some((owner) => route.startsWith(owner)) ||
      contextualLayoutOwners.some((owner) => route.startsWith(owner)) ||
      canvasPages.has(route)
    ) {
      continue;
    }
    missing.push(route);
  }

  assert.deepEqual(missing, []);

  const chat = await readFile(join(process.cwd(), 'src/components/chat/ChatWorkspace.tsx'), 'utf8');
  assert.match(chat, /className="flex h-full min-h-0"/);
});
