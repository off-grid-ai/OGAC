import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// SECURITY EPIC — Wave 1 tenant-isolation integration tests (real Postgres). Proves, for EACH
// store.ts-resident surface hardened in this wave, that tenant A cannot read/list/delete tenant B's
// rows, that writes stamp the caller's org, and that org_settings is per-tenant. Skips (green) when
// no DB is up. Every row is written under dedicated `test-w1-*` org ids so real data is untouched.

const A = `test-w1-a-${randomUUID().slice(0, 8)}`;
const B = `test-w1-b-${randomUUID().slice(0, 8)}`;

const dbUp = await dbReachable();
const skip = dbUp ? false : SKIP_MESSAGE;

test('devices are tenant-isolated: list/get/role/kill scope by org', { skip }, async (t) => {
  const store = await import('@/lib/store');
  const { db } = await import('@/db');
  const { devices, commands } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  await store.ensureOrgSchema();

  // Two enrollment tokens, one per org → two devices, one per tenant.
  const tokA = await store.createEnrollmentToken('Advisor', A);
  const tokB = await store.createEnrollmentToken('Advisor', B);
  const encA = await store.enrollDevice(tokA.token, 'A-laptop', 'macOS');
  const encB = await store.enrollDevice(tokB.token, 'B-laptop', 'macOS');
  assert.ok(encA && encB, 'both enrollments succeed');
  const idA = encA!.device.id;
  const idB = encB!.device.id;

  t.after(async () => {
    for (const id of [idA, idB]) {
      await db.delete(commands).where(eq(commands.deviceId, id)).catch(() => {});
      await db.delete(devices).where(eq(devices.id, id)).catch(() => {});
    }
  });

  // LIST — each org sees only its own device.
  const listA = (await store.listDevices(A)).map((d) => d.id);
  const listB = (await store.listDevices(B)).map((d) => d.id);
  assert.ok(listA.includes(idA) && !listA.includes(idB), 'A lists only A');
  assert.ok(listB.includes(idB) && !listB.includes(idA), 'B lists only B');

  // GET — cross-org read misses.
  assert.ok(await store.getDevice(idA, A), 'same-org get hits');
  assert.equal(await store.getDevice(idA, B), undefined, 'cross-org get misses');

  // ROLE — cross-org re-role misses (row untouched).
  assert.equal(await store.updateDeviceRole(idA, 'HIJACK', B), null, 'cross-org role misses');
  const stillA = await store.getDevice(idA, A);
  assert.notEqual(stillA?.role, 'HIJACK', 'cross-org role left the device untouched');
  assert.ok(await store.updateDeviceRole(idA, 'Manager', A), 'same-org role hits');

  // KILL — cross-org kill misses (no command queued); same-org kill queues.
  assert.equal(await store.queueKill(idA, B), null, 'cross-org kill misses (IDOR blocked)');
  assert.ok(await store.queueKill(idA, A), 'same-org kill queues');
});

test('audit events are tenant-isolated: appendAudit stamps device org, listAudit scopes', { skip }, async (t) => {
  const store = await import('@/lib/store');
  const { db } = await import('@/db');
  const { devices, auditEvents, commands } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  await store.ensureOrgSchema();

  const tokA = await store.createEnrollmentToken('Advisor', A);
  const tokB = await store.createEnrollmentToken('Advisor', B);
  const encA = (await store.enrollDevice(tokA.token, 'A-dev', 'macOS'))!;
  const encB = (await store.enrollDevice(tokB.token, 'B-dev', 'macOS'))!;

  t.after(async () => {
    for (const id of [encA.device.id, encB.device.id]) {
      await db.delete(auditEvents).where(eq(auditEvents.deviceId, id)).catch(() => {});
      await db.delete(commands).where(eq(commands.deviceId, id)).catch(() => {});
      await db.delete(devices).where(eq(devices.id, id)).catch(() => {});
    }
  });

  const evt = { ts: new Date().toISOString(), model: 'local', tokens: 1, leftDevice: false, tool: null, outcome: 'ok' as const };
  await store.appendAudit(encA.device.id, [evt]);
  await store.appendAudit(encB.device.id, [evt]);

  const auditA = await store.listAudit({ orgId: A, limit: 100 });
  const auditB = await store.listAudit({ orgId: B, limit: 100 });
  assert.ok(auditA.some((e) => e.deviceId === encA.device.id), 'A audit has A device');
  assert.ok(!auditA.some((e) => e.deviceId === encB.device.id), 'A audit never has B device (P0 leak closed)');
  assert.ok(auditB.some((e) => e.deviceId === encB.device.id), 'B audit has B device');
  assert.ok(!auditB.some((e) => e.deviceId === encA.device.id), 'B audit never has A device');
});

