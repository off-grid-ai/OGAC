import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  decideAdminGate,
  decideWriterGate,
  isViewerWriteAttempt,
  VIEWER_FORBIDDEN_BODY,
} from '@/lib/viewer-policy';

// SECURITY WIRING — the read-only viewer block. The DECISION (pure) is proven exhaustively in
// viewer-policy.test.ts; here we prove the GATES and the EDGE MIDDLEWARE actually WIRE those pure
// decisions to the terminal outcome (a 403 with the read-only body, an allow, a redacted secret).
//
// The gate/middleware handlers pull `next/server` + the NextAuth graph, which `node --test`
// (strip-only) cannot dynamically import (see security-client-secret-no-leak.integration.test.ts for
// the same constraint). So we guard the CONTRACT by reading the source — hygiene §D sanctions this for
// glue: "guard string/prompt contracts by reading the source". Each assertion pins a specific wiring
// line, so a regression (gate stops consulting the pure decision, or maps it to the wrong status)
// fails the test.

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const authz = read('../src/lib/authz.ts');
const middleware = read('../src/middleware.ts');
const reveal = read('../src/app/api/v1/admin/config/reveal/route.ts');

test('the pure decisions the wiring depends on behave (viewer write forbidden, read allowed)', () => {
  // These are the exact calls the gates make — assert the terminal decision both arms.
  assert.equal(decideWriterGate('viewer'), 'forbid-viewer-write');
  assert.equal(decideWriterGate('admin'), 'allow');
  assert.equal(decideAdminGate('viewer', 'POST'), 'forbid-viewer-write');
  assert.equal(decideAdminGate('viewer', 'GET'), 'allow');
  assert.equal(decideAdminGate('admin', 'DELETE'), 'allow');
  assert.equal(decideAdminGate('operator', 'GET'), 'forbid');
});

test('requireWriter WIRES decideWriterGate to a 403 with the read-only body', () => {
  const body = authz.slice(authz.indexOf('export async function requireWriter'));
  const fn = body.slice(0, body.indexOf('export async function', 1) + 1 || undefined);
  assert.match(fn, /decideWriterGate\(gate\.user\.role\)/, 'consults the pure writer decision');
  assert.match(fn, /!==\s*'allow'/, 'blocks anything that is not allow');
  assert.match(fn, /VIEWER_FORBIDDEN_BODY.*status:\s*403|403[\s\S]*VIEWER_FORBIDDEN_BODY/, 'returns 403 + the read-only body');
});

test('requireAdmin WIRES decideAdminGate: allow → session, viewer-write → read-only 403, else 403', () => {
  const body = authz.slice(authz.indexOf('export async function requireAdmin'));
  assert.match(body, /decideAdminGate\(gate\.user\.role,\s*req\?\.method\)/, 'consults the pure admin decision with the method');
  assert.match(body, /=== 'allow'\)\s*return gate/, 'allow returns the authorized session');
  assert.match(body, /forbid-viewer-write'\)\s*return[\s\S]*VIEWER_FORBIDDEN_BODY[\s\S]*403/, 'viewer-write → read-only 403');
  assert.match(body, /error:\s*'forbidden'\s*\},\s*\{\s*status:\s*403/, 'every other role → generic 403');
});

test('the edge middleware WIRES isViewerWriteAttempt to a catch-all 403 for every /api mutating request', () => {
  // The load-bearing control: covers all routes regardless of per-handler gate.
  assert.match(middleware, /isViewerWriteAttempt\(role,\s*req\.method\)/, 'checks the pure viewer-write attempt on the request method');
  assert.match(middleware, /pathname\.startsWith\('\/api\/'\)\s*&&\s*isViewerWriteAttempt/, 'scoped to /api/* mutating requests');
  assert.match(middleware, /VIEWER_FORBIDDEN_BODY[\s\S]*status:\s*403/, 'returns the read-only 403 body');
  // The pure predicate it relies on: viewer+mutating true, viewer+GET false, admin+POST false.
  assert.equal(isViewerWriteAttempt('viewer', 'POST'), true);
  assert.equal(isViewerWriteAttempt('viewer', 'GET'), false);
  assert.equal(isViewerWriteAttempt('admin', 'POST'), false);
});

test('config/reveal REDACTS the secret value for a viewer, returns raw for an admin', () => {
  assert.match(reveal, /isViewer\(gate\.user\.role\)/, 'resolves whether the caller is a viewer');
  assert.match(reveal, /redactSecretForViewer\(value,\s*viewer\)/, 'runs the value through the pure redactor');
  // The response returns the REDACTED value (`shown`), never the raw `value`, to a viewer.
  assert.match(reveal, /value:\s*shown/, 'the response body carries the redacted value, not the raw one');
  assert.doesNotMatch(
    reveal.slice(reveal.indexOf('return NextResponse.json')),
    /value:\s*value\b/,
    'the raw value is never placed in the response',
  );
});

test('the read-only 403 body is the single shared source of truth (no per-site string)', () => {
  assert.equal(VIEWER_FORBIDDEN_BODY.error, 'forbidden');
  // Both the gate and the middleware import the SAME constant, never a re-typed literal.
  assert.match(authz, /VIEWER_FORBIDDEN_BODY/);
  assert.match(middleware, /VIEWER_FORBIDDEN_BODY/);
});
