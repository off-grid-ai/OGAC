import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DELETE,
  PATCH,
} from '../src/app/api/v1/admin/app-runs/[runId]/actions/[stepId]/outcomes/[outcomeId]/route.ts';
import {
  GET,
  POST,
} from '../src/app/api/v1/admin/app-runs/[runId]/actions/[stepId]/outcomes/route.ts';

const params = { params: Promise.resolve({ runId: 'run_1', stepId: 'act_1' }) };
const itemParams = {
  params: Promise.resolve({ runId: 'run_1', stepId: 'act_1', outcomeId: 'aout_1' }),
};

test('real collection route rejects an unauthenticated read before touching the store', async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'route-test-secret-route-test-secret';
  try {
    const response = await GET(new Request('http://console.local/api/outcomes'), params);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'unauthorized' });
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});

test('real create/correct/withdraw routes share the frozen request validation', async () => {
  const previous = process.env.OFFGRID_ADMIN_TOKEN;
  process.env.OFFGRID_ADMIN_TOKEN = 'outcome-route-test';
  const request = (method: string) =>
    new Request('http://console.local/api/outcomes', {
      method,
      headers: {
        authorization: 'Bearer outcome-route-test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });
  try {
    const create = await POST(request('POST'), params);
    assert.equal(create.status, 400);
    assert.match(JSON.stringify(await create.json()), /business outcome is invalid/);

    const correct = await PATCH(request('PATCH'), itemParams);
    assert.equal(correct.status, 400);
    assert.match(JSON.stringify(await correct.json()), /invalid business result correction/);

    const withdraw = await DELETE(request('DELETE'), itemParams);
    assert.equal(withdraw.status, 400);
    assert.match(JSON.stringify(await withdraw.json()), /invalid business result withdrawal/);
  } finally {
    if (previous === undefined) delete process.env.OFFGRID_ADMIN_TOKEN;
    else process.env.OFFGRID_ADMIN_TOKEN = previous;
  }
});
