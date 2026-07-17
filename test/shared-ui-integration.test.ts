import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';

import { Button } from '@offgrid/ui/operator/button';
import { Dialog as SharedDialog } from '@offgrid/ui/operator/dialog';
import { Disclosure as SharedDisclosure } from '@offgrid/ui/operator/disclosure';
import { EmptyState as SharedEmptyState, Spinner as SharedSpinner } from '@offgrid/ui/operator/feedback';
import { Input as SharedInput, Textarea as SharedTextarea } from '@offgrid/ui/operator/forms';
import { Sheet as SharedSheet } from '@offgrid/ui/operator/sheet';
import { Card as SharedCard } from '@offgrid/ui/operator/surface';
import { Tabs as SharedTabs } from '@offgrid/ui/operator/tabs';

import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

const root = process.cwd();

test('reviewed shared packages are immutable, authorized and installable from the repository', () => {
  const output = execFileSync(process.execPath, ['scripts/verify-vendor-artifacts.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.match(output, /Verified 2 pinned Off Grid UI artifacts/);
});

test('Console pins shared packages to repository-relative archives and verifies them before install', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));

  assert.equal(manifest.scripts.preinstall, 'node scripts/verify-vendor-artifacts.mjs');
  assert.equal(
    manifest.dependencies['@offgrid/design'],
    'file:vendor/offgrid-ui/offgrid-design-0.0.1.tgz',
  );
  assert.equal(manifest.dependencies['@offgrid/ui'], 'file:vendor/offgrid-ui/offgrid-ui-0.2.2.tgz');
  assert.match(
    lock.packages['node_modules/@offgrid/design'].resolved,
    /^file:vendor\/offgrid-ui\//,
  );
  assert.match(lock.packages['node_modules/@offgrid/design'].integrity, /^sha512-/);
  assert.match(lock.packages['node_modules/@offgrid/ui'].resolved, /^file:vendor\/offgrid-ui\//);
  assert.match(lock.packages['node_modules/@offgrid/ui'].integrity, /^sha512-/);
});

test('high-frequency Console adapters preserve one shared visual owner', () => {
  assert.equal(Input, SharedInput);
  assert.equal(Textarea, SharedTextarea);
  assert.equal(Card, SharedCard);
  assert.equal(Dialog, SharedDialog);
  assert.equal(Sheet, SharedSheet);
  assert.equal(Tabs, SharedTabs);
  assert.equal(Spinner, SharedSpinner);
  assert.equal(EmptyState, SharedEmptyState);
  assert.equal(Disclosure, SharedDisclosure);
});

test('shared Button preserves its label and exposes native loading and disabled semantics', () => {
  const loading = renderToStaticMarkup(createElement(Button, { loading: true }, 'Deploy'));
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /disabled=""/);
  assert.match(loading, />Deploy</);
  assert.match(loading, /role="status"/);
  assert.match(loading, />Loading</);

  const disabled = renderToStaticMarkup(createElement(Button, { disabled: true }, 'Delete'));
  assert.match(disabled, /disabled=""/);
  assert.match(disabled, /data-disabled=""/);
  assert.doesNotMatch(disabled, /aria-busy/);
});

test('shared Button exposes unavailable semantics when composed onto a link', () => {
  const html = renderToStaticMarkup(
    createElement(
      Button,
      { asChild: true, disabled: true },
      createElement('a', { href: '/deploy' }, 'Deploy'),
    ),
  );

  assert.match(html, /href="\/deploy"/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /data-disabled=""/);
  assert.doesNotMatch(html, /\sdisabled=""/);
});
