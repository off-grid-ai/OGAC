import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConsoleLoading from '../src/app/(console)/loading.tsx';

const routeRoot = join(process.cwd(), 'src/app/(console)');

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

async function inheritsPageFrame(path: string): Promise<boolean> {
  let directory = dirname(path);
  while (directory.startsWith(routeRoot)) {
    const layout = join(directory, 'layout.tsx');
    try {
      if ((await readFile(layout, 'utf8')).includes('<PageFrame')) return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
    if (directory === routeRoot) break;
    directory = dirname(directory);
  }
  return false;
}

test('every route loader owns or inherits its presentation frame', async () => {
  const missing: string[] = [];
  for (const path of (await walk(routeRoot)).filter((candidate) =>
    candidate.endsWith('/loading.tsx'),
  )) {
    const source = await readFile(path, 'utf8');
    if (source.includes('<PageFrame') || (await inheritsPageFrame(path))) continue;
    missing.push(relative(routeRoot, path));
  }

  assert.deepEqual(missing, []);
});

test('the root loading boundary renders inside the same padded frame as its page', () => {
  const html = renderToStaticMarkup(createElement(ConsoleLoading));

  const frameClass = html.match(/data-og-shell="page" class="([^"]*)"/)?.[1] ?? '';
  assert.ok(frameClass.split(' ').includes('overflow-y-auto'));
  assert.ok(frameClass.split(' ').includes('p-4'));
  assert.ok(frameClass.split(' ').includes('md:p-6'));
  assert.match(html, /aria-busy="true"/);
});

test('contextual detail loaders inherit one frame instead of nesting a second gutter', async () => {
  for (const path of ['build/apps/[id]/loading.tsx', 'build/pipelines/[id]/loading.tsx']) {
    const source = await readFile(join(routeRoot, path), 'utf8');
    assert.doesNotMatch(source, /<PageFrame\b/);
    assert.equal(await inheritsPageFrame(join(routeRoot, path)), true);
  }
});
