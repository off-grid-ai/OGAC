import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectDialect } from '../src/lib/connector-exec.ts';
import { validateConnectorCreate } from '../src/lib/connector-policy.ts';

// ─── ADVERSARIAL (QA bug-hunt) — connector SSRF + PATCH validation bypass ─────────────────────────
// RED against HEAD (7ea13b8). Root causes:
//
// G-ADV-DATA-2 (SSRF via connector endpoint):
//   connector-exec.ts's testConnection/listResources/recordCount/execConnectorQuery fetch the
//   connector's `endpoint` server-side (fetch(endpoint) for REST; pg/mysql/mssql connect for SQL)
//   with NO host validation. detectDialect only checks the SCHEME is http(s)/postgres/… — so a
//   connector whose endpoint is http://169.254.169.254/… or http://127.0.0.1:8941 (the internal
//   warehouse) or http://localhost:8200 (the vault) is happily fetched by the admin `test` /
//   `resources` routes. There is no isPrivateHost / link-local / loopback / metadata-IP guard
//   anywhere in src/lib (grep confirms). An admin-gated SSRF pivot into the private control plane.
//
// G-ADV-DATA-3 / G-ADV-SET-4 (PATCH bypasses create validation — CONFIRM + EXTEND):
//   POST /connectors runs the PURE validateConnectorCreate (creatable-type check, host charset,
//   port range, http/https-only scheme). PATCH /connectors/[id] runs NONE of it — it forwards
//   body.type and body.endpoint straight to updateConnector after only splitEndpointSecret (which
//   only touches SQL-scheme URLs; anything else is stored verbatim). So a PATCH can set:
//     - type to a 'coming-soon' or garbage type (create rejects these)
//     - endpoint to file://, gopher://, ftp://, or a private/metadata host (create rejects non-http)
//   There is NO pure validateConnectorUpdate — the create rule is not reused (DRY/SOLID violation).
//   This test pins the ABSENCE by asserting the validator that SHOULD gate PATCH exists and rejects.

// --- G-ADV-DATA-2: an SSRF host guard should exist and reject link-local / loopback endpoints ---
test.skip('ADVERSARIAL G-ADV-DATA-2: a private/link-local endpoint host must be rejected before fetch', async () => {
  // The fix introduces a pure guard (e.g. connector-endpoint.ts#isPublicEndpointHost) the exec/test
  // paths call before opening any connection. Until then this import fails / the guard is absent.
  const mod = await import('../src/lib/connector-endpoint.ts');
  const isPublicEndpointHost = (mod as Record<string, unknown>).isPublicEndpointHost as
    | ((endpoint: string) => boolean)
    | undefined;
  assert.equal(typeof isPublicEndpointHost, 'function', 'a public-host SSRF guard must exist');
  assert.equal(isPublicEndpointHost!('http://169.254.169.254/latest/meta-data/'), false);
  assert.equal(isPublicEndpointHost!('http://127.0.0.1:8941/'), false);
  assert.equal(isPublicEndpointHost!('http://localhost:8200/'), false);
  assert.equal(isPublicEndpointHost!('http://10.0.0.5/internal'), false);
  assert.equal(isPublicEndpointHost!('https://api.example.com/v1'), true);
});

// Documents the reachable surface today: a metadata-IP REST endpoint is a valid, fetchable dialect.
test('control: today detectDialect treats a metadata-IP REST endpoint as fetchable (SSRF surface)', () => {
  assert.equal(detectDialect('rest', 'http://169.254.169.254/latest/meta-data/'), 'rest');
});

// --- G-ADV-DATA-3: PATCH must reuse a create-grade validator for type + endpoint ---
test.skip('ADVERSARIAL G-ADV-DATA-3: PATCH must reject a non-http / private / bad-type endpoint via a shared validator', async () => {
  const mod = await import('../src/lib/connector-policy.ts');
  const validateConnectorUpdate = (mod as Record<string, unknown>).validateConnectorUpdate as
    | ((patch: Record<string, unknown>) => { ok: boolean; errors: string[] })
    | undefined;
  assert.equal(
    typeof validateConnectorUpdate,
    'function',
    'a pure PATCH validator must exist (DRY with create) so the edit path cannot bypass validation',
  );
  // A file:// endpoint must be refused (create refuses non-http; edit must too).
  assert.equal(validateConnectorUpdate!({ endpoint: 'file:///etc/passwd' }).ok, false);
  // A coming-soon / unknown type must be refused on edit just like on create.
  assert.equal(validateConnectorUpdate!({ type: 'snowflake' }).ok, false);
  assert.equal(validateConnectorUpdate!({ type: 'totally-made-up' }).ok, false);
});

// Proof the asymmetry exists TODAY: create rejects exactly what PATCH currently waves through.
test('control: create rejects file:// + coming-soon type (the exact inputs PATCH lets through)', () => {
  assert.equal(
    validateConnectorCreate({ name: 'x', type: 'rest', baseUrl: 'file:///etc/passwd' }).ok,
    false,
    'create refuses a non-http base URL',
  );
  assert.equal(
    validateConnectorCreate({ name: 'x', type: 'snowflake', baseUrl: 'https://ok.example.com' }).ok,
    false,
    'create refuses a coming-soon type',
  );
});
