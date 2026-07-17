import assert from 'node:assert/strict';
import test from 'node:test';
import { consoleContentMode } from '../src/lib/console-content.ts';

test('chat routes use the full-bleed workspace shell', () => {
  for (const pathname of [
    '/workspace/chat',
    '/workspace/chat/conversation-1',
    '/work/chat',
    '/work/chat/conversation-1',
  ]) {
    assert.equal(consoleContentMode(pathname), 'workspace');
  }
});

test('management and similarly-prefixed routes retain the standard page gutter', () => {
  for (const pathname of [
    '/overview',
    '/workspace/projects',
    '/work/artifacts',
    '/workspace/chatty',
    '/operations/services',
  ]) {
    assert.equal(consoleContentMode(pathname), 'page');
  }
});