test('users are tenant-isolated: listUsers scopes, createConsoleUser stamps, setUserRole scopes', { skip }, async (t) => {
  const store = await import('@/lib/store');
  const { db } = await import('@/db');
  const { users } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const emailA = `w1-${randomUUID().slice(0, 8)}@a.test`;
  const emailB = `w1-${randomUUID().slice(0, 8)}@b.test`;
  t.after(async () => {
    for (const e of [emailA, emailB]) await db.delete(users).where(eq(users.email, e)).catch(() => {});
  });

  const uA = await store.createConsoleUser({ email: emailA, orgId: A });
  const uB = await store.createConsoleUser({ email: emailB, orgId: B });

  const idsA = new Set((await store.listUsers(A)).map((u) => u.id));
  const idsB = new Set((await store.listUsers(B)).map((u) => u.id));
  assert.ok(idsA.has(uA.id) && !idsA.has(uB.id), 'A lists only A users (whole-directory leak closed)');
  assert.ok(idsB.has(uB.id) && !idsB.has(uA.id), 'B lists only B users');

  // Cross-org role change misses; same-org hits.
  assert.equal(await store.setUserRole(uA.id, 'admin', B), null, 'cross-org role change misses');
  assert.ok(await store.setUserRole(uA.id, 'admin', A), 'same-org role change hits');
});

test('routing rules are tenant-isolated: list/create/toggle/delete + evaluate scope by org', { skip }, async (t) => {
  const store = await import('@/lib/store');
  const { db } = await import('@/db');
  const { routingRules } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  t.after(async () => {
    for (const org of [A, B]) await db.delete(routingRules).where(eq(routingRules.orgId, org)).catch(() => {});
  });

  const base = { priority: 10, attribute: 'data_class', operator: 'eq', value: 'pii', action: 'block', model: '', fallback: '' };
  const rA = await store.createRoutingRule({ name: 'A-rule', ...base }, A);
  const rB = await store.createRoutingRule({ name: 'B-rule', ...base }, B);

  assert.deepEqual((await store.listRoutingRules(A)).map((r) => r.id), [rA.id], 'A sees only A rule');
  assert.deepEqual((await store.listRoutingRules(B)).map((r) => r.id), [rB.id], 'B sees only B rule');

  // Cross-org toggle/delete are no-ops on the other org's rule.
  await store.setRoutingRuleEnabled(rA.id, false, B); // wrong org
  assert.equal((await store.listRoutingRules(A))[0].enabled, true, 'cross-org toggle did not touch A rule');
  await store.deleteRoutingRule(rA.id, B); // wrong org
  assert.equal((await store.listRoutingRules(A)).length, 1, 'cross-org delete did not remove A rule');

  // evaluateRouting only considers the caller's org rules.
  const decA = await store.evaluateRouting({ attributes: { data_class: 'pii' }, orgId: A });
  assert.equal(decA.action, 'block', 'A rule fires for A');
  const decNone = await store.evaluateRouting({ attributes: { data_class: 'pii' }, orgId: `${A}-empty` });
  assert.notEqual(decNone.action, 'block', 'an org with no rule is unaffected by A/B rules');
});

