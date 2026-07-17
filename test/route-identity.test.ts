import assert from 'node:assert/strict';
import test from 'node:test';
import { routeIdentityForPath } from '../src/modules/route-identity.ts';

test('Tools and Quality leaves keep one stable module identity in the top bar', () => {
  assert.deepEqual(routeIdentityForPath('/solutions/tools/catalog'), {
    eyebrow: 'Solutions',
    title: 'Tools',
    description: 'Register, discover, and inspect every tool an app can call.',
    ownerId: 'tools',
    headingOwner: 'shell',
  });
  assert.deepEqual(routeIdentityForPath('/solutions/quality/golden-cases'), {
    eyebrow: 'Solutions',
    title: 'Quality',
    description: 'Define evaluators, maintain golden cases, and inspect quality runs.',
    ownerId: 'quality-definitions',
    headingOwner: 'shell',
  });
});

test('every owned route resolves identity from the canonical IA and unknown routes stay honest', () => {
  assert.equal(routeIdentityForPath('/work/projects/acme')?.title, 'Projects');
  assert.equal(routeIdentityForPath('/work/projects/acme')?.headingOwner, 'content');
  assert.equal(routeIdentityForPath('/solutions/test')?.title, 'Sandbox');
  assert.equal(routeIdentityForPath('/nowhere'), undefined);
});
