import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactEndpointCredential } from '../src/lib/connector-policy.ts';

test('A PLAINTEXT PASSWORD NEVER REACHES THE SCREEN', () => {
  // The connector detail page rendered the stored endpoint verbatim, so a seeded SQL fixture projected
  // its password — on a conference projector, to a room. This is the actively damaging one.
  const out = redactEndpointCredential('mssql://sa:Offgrid!Erp2026@127.0.0.1:1433/erp');
  assert.doesNotMatch(out, /Offgrid!Erp2026/);
  assert.equal(out, 'mssql://sa:••••••@127.0.0.1:1433/erp');
});

test('the USERNAME is kept, because it is context and not a secret', () => {
  // "Which account are we connecting as" is a legitimate thing for an operator to read.
  assert.match(redactEndpointCredential('postgres://offgrid:offgrid@127.0.0.1:5432/db'), /offgrid:/);
  assert.equal(
    redactEndpointCredential('mysql://policyadmin:policyadmin@127.0.0.1:3307/policyadmin'),
    'mysql://policyadmin:••••••@127.0.0.1:3307/policyadmin',
  );
});

test('A MARKER IS LEFT, because a silently stripped password reads as "no credential"', () => {
  // Removing it entirely would turn "this source has a password" into "this source has none" — a
  // different and misleading fact about the deployment.
  const out = redactEndpointCredential('postgres://u:p@h:5432/d');
  assert.match(out, /••••••/);
  assert.notEqual(out, 'postgres://u@h:5432/d');
});

test('an endpoint with no password is returned untouched', () => {
  for (const clean of [
    'https://api.example.com/v1',
    'postgres://offgrid@127.0.0.1:5432/db',
    'mysql://policyadmin@127.0.0.1:3307/policyadmin',
    'http://127.0.0.1:8333',
  ]) {
    assert.equal(redactEndpointCredential(clean), clean, `${clean} must be unchanged`);
  }
  assert.equal(redactEndpointCredential(''), '');
  assert.equal(redactEndpointCredential('   '), '');
});

test('a MALFORMED endpoint carrying a credential is still redacted', () => {
  // A credential in an unparseable URL is exactly as damaging as one in a valid URL, so the fallback
  // must not simply give up and print it.
  const out = redactEndpointCredential('not a url :// sa:SuperSecret@host/db');
  assert.doesNotMatch(out, /SuperSecret/);
  assert.match(out, /••••••/);
});

test('the path, port, query and fragment survive redaction', () => {
  assert.equal(
    redactEndpointCredential('postgres://u:p@host:5433/mydb?sslmode=require#frag'),
    'postgres://u:••••••@host:5433/mydb?sslmode=require#frag',
  );
  // No port stated ⇒ none invented.
  assert.equal(redactEndpointCredential('mysql://u:p@host/db'), 'mysql://u:••••••@host/db');
});