test('custom roles are tenant-isolated: list/getByName/create/delete scope by org', { skip }, async (t) => {
  const store = await import('@/lib/store');
  const { db } = await import('@/db');
  const { customRoles } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  await store.ensureOrgSchema();

  t.after(async () => {
    for (const org of [A, B]) await db.delete(customRoles).where(eq(customRoles.orgId, org)).catch(() => {});
  });

  const name = `w1-role-${randomUUID().slice(0, 6)}`;
  const roleA = await store.createCustomRole({ name, capabilities: ['fleet'] }, A);
  await store.createCustomRole({ name, capabilities: ['governance'] }, B); // same name, different org

  assert.deepEqual((await store.listCustomRoles(A)).map((r) => r.id), [roleA.id], 'A sees only A role');
  // getByName resolves the caller's org definition, not the other tenant's same-named role.
  assert.deepEqual((await store.getCustomRoleByName(name, A))?.capabilities, ['fleet'], 'A resolves A capabilities');
  assert.deepEqual((await store.getCustomRoleByName(name, B))?.capabilities, ['governance'], 'B resolves B capabilities');

  // Cross-org delete misses.
  await store.deleteCustomRole(roleA.id, B);
  assert.equal((await store.listCustomRoles(A)).length, 1, 'cross-org delete did not remove A role');
});

test('ABAC rules are tenant-isolated: evaluateAbac only sees the caller org rules', { skip }, async (t) => {
  const store = await import('@/lib/store');
  const { db } = await import('@/db');
  const { abacRules } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  await store.ensureOrgSchema();

  t.after(async () => {
    for (const org of [A, B]) await db.delete(abacRules).where(eq(abacRules.orgId, org)).catch(() => {});
  });

  // A DENY rule in org B must never affect an evaluation for org A.
  await store.createAbacRule({ role: '*', resource: 'reports', attribute: 'x', operator: 'eq', value: '1', effect: 'deny' }, B);
  await store.createAbacRule({ role: '*', resource: 'reports', attribute: 'x', operator: 'eq', value: '1', effect: 'allow' }, A);

  const ctx = { role: 'viewer', attributes: { x: '1' }, resource: 'reports' };
  assert.equal((await store.evaluateAbac(ctx, A)).allow, true, 'A allow rule grants for A');
  assert.equal((await store.evaluateAbac(ctx, B)).allow, false, 'B deny rule denies for B — never leaks into A');
});

test('feature flags are per-tenant: same key coexists, toggle isolated', { skip }, async (t) => {
  const store = await import('@/lib/store');
  const { db } = await import('@/db');
  const { featureFlags } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  await store.ensureOrgSchema();

  const key = `w1-flag-${randomUUID().slice(0, 6)}`;
  t.after(async () => {
    for (const org of [A, B]) await db.delete(featureFlags).where(eq(featureFlags.orgId, org)).catch(() => {});
  });

  await store.setFlag(key, true, 'on for A', A);
  await store.setFlag(key, false, 'off for B', B);

  assert.equal(await store.isEnabled(key, false, A), true, 'A flag ON');
  assert.equal(await store.isEnabled(key, true, B), false, 'B flag OFF — same key, isolated per org');
  assert.deepEqual((await store.listFlags(A)).find((f) => f.key === key)?.enabled, true, 'A list shows A value');

  // Deleting A's flag leaves B's intact.
  assert.equal(await store.deleteFlag(key, A), true, 'A flag deleted');
  assert.equal(await store.isEnabled(key, true, B), false, "B's same-key flag survives A's delete");
});

test('org_settings is per-tenant: system prompt + chat binding never shared', { skip }, async (t) => {
  const store = await import('@/lib/store');
  const { db } = await import('@/db');
  const { orgSettings } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  await store.ensureOrgSchema();

  t.after(async () => {
    for (const org of [A, B]) await db.delete(orgSettings).where(eq(orgSettings.id, org)).catch(() => {});
  });

  await store.setOrgSystemPrompt('A-prompt', 'a@test', A);
  await store.setOrgSystemPrompt('B-prompt', 'b@test', B);
  assert.equal(await store.getOrgSystemPrompt(A), 'A-prompt', 'A reads A prompt');
  assert.equal(await store.getOrgSystemPrompt(B), 'B-prompt', 'B reads B prompt — the shared-singleton leak is closed');

  await store.setChatBindingGovernance({ defaultChatPipelineId: 'pl_A', allowlist: ['pl_A'] }, 'a@test', A);
  await store.setChatBindingGovernance({ defaultChatPipelineId: 'pl_B', allowlist: ['pl_B'] }, 'b@test', B);
  assert.equal((await store.getChatBindingGovernance(A)).defaultChatPipelineId, 'pl_A', 'A binding isolated');
  assert.equal((await store.getChatBindingGovernance(B)).defaultChatPipelineId, 'pl_B', 'B binding isolated');
});
