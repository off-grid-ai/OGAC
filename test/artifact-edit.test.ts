import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  artifactSavePayload,
  artifactTitle,
  canSaveArtifact,
  isArtifactDirty,
} from '../src/lib/artifacts.ts';

// PURE unit tests for the inline artifact editor helpers (task #92) — no DB, no network, no React.
// They pin the dirty/savable rules the viewer's Save button reads and the persist body the EXISTING
// POST /api/v1/chat/artifacts route consumes (which versions by (user, conversation, title)).

// ─── isArtifactDirty ────────────────────────────────────────────────────────
test('isArtifactDirty: identical code is not dirty', () => {
  assert.equal(isArtifactDirty('<h1>Hi</h1>', '<h1>Hi</h1>'), false);
});

test('isArtifactDirty: changed code is dirty', () => {
  assert.equal(isArtifactDirty('<h1>Hi</h1>', '<h1>Bye</h1>'), true);
});

test('isArtifactDirty: trailing/leading whitespace-only change is NOT dirty', () => {
  assert.equal(isArtifactDirty('code', '  code\n'), false);
});

// ─── canSaveArtifact ──────────────────────────────────────────────────────────
test('canSaveArtifact: real change with content is savable', () => {
  assert.equal(canSaveArtifact('old', 'new'), true);
});

test('canSaveArtifact: no change is NOT savable (would be a server no-op)', () => {
  assert.equal(canSaveArtifact('same', 'same'), false);
});

test('canSaveArtifact: emptying the buffer is NOT savable (no useless empty version)', () => {
  assert.equal(canSaveArtifact('<svg/>', ''), false);
  assert.equal(canSaveArtifact('<svg/>', '   \n  '), false);
});

// ─── artifactSavePayload ──────────────────────────────────────────────────────
test('artifactSavePayload: shapes the POST body with derived title + null defaults', () => {
  const p = artifactSavePayload({ kind: 'html', code: '<title>Dash</title><h1>x</h1>' });
  assert.equal(p.kind, 'html');
  assert.equal(p.code, '<title>Dash</title><h1>x</h1>');
  assert.equal(p.language, null);
  assert.equal(p.conversationId, null);
  // title derives from artifactTitle over the edited code (HTML <title> wins).
  assert.equal(p.title, artifactTitle({ kind: 'html', code: '<title>Dash</title><h1>x</h1>' }));
  assert.equal(p.title, 'Dash');
});

test('artifactSavePayload: explicit title + conversationId target the same logical row', () => {
  // Editing an HTML artifact whose <title> changed must still land on the original row so the edit
  // appends a VERSION rather than forking a new artifact — callers pass the original title through.
  const p = artifactSavePayload(
    { kind: 'html', code: '<title>Renamed</title>', language: null },
    { title: 'Original Title', conversationId: 'conv-1' },
  );
  assert.equal(p.title, 'Original Title', 'explicit title overrides the derived one');
  assert.equal(p.conversationId, 'conv-1');
});

test('artifactSavePayload: passes language through for runnable code', () => {
  const p = artifactSavePayload({ kind: 'code', code: 'print(1)', language: 'python' });
  assert.equal(p.language, 'python');
  assert.equal(p.kind, 'code');
});

test('artifactSavePayload: blank explicit title falls back to derived title', () => {
  const p = artifactSavePayload({ kind: 'svg', code: '<svg></svg>' }, { title: '   ' });
  assert.equal(p.title, artifactTitle({ kind: 'svg', code: '<svg></svg>' }));
});
