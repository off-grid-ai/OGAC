import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gxParseFailure,
  gxResultPayload,
} from '../src/lib/service-capabilities/great-expectations-http.ts';
import { unavailableManifest } from '../src/lib/service-capabilities/great-expectations-lifecycle.ts';

test('GX HTTP mapping preserves success values and explicit lifecycle availability', () => {
  const manifest = unavailableManifest('partial');
  assert.deepEqual(gxResultPayload({ ok: true, value: { deleted: true }, manifest }, 201), {
    status: 201,
    body: { data: { deleted: true }, capabilities: manifest },
  });
});

test('GX HTTP mapping preserves typed failures and parse errors', () => {
  const manifest = unavailableManifest('not installed');
  assert.deepEqual(
    gxResultPayload({
      ok: false,
      kind: 'unavailable',
      message: 'suite CRUD unavailable',
      status: 501,
      manifest,
    }),
    {
      status: 501,
      body: { error: 'suite CRUD unavailable', kind: 'unavailable', capabilities: manifest },
    },
  );
  assert.deepEqual(gxParseFailure({ ok: false, errors: ['suite is invalid'], value: null }), {
    status: 400,
    body: { error: 'suite is invalid', errors: ['suite is invalid'] },
  });
});
