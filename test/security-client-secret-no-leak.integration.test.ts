import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// SECURITY — the machine-client secret GET must NEVER return the raw Keycloak secret. It was a
// repeatable, un-audited exfiltration endpoint; it now reports only { configured: boolean }. The
// cleartext secret is revealed exactly once, at rotate time (POST).
//
// The Next route handler cannot be dynamically imported under `node --test` (it pulls `next/server`
// + the auth chain, which strip-only mode can't parse — see pipeline-run-route.integration.test.ts
// for the same constraint). So we guard the CONTRACT by reading the route source directly, which
// hygiene §D sanctions for glue ("guard string/prompt contracts by reading the source"). The GET body
// is asserted to expose only the boolean; POST still hands back the minted secret.

const routeSrc = readFileSync(
  fileURLToPath(new URL('../src/app/api/v1/admin/access/clients/[id]/secret/route.ts', import.meta.url)),
  'utf8',
);

// Split into the GET and POST handler bodies so assertions are per-handler (not the whole file).
const getBody = routeSrc.slice(
  routeSrc.indexOf('export async function GET'),
  routeSrc.indexOf('export async function POST'),
);
const postBody = routeSrc.slice(routeSrc.indexOf('export async function POST'));

test('GET handler returns configured boolean and NEVER the secret value (P1 leak closed)', () => {
  assert.match(getBody, /configured:\s*Boolean\(secret\)/, 'GET returns configured: Boolean(secret)');
  // The terminal artifact — the response shape — must NOT put the secret VALUE in the body: no
  // `secret:` key and no `, secret }` shorthand property returned to the caller.
  assert.doesNotMatch(getBody, /\bsecret:\s/, 'GET response has no `secret:` key');
  assert.doesNotMatch(getBody, /,\s*secret\s*\}/, 'GET response has no `secret` shorthand property');
  assert.doesNotMatch(getBody, /configured:\s*true,\s*secret/, 'GET does not return {configured:true, secret}');
});

test('POST rotate still returns the freshly-minted secret once (unchanged path)', () => {
  assert.match(postBody, /regenerateClientSecret\(id\)/, 'POST rotates the secret');
  assert.match(postBody, /json\(\s*\{\s*configured:\s*true,\s*secret\s*\}/, 'POST returns {configured, secret}');
});

test('neither handler leaks the raw internal error message to the caller (generic message only)', () => {
  assert.doesNotMatch(routeSrc, /error:\s*\(err as Error\)\.message/, 'no raw error.message in a response');
  assert.match(routeSrc, /error:\s*'service unavailable'/, 'catch returns a generic message');
});
