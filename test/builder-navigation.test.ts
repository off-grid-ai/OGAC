import assert from 'node:assert/strict';
import test from 'node:test';
import {
  builderModeFromQuery,
  builderModeHref,
  forgePreviewFromQuery,
  forgePreviewHref,
} from '../src/lib/builder-navigation.ts';

test('builder mode has one safe default for missing and unknown values', () => {
  assert.equal(builderModeFromQuery(new URLSearchParams()), 'build');
  assert.equal(builderModeFromQuery(new URLSearchParams('mode=unknown')), 'build');
  assert.equal(builderModeFromQuery(new URLSearchParams('mode=chat')), 'chat');
});

test('builder mode destinations preserve unrelated state and remove a hidden Forge preview', () => {
  assert.equal(
    builderModeHref('/solutions/apps/new', 'source=template&mode=chat&preview=governance', 'build'),
    '/solutions/apps/new?source=template&mode=build',
  );
  assert.equal(
    builderModeHref('/solutions/apps/new', 'source=template', 'chat'),
    '/solutions/apps/new?source=template&mode=chat',
  );
});

test('Forge preview has one safe default for missing and unknown values', () => {
  assert.equal(forgePreviewFromQuery(new URLSearchParams()), 'app');
  assert.equal(forgePreviewFromQuery(new URLSearchParams('preview=unknown')), 'app');
  assert.equal(forgePreviewFromQuery(new URLSearchParams('preview=flow')), 'flow');
  assert.equal(forgePreviewFromQuery(new URLSearchParams('preview=governance')), 'governance');
});

test('Forge preview destinations are deep links and preserve unrelated query state', () => {
  assert.equal(
    forgePreviewHref('/solutions/apps/new', 'source=template&mode=build', 'flow'),
    '/solutions/apps/new?source=template&mode=chat&preview=flow',
  );
});
