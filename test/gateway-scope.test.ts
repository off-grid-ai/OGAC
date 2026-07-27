import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  currentGatewayScope,
  withGatewayScope,
} from '../src/lib/gateway-scope.ts';
import { gatewayAttribution, gatewayHeaders } from '../src/lib/gateway.ts';

// G-GATEWAY-ATTR-SWEEP: the aggregator stamps `org` on each observability doc from the
// `x-offgrid-org` header, but only 2 of 12 gateway call sites sent it — so a real governed run
// shipped docs with `org: null` and governed traffic read as unattributed in FinOps/Insights.
//
// Rather than adding orgId to ten signatures (several of them port interfaces with multiple
// implementations), attribution is stamped at the ONE seam they all already use: gatewayHeaders().

test('with no scope, headers are exactly what they were before', () => {
  // The safety property: a path that never opts in must be byte-identical to today.
  const headers = gatewayHeaders({ 'content-type': 'application/json' });
  assert.equal(headers['x-offgrid-org'], undefined);
  assert.equal(headers['x-offgrid-user'], undefined);
  assert.equal(headers['content-type'], 'application/json');
});

test('a run scope stamps every gateway call underneath it', () => {
  withGatewayScope({ orgId: 'org_bharat', userId: 'priya@bank.example' }, () => {
    const headers = gatewayHeaders({ 'content-type': 'application/json' });
    assert.equal(headers['x-offgrid-org'], 'org_bharat');
    assert.equal(headers['x-offgrid-user'], 'priya@bank.example');
    assert.equal(headers['content-type'], 'application/json');
  });
});

test('attribution survives awaits — the whole run, not just the first call', async () => {
  // This is why AsyncLocalStorage: a governed run makes its grounding/judge calls several awaits
  // deep, and those were exactly the ones shipping org:null.
  await withGatewayScope({ orgId: 'org_bharat' }, async () => {
    await new Promise((r) => setTimeout(r, 5));
    await Promise.resolve();
    const deep = await (async () => {
      await new Promise((r) => setTimeout(r, 1));
      return gatewayHeaders();
    })();
    assert.equal(deep['x-offgrid-org'], 'org_bharat');
  });
});

test('the scope does not leak outside the run', () => {
  withGatewayScope({ orgId: 'org_bharat' }, () => {
    assert.equal(gatewayHeaders()['x-offgrid-org'], 'org_bharat');
  });
  // A second tenant's call must never inherit the first tenant's attribution.
  assert.equal(gatewayHeaders()['x-offgrid-org'], undefined);
  assert.equal(currentGatewayScope(), undefined);
});

test('two concurrent runs do not cross-attribute', async () => {
  // The failure this guards is the worst kind: one tenant's spend billed to another.
  const seen: Record<string, string | undefined> = {};
  await Promise.all([
    withGatewayScope({ orgId: 'org_a' }, async () => {
      await new Promise((r) => setTimeout(r, 10));
      seen.a = gatewayHeaders()['x-offgrid-org'];
    }),
    withGatewayScope({ orgId: 'org_b' }, async () => {
      await new Promise((r) => setTimeout(r, 2));
      seen.b = gatewayHeaders()['x-offgrid-org'];
    }),
  ]);
  assert.deepEqual(seen, { a: 'org_a', b: 'org_b' });
});

test('an explicit per-call attribution still wins', () => {
  // The two sites that already pass their own attribution must keep working unchanged.
  withGatewayScope({ orgId: 'org_ambient' }, () => {
    const headers = gatewayHeaders(gatewayAttribution({ orgId: 'org_explicit' }));
    assert.equal(headers['x-offgrid-org'], 'org_explicit');
  });
});

test('a nested scope merges rather than erasing what it does not know', () => {
  // An inner step that only knows the user must not wipe the run's org.
  withGatewayScope({ orgId: 'org_bharat', userId: 'priya@bank.example' }, () => {
    withGatewayScope({ userId: 'step-runner' }, () => {
      const headers = gatewayHeaders();
      assert.equal(headers['x-offgrid-org'], 'org_bharat');
      assert.equal(headers['x-offgrid-user'], 'step-runner');
    });
  });
});

test('an empty scope is a no-op and cannot shadow an outer one', () => {
  withGatewayScope({ orgId: 'org_bharat' }, () => {
    withGatewayScope({}, () => {
      assert.equal(gatewayHeaders()['x-offgrid-org'], 'org_bharat');
    });
  });
  // And at the top level an empty scope simply changes nothing.
  withGatewayScope({}, () => {
    assert.equal(currentGatewayScope(), undefined);
  });
});

test('blank values stay honestly absent rather than becoming empty attribution', () => {
  withGatewayScope({ orgId: '   ', userId: '' }, () => {
    const headers = gatewayHeaders();
    assert.equal(headers['x-offgrid-org'], undefined);
    assert.equal(headers['x-offgrid-user'], undefined);
  });
});

test('the scope returns the callback value untouched', () => {
  assert.equal(withGatewayScope({ orgId: 'o' }, () => 42), 42);
  assert.equal(withGatewayScope({}, () => 'passthrough'), 'passthrough');
});
