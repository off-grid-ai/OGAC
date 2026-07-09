import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type BlastRadiusControls,
  DEFAULT_CONTROLS,
  buildWouldPerform,
  evaluateBlastRadius,
  isSideEffectingStep,
  normalizeControls,
  previewPayload,
  resolveRunMode,
  shadowDetail,
  shouldIntercept,
} from '@/lib/app-run-controls';

// ─── isSideEffectingStep — only output sinks that leave the box ─────────────────────────────────────
test('isSideEffectingStep: report/email/whatsapp output sinks are side-effecting', () => {
  assert.equal(isSideEffectingStep({ kind: 'output', sink: 'email' }), true);
  assert.equal(isSideEffectingStep({ kind: 'output', sink: 'report' }), true);
  assert.equal(isSideEffectingStep({ kind: 'output', sink: 'whatsapp' }), true);
});

test('isSideEffectingStep: console sink + non-output kinds are NOT side-effecting', () => {
  assert.equal(isSideEffectingStep({ kind: 'output', sink: 'console' }), false);
  assert.equal(isSideEffectingStep({ kind: 'output' }), false); // undefined sink defaults to console
  assert.equal(isSideEffectingStep({ kind: 'output', sink: '  ' }), false); // blank → console
  assert.equal(isSideEffectingStep({ kind: 'agent' }), false);
  assert.equal(isSideEffectingStep({ kind: 'connector-query' }), false);
  assert.equal(isSideEffectingStep({ kind: 'guardrail' }), false);
  assert.equal(isSideEffectingStep({ kind: 'human' }), false);
});

// ─── shouldIntercept — shadow AND side-effecting ───────────────────────────────────────────────────
test('shouldIntercept: only a shadow run intercepts a side-effecting step', () => {
  assert.equal(shouldIntercept('shadow', { kind: 'output', sink: 'email' }), true);
  assert.equal(shouldIntercept('shadow', { kind: 'output', sink: 'console' }), false);
  assert.equal(shouldIntercept('shadow', { kind: 'agent' }), false);
  assert.equal(shouldIntercept('live', { kind: 'output', sink: 'email' }), false);
  assert.equal(shouldIntercept('live', { kind: 'agent' }), false);
});

// ─── previewPayload — bounded ──────────────────────────────────────────────────────────────────────
test('previewPayload: passes short bodies through, truncates long ones', () => {
  assert.equal(previewPayload('short'), 'short');
  assert.equal(previewPayload('  trimmed  '), 'trimmed');
  const long = 'x'.repeat(600);
  const p = previewPayload(long);
  assert.ok(p.length < 600);
  assert.match(p, /… \(100 more chars\)$/);
  assert.equal(previewPayload(undefined as unknown as string), '');
  assert.equal(previewPayload('abcdef', 3), 'abc… (3 more chars)');
});

// ─── buildWouldPerform / shadowDetail ───────────────────────────────────────────────────────────────
test('buildWouldPerform: pulls recipient/subject from config, previews the outcome', () => {
  const w = buildWouldPerform('email', { to: 'ops@bank.in', subject: 'KYC flag' }, 'Body text');
  assert.equal(w.sink, 'email');
  assert.equal(w.recipient, 'ops@bank.in');
  assert.equal(w.subject, 'KYC flag');
  assert.equal(w.payloadPreview, 'Body text');
});

test('buildWouldPerform: falls back through recipient aliases + filename, tolerates missing config', () => {
  assert.equal(buildWouldPerform('whatsapp', { number: '+91999' }, 'hi').recipient, '+91999');
  assert.equal(buildWouldPerform('report', { filename: 'r.pdf' }, 'x').subject, 'r.pdf');
  assert.equal(buildWouldPerform('report', { recipient: 'a@b' }, 'x').recipient, 'a@b');
  const bare = buildWouldPerform('email', undefined, 'x');
  assert.equal(bare.recipient, undefined);
  assert.equal(bare.subject, undefined);
});

test('shadowDetail: labels the dry-run action, with and without recipient/subject', () => {
  const full = shadowDetail({ sink: 'email', recipient: 'a@b', subject: 'S', payloadPreview: 'P' });
  assert.match(full, /^SHADOW: would email → a@b "S" \(not sent\)\. Preview: P$/);
  const bare = shadowDetail({ sink: 'report', payloadPreview: 'P' });
  assert.match(bare, /^SHADOW: would report \(not sent\)\. Preview: P$/);
});

// ─── evaluateBlastRadius — the cap decision, exhaustive ─────────────────────────────────────────────
const USAGE = { runsToday: 0, spentTodayUsd: 0, incomingRunCostUsd: 0 };

test('evaluateBlastRadius: no caps set → allow', () => {
  const v = evaluateBlastRadius(DEFAULT_CONTROLS, USAGE);
  assert.equal(v.allow, true);
  assert.equal(v.code, 'ok');
});

test('evaluateBlastRadius: disabled kill-switch → deny (takes precedence)', () => {
  const v = evaluateBlastRadius(
    { ...DEFAULT_CONTROLS, enabled: false, maxRunsPerDay: 100 },
    { ...USAGE, runsToday: 500 },
  );
  assert.equal(v.allow, false);
  assert.equal(v.code, 'disabled');
});

