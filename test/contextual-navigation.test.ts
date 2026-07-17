import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTEXTUAL_MODULES,
  contextualDestination,
  contextualDestinationForPath,
  contextualModule,
  contextualModuleForPath,
  defaultContextualDestination,
} from '../src/modules/contextual-navigation.ts';

test('Tools and Quality own a complete canonical level-3 route tree', () => {
  assert.deepEqual(
    contextualModule('solutions-tools').destinations.map(({ id, route }) => [id, route]),
    [
      ['registered', '/solutions/tools/registered'],
      ['catalog', '/solutions/tools/catalog'],
      ['primitives', '/solutions/tools/primitives'],
    ],
  );
  assert.deepEqual(
    contextualModule('solutions-quality').destinations.map(({ id, route }) => [id, route]),
    [
      ['evaluators', '/solutions/quality/evaluators'],
      ['golden-cases', '/solutions/quality/golden-cases'],
      ['runs', '/solutions/quality/runs'],
    ],
  );

  for (const module of CONTEXTUAL_MODULES) {
    assert.equal(module.destinations.length, 3);
    assert.equal(new Set(module.destinations.map((item) => item.route)).size, 3);
    assert.ok(module.destinations.every((item) => item.route.startsWith(`${module.baseRoute}/`)));
  }
});

test('active destination resolution is URL-driven and ignores query/hash decoration', () => {
  const tools = contextualModule('solutions-tools');
  assert.equal(contextualDestinationForPath(tools, '/solutions/tools/catalog')?.id, 'catalog');
  assert.equal(
    contextualDestinationForPath(tools, '/solutions/tools/catalog?q=postgres#results')?.id,
    'catalog',
  );
  assert.equal(contextualDestinationForPath(tools, '/solutions/tools')?.id, undefined);
  assert.equal(contextualDestinationForPath(tools, '/solutions/toolshed')?.id, undefined);

  assert.equal(
    contextualModuleForPath('/solutions/quality/runs?suite=ragas')?.id,
    'solutions-quality',
  );
  assert.equal(contextualModuleForPath('/solutions/quality/')?.id, 'solutions-quality');
  assert.equal(contextualModuleForPath('/solutions/qualities')?.id, undefined);
});

test('route ids validate before rendering and defaults are explicit', () => {
  const quality = contextualModule('solutions-quality');
  assert.equal(
    contextualDestination(quality, 'golden-cases')?.route,
    '/solutions/quality/golden-cases',
  );
  assert.equal(contextualDestination(quality, 'not-real'), undefined);
  assert.equal(contextualDestination(quality, undefined), undefined);
  assert.equal(defaultContextualDestination(quality).id, 'evaluators');
  assert.equal(defaultContextualDestination(contextualModule('solutions-tools')).id, 'registered');
});

test('the primary domain may start collapsed while an entered module exposes its context by default', () => {
  assert.ok(CONTEXTUAL_MODULES.every((module) => module.railDefaultOpen));
});
