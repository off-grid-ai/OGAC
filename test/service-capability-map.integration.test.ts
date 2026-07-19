import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';
import { SERVICE_CAPABILITY_AUDITS } from '../src/lib/service-capability-map.ts';

const ROOT = resolve(import.meta.dirname, '..');
const APP = resolve(ROOT, 'src/app/(console)');

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function routeModule(pathnameWithQuery: string): string {
  const pathname = pathnameWithQuery.split('?')[0];
  const exact = resolve(APP, `.${pathname}/page.tsx`);
  if (existsSync(exact)) return exact;

  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'operations' && segments[1] === 'services' && segments.length === 3) {
    return resolve(APP, './operations/services/[serviceId]/page.tsx');
  }
  if (segments[0] === 'operations' && segments[1] === 'health' && segments.length === 3) {
    return resolve(APP, './operations/health/[destination]/page.tsx');
  }
  if (segments[0] === 'runtime' && segments[1] === 'models' && segments.length === 3) {
    return resolve(APP, './runtime/models/[destination]/page.tsx');
  }
  if (segments[0] === 'governance' && segments[1] === 'guardrails' && segments.length === 3) {
    return resolve(APP, './governance/guardrails/[destination]/page.tsx');
  }
  return exact;
}

test('capability map is a canonical, module-gated full-width operations route', () => {
  const page = source('src/app/(console)/operations/services/capability-map/page.tsx');
  const component = source('src/components/services/ServiceCapabilityMap.tsx');

  assert.match(page, /requireModuleForUser\('services'\)/);
  assert.match(page, /<PageFrame>/);
  assert.match(page, /SERVICE_CAPABILITY_AUDITS/);
  assert.match(page, /selectedServiceId=/);
  assert.match(component, /className="w-full space-y-6"/);
  assert.match(component, /CAPABILITY_GATES\.map/);
  assert.match(component, /<Table>/);
  assert.match(component, /<Progress/);
  assert.match(component, /Show all audited services/);
  assert.doesNotMatch(component, /mx-auto/);
});

test('every mapped capability links to an existing console route module', () => {
  for (const audit of SERVICE_CAPABILITY_AUDITS) {
    for (const item of audit.items) {
      const modulePath = routeModule(item.uiHref);
      assert.equal(
        existsSync(modulePath),
        true,
        `${audit.serviceId}/${item.id} -> ${item.uiHref} (${modulePath})`,
      );
    }
  }
});

test('Services directory exposes the map and labels unaudited entries without fake coverage', () => {
  const directory = source('src/components/services/ServicesDirectory.tsx');
  assert.match(directory, /href="\/operations\/services\/capability-map"/);
  assert.match(directory, /summarizeServiceCapabilityAudit\(s\.id\)/);
  assert.match(directory, /not audited/);
  assert.match(directory, /audit\.productionItems/);
  assert.doesNotMatch(directory, /not audited[^\n]+(?:0%|100%)/i);
});

test('audited service details deep-link to their filtered capability map', () => {
  const detail = source('src/components/services/ServiceDetail.tsx');
  assert.match(detail, /summarizeServiceCapabilityAudit\(service\.id\)/);
  assert.match(
    detail,
    /`\/operations\/services\/capability-map\?service=\$\{encodeURIComponent\(service\.id\)\}`/,
  );
  assert.match(detail, /capabilityAudit\.status === 'audited'/);
});

test('documentation defines the denominator, mutable-version rule, and systems of record', () => {
  const docs = source('docs/SERVICE_CAPABILITY_MAP.md');
  assert.match(docs, /## Denominator semantics/);
  assert.match(docs, /An unaudited service has no denominator/);
  assert.match(docs, /main-stable`, a mutable image tag/);
  assert.match(docs, /## Systems of record/);
  assert.match(docs, /onprem-fleet-orchestration/);
});
