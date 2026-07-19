import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServiceCapabilityMap } from '../src/components/services/ServiceCapabilityMap.tsx';
import { SERVICE_CAPABILITY_AUDITS } from '../src/lib/service-capability-map.ts';
import { reconcileServiceInventory } from '../src/lib/service-inventory.ts';
import { getServices } from '../src/lib/services-directory.ts';

const ROOT = resolve(import.meta.dirname, '..');
const APP = resolve(ROOT, 'src/app/(console)');

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function inventory() {
  return reconcileServiceInventory({ platformServices: getServices() });
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
  assert.match(page, /reconcileServiceInventory/);
  assert.match(page, /getRuntimeServiceTopologyRegistry/);
  assert.match(page, /selectedServiceId=/);
  assert.match(component, /className="w-full space-y-6"/);
  assert.match(component, /CAPABILITY_GATES\.map/);
  assert.match(component, /<Table>/);
  assert.match(component, /<Progress/);
  assert.match(component, /Show all audited services/);
  assert.doesNotMatch(component, /mx-auto/);
});

test('audited service summary cards stack identity, metadata, and description without overlap', () => {
  const html = renderToStaticMarkup(
    createElement(ServiceCapabilityMap, {
      audits: SERVICE_CAPABILITY_AUDITS,
      inventory: inventory(),
      inventoryFilter: {},
      selectedServiceId: null,
    }),
  );

  assert.match(html, /sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5/);
  assert.equal((html.match(/data-capability-summary-card=/g) ?? []).length, 5);
  assert.equal((html.match(/data-capability-summary-identity=/g) ?? []).length, 5);
  assert.equal((html.match(/data-capability-summary-metadata=/g) ?? []).length, 5);
  assert.equal((html.match(/data-capability-summary-description=/g) ?? []).length, 5);
  assert.equal((html.match(/>version /g) ?? []).length, 5);
  assert.equal((html.match(/>source /g) ?? []).length, 5);
  assert.match(html, /col-span-full min-w-0/);
  assert.match(html, /flex min-w-0 flex-wrap/);
  assert.match(html, /max-w-full min-w-0 shrink whitespace-normal break-all/);
  assert.match(html, /leading-relaxed/);
  assert.match(html, /version 0\.116\.0 \(stale; deployed fleet 0\.156\.0\)/);
});

test('full inventory renders the exact 49/5/44 contract without inventing pending coverage', () => {
  const html = renderToStaticMarkup(
    createElement(ServiceCapabilityMap, {
      audits: SERVICE_CAPABILITY_AUDITS,
      inventory: inventory(),
      inventoryFilter: {},
      selectedServiceId: null,
    }),
  );

  assert.equal((html.match(/data-service-inventory-row=/g) ?? []).length, 49);
  assert.equal((html.match(/data-inventory-stat=/g) ?? []).length, 3);
  assert.match(html, /Total inventory<\/p><p[^>]*>49<\/p>/);
  assert.match(html, /Capability audited<\/p><p[^>]*>5<\/p>/);
  assert.match(html, /Audit pending<\/p><p[^>]*>44<\/p>/);
  assert.equal((html.match(/>audited<\/span>/g) ?? []).length, 5);
  assert.equal((html.match(/>pending<\/span>/g) ?? []).length, 44);
  assert.match(html, /43 platform entries live in Operations \/ Services/);
  assert.match(html, /Six enterprise systems live in Data/);
});

test('deep links distinguish a pending capability audit from an unknown service id', () => {
  const pendingHtml = renderToStaticMarkup(
    createElement(ServiceCapabilityMap, {
      audits: SERVICE_CAPABILITY_AUDITS,
      inventory: inventory(),
      inventoryFilter: {},
      selectedServiceId: 'postgres',
    }),
  );
  const unknownHtml = renderToStaticMarkup(
    createElement(ServiceCapabilityMap, {
      audits: SERVICE_CAPABILITY_AUDITS,
      inventory: inventory(),
      inventoryFilter: {},
      selectedServiceId: 'not-a-service',
    }),
  );

  assert.match(pendingHtml, /Console Database capability audit pending/);
  assert.match(pendingHtml, /No denominator or coverage percentage is assigned/);
  assert.doesNotMatch(pendingHtml, /Service not found/);
  assert.match(unknownHtml, /Service not found/);
  assert.match(unknownHtml, /not part of the reconciled service inventory/);
  assert.doesNotMatch(unknownHtml, /capability audit pending/);
});

test('inventory filtering is URL-backed, searchable, and preserves an audited selection', () => {
  const html = renderToStaticMarkup(
    createElement(ServiceCapabilityMap, {
      audits: SERVICE_CAPABILITY_AUDITS,
      inventory: inventory(),
      inventoryFilter: { query: 'telemetry', family: 'observability' },
      selectedServiceId: 'otel-collector',
    }),
  );

  assert.equal((html.match(/data-service-inventory-row=/g) ?? []).length, 1);
  assert.match(html, /data-service-inventory-row="otel-collector"/);
  assert.match(html, /action="\/operations\/services\/capability-map"/);
  assert.match(html, /name="q"/);
  assert.match(html, /name="family"/);
  assert.match(html, /name="owner"/);
  assert.match(html, /name="service" value="otel-collector"/);
  assert.match(html, /1\/49 entries/);
  assert.match(
    html,
    /href="\/operations\/services\/capability-map\?q=telemetry&amp;family=observability"[^>]*>Show all audited services/,
  );
  assert.match(
    html,
    /href="\/operations\/services\/capability-map\?service=evidently&amp;q=telemetry&amp;family=observability"/,
  );
  assert.match(
    html,
    /href="\/operations\/services\/capability-map\?service=otel-collector"[^>]*>Clear<\/a>/,
  );
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

test('every inventory row links to its existing canonical IA owner route', () => {
  const reconciled = inventory();
  const html = renderToStaticMarkup(
    createElement(ServiceCapabilityMap, {
      audits: SERVICE_CAPABILITY_AUDITS,
      inventory: reconciled,
      inventoryFilter: {},
      selectedServiceId: null,
    }),
  );

  for (const entry of reconciled.entries) {
    assert.equal(
      existsSync(routeModule(entry.routes.management)),
      true,
      `${entry.id} -> ${entry.routes.management}`,
    );
    assert.match(
      html,
      new RegExp(`href="${entry.routes.management.replaceAll('/', '\\/')}"`),
      `${entry.id} renders its canonical management link`,
    );
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
