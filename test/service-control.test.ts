import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findService,
  getServices,
  serviceControl,
  type ServiceEntry,
} from '../src/lib/services-directory.ts';

// PURE service-management honesty (Task C3). The console has NO service-control plane, so the
// detail view must be honest about who manages each service's lifecycle rather than showing a dead
// "Restart" button. These lock that mapping + the findService lookup the detail route uses.

const embedded: ServiceEntry = {
  id: 'lancedb', label: 'LanceDB', description: '', url: 'embedded://lancedb',
  auth: 'session', kind: 'api', probe: 'embedded',
};
const api: ServiceEntry = {
  id: 'qdrant', label: 'Qdrant', description: '', url: 'http://127.0.0.1:6333',
  auth: 'api-key', kind: 'api',
};
const consoleSvc: ServiceEntry = {
  id: 'console', label: 'Console', description: '', url: 'https://x', auth: 'session', kind: 'console',
};

test('nothing is restartable from the console today (honest, no dead buttons)', () => {
  for (const s of [embedded, api, consoleSvc]) {
    assert.equal(serviceControl(s).restartable, false);
  }
});

test('embedded backends explain they share the console lifecycle', () => {
  assert.match(serviceControl(embedded).managedBy, /in-process/i);
});

test('server-side services point at launchd / Docker on the host', () => {
  assert.match(serviceControl(api).managedBy, /launchd|Docker|host/i);
});

test('console explains it is the control plane itself', () => {
  assert.match(serviceControl(consoleSvc).managedBy, /control plane/i);
});

test('findService looks a service up by id from the real directory', () => {
  const all = getServices();
  const gw = findService(all, 'gateway');
  assert.ok(gw);
  assert.equal(gw?.id, 'gateway');
  assert.equal(findService(all, 'does-not-exist'), undefined);
});
