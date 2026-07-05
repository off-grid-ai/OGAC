import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// Tests for the flag-management facade (src/lib/flags-manager.ts). With Unleash env UNSET, the
// facade must fall back to the first-party Postgres store for CRUD, and expose 'native' as the
// backend. Variants/rollout must hard-fail (UnleashRequiredError) since the store can't model them.
// The DB-backed paths skip green if Postgres is down.

// Ensure Unleash is not configured for this suite so we exercise the fallback branch.
delete process.env.OFFGRID_UNLEASH_URL;
delete process.env.OFFGRID_UNLEASH_ADMIN_TOKEN;
delete process.env.OFFGRID_UNLEASH_TOKEN;

test('flagBackend() reports native when Unleash is unconfigured', async () => {
  const { flagBackend } = await import('@/lib/flags-manager');
  assert.equal(flagBackend(), 'native');
});

test('variants/rollout throw UnleashRequiredError without Unleash', async () => {
  const { managedSetVariants, managedSetRollout, UnleashRequiredError } = await import(
    '@/lib/flags-manager'
  );
  await assert.rejects(() => managedSetVariants('x', [{ name: 'a' }]), UnleashRequiredError);
  await assert.rejects(() => managedSetRollout('x', 50), UnleashRequiredError);
});

const dbUp = await dbReachable();
const KEY = 'test-flags-manager';

test(
  'managed CRUD falls back to the first-party store (real Postgres)',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const {
      managedCreateFlag,
      managedListFlags,
      managedGetFlag,
      managedSetEnabled,
      managedSetDescription,
      managedDeleteFlag,
    } = await import('@/lib/flags-manager');
    const { deleteFlag } = await import('@/lib/store');

    t.after(async () => {
      await deleteFlag(KEY);
    });

    // CREATE via facade → native
    assert.equal(await managedCreateFlag(KEY, true, 'facade create'), 'native');
    const list = await managedListFlags();
    assert.equal(list.backend, 'native');
    assert.equal(list.environment, null);
    const created = list.data.find((f) => f.key === KEY);
    assert.ok(created && created.enabled && created.description === 'facade create');

    // GET detail (native → empty variants, null rollout)
    const detail = await managedGetFlag(KEY);
    assert.ok(detail);
    assert.equal(detail!.source, 'native');
    assert.deepEqual(detail!.variants, []);
    assert.equal(detail!.rolloutPercent, null);

    // UPDATE enabled + description
    assert.equal(await managedSetEnabled(KEY, false), 'native');
    assert.equal(await managedSetDescription(KEY, 'edited'), 'native');
    const after = await managedGetFlag(KEY);
    assert.equal(after!.enabled, false);
    assert.equal(after!.description, 'edited');

    // DELETE
    assert.equal(await managedDeleteFlag(KEY), true);
    assert.equal(await managedDeleteFlag(KEY), false, 'second delete misses');
  },
);
