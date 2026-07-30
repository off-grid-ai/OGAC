import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeFailure, explainResponse } from '../src/lib/api-failure.ts';

// The live case this module exists for: the server explained itself and the client threw it away.
test('the server reason WINS — the exact 403 body that produced "Could not add starter"', () => {
  const f = describeFailure(403, {
    error: 'forbidden',
    reason: 'read-only demo: this account can view everything but cannot make changes',
  }, 'add this starter');
  assert.equal(f.message, 'read-only demo: this account can view everything but cannot make changes');
  assert.equal(f.refusal, true, 'a 403 is the system working, not breakage');
});

test('"forbidden" alone is a code, not an explanation — it is not shown as the message', () => {
  const f = describeFailure(403, { error: 'forbidden' }, 'add this starter');
  assert.equal(f.message, 'You do not have permission to add this starter.');
  assert.ok(!/forbidden/i.test(f.message), 'an HTTP code is not a sentence for a person');
});

test('a refusal is never phrased as breakage, and breakage is never softened into a refusal', () => {
  assert.equal(describeFailure(401, null).refusal, true);
  assert.equal(describeFailure(403, null).refusal, true);
  // The distinction that matters: 500 means report a bug; 403 means ask for access.
  const broken = describeFailure(500, null, 'save this');
  assert.equal(broken.refusal, false);
  assert.match(broken.message, /on our side/);
});

test('each status maps to its own kind', () => {
  assert.equal(describeFailure(404, null).kind, 'missing');
  assert.equal(describeFailure(409, null).kind, 'conflict');
  assert.equal(describeFailure(429, null).kind, 'rate-limited');
  assert.equal(describeFailure(422, null).kind, 'invalid');
  assert.equal(describeFailure(503, null).kind, 'broken');
});

test('the fallback names the ATTEMPT so a generic message is still a sentence', () => {
  assert.match(describeFailure(400, null, 'publish this app').message, /publish this app/);
});

test('a message is never empty, whatever arrives', () => {
  for (const body of [null, undefined, {}, { reason: '   ' }, { error: 42 }]) {
    for (const status of [400, 401, 403, 404, 409, 429, 500, 599]) {
      assert.ok(describeFailure(status, body as never).message.trim().length > 0, `${status}`);
    }
  }
});

test('reason is preferred over message over detail over error', () => {
  const f = describeFailure(400, { error: 'bad', detail: 'd', message: 'm', reason: 'r' });
  assert.equal(f.message, 'r');
  assert.equal(describeFailure(400, { error: 'bad', detail: 'd', message: 'm' }).message, 'm');
  assert.equal(describeFailure(400, { error: 'bad', detail: 'd' }).message, 'd');
  assert.equal(describeFailure(400, { error: 'bad' }).message, 'bad');
});

// ── The crossing: a real Response must survive into a shown message ────────────────────────────────
test('explainResponse: a real 403 Response yields the server sentence', async () => {
  const res = new Response(
    JSON.stringify({ error: 'forbidden', reason: 'read-only demo: cannot make changes' }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  );
  const f = await explainResponse(res, 'add this starter');
  assert.equal(f.message, 'read-only demo: cannot make changes');
  assert.equal(f.refusal, true);
});

test('explainResponse: a non-JSON body loses the reason but never the status', async () => {
  const res = new Response('<html>502 Bad Gateway</html>', { status: 502 });
  const f = await explainResponse(res, 'save this');
  assert.equal(f.kind, 'broken');
  assert.ok(!f.message.includes('<html>'), 'raw markup is never shown to a user');
});