test('evaluateBlastRadius: runs/day cap — under, at, over', () => {
  const c: BlastRadiusControls = { ...DEFAULT_CONTROLS, maxRunsPerDay: 3 };
  assert.equal(evaluateBlastRadius(c, { ...USAGE, runsToday: 2 }).allow, true); // under
  assert.equal(evaluateBlastRadius(c, { ...USAGE, runsToday: 3 }).code, 'runs-cap'); // at → deny
  assert.equal(evaluateBlastRadius(c, { ...USAGE, runsToday: 4 }).code, 'runs-cap'); // over → deny
});

test('evaluateBlastRadius: a zero runs/day cap denies immediately', () => {
  assert.equal(
    evaluateBlastRadius({ ...DEFAULT_CONTROLS, maxRunsPerDay: 0 }, USAGE).code,
    'runs-cap',
  );
});

test('evaluateBlastRadius: spend cap DAY scope — projected over the cap denies', () => {
  const c: BlastRadiusControls = { ...DEFAULT_CONTROLS, spendCapUsd: 10, spendCapScope: 'day' };
  assert.equal(evaluateBlastRadius(c, { ...USAGE, spentTodayUsd: 5, incomingRunCostUsd: 4 }).allow, true);
  const over = evaluateBlastRadius(c, { ...USAGE, spentTodayUsd: 9, incomingRunCostUsd: 2 });
  assert.equal(over.allow, false);
  assert.equal(over.code, 'spend-cap');
});

test('evaluateBlastRadius: spend cap RUN scope — a single run over the cap denies', () => {
  const c: BlastRadiusControls = { ...DEFAULT_CONTROLS, spendCapUsd: 1, spendCapScope: 'run' };
  assert.equal(evaluateBlastRadius(c, { ...USAGE, incomingRunCostUsd: 0.5 }).allow, true);
  assert.equal(evaluateBlastRadius(c, { ...USAGE, incomingRunCostUsd: 2 }).code, 'spend-cap');
});

test('evaluateBlastRadius: a $0 (local) run never hits the spend cap', () => {
  const c: BlastRadiusControls = { ...DEFAULT_CONTROLS, spendCapUsd: 0, spendCapScope: 'day' };
  assert.equal(evaluateBlastRadius(c, { runsToday: 0, spentTodayUsd: 0 }).allow, true);
  // undefined incoming cost defaults to 0
  const c2: BlastRadiusControls = { ...DEFAULT_CONTROLS, spendCapUsd: 5, spendCapScope: 'run' };
  assert.equal(evaluateBlastRadius(c2, { runsToday: 0, spentTodayUsd: 0 }).allow, true);
});

test('evaluateBlastRadius: default day scope when spendCapScope omitted', () => {
  const c = { enabled: true, maxRunsPerDay: null, spendCapUsd: 3 } as BlastRadiusControls;
  const over = evaluateBlastRadius(c, { runsToday: 0, spentTodayUsd: 4, incomingRunCostUsd: 0 });
  assert.equal(over.code, 'spend-cap');
});

// ─── resolveRunMode ─────────────────────────────────────────────────────────────────────────────────
test('resolveRunMode: shadowDefault forces shadow regardless of request', () => {
  assert.equal(resolveRunMode('live', { shadowDefault: true }), 'shadow');
  assert.equal(resolveRunMode(undefined, { shadowDefault: true }), 'shadow');
});

test('resolveRunMode: no shadow default — requested shadow wins, else live', () => {
  assert.equal(resolveRunMode('shadow', { shadowDefault: false }), 'shadow');
  assert.equal(resolveRunMode(undefined, { shadowDefault: false }), 'live');
  assert.equal(resolveRunMode('live', { shadowDefault: false }), 'live');
});

// ─── normalizeControls ───────────────────────────────────────────────────────────────────────────────
test('normalizeControls: coerces an untrusted patch to a valid shape', () => {
  const n = normalizeControls({
    enabled: false,
    shadowDefault: true,
    maxRunsPerDay: -5,
    spendCapUsd: 12.5,
    spendCapScope: 'run',
  });
  assert.equal(n.enabled, false);
  assert.equal(n.shadowDefault, true);
  assert.equal(n.maxRunsPerDay, null); // negative clamped to null
  assert.equal(n.spendCapUsd, 12.5);
  assert.equal(n.spendCapScope, 'run');
});

test('normalizeControls: defaults — enabled true, live, day scope, null caps', () => {
  const n = normalizeControls({});
  assert.deepEqual(n, {
    enabled: true,
    maxRunsPerDay: null,
    spendCapUsd: null,
    spendCapScope: 'day',
    shadowDefault: false,
  });
});

test('normalizeControls: NaN / non-numeric caps clamp to null; bad scope → day', () => {
  const n = normalizeControls({
    maxRunsPerDay: 'x' as unknown as number,
    spendCapUsd: NaN,
    spendCapScope: 'bogus' as unknown as 'day',
  });
  assert.equal(n.maxRunsPerDay, null);
  assert.equal(n.spendCapUsd, null);
  assert.equal(n.spendCapScope, 'day');
});
