import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServiceCapabilityExplorer } from '../src/components/services/ServiceCapabilityExplorer.tsx';
import { SERVICE_CAPABILITY_AUDITS } from '../src/lib/service-capability-map.ts';
import {
  reconcileServiceInventory,
  serviceInventoryAuditState,
  type ServiceInventoryFilter,
  type ServiceInventoryReconciliation,
} from '../src/lib/service-inventory.ts';
import { getServices } from '../src/lib/services-directory.ts';

const ROOT = resolve(import.meta.dirname, '..');
const APP = resolve(ROOT, 'src/app/(console)');
const DYNAMIC_ROUTE_MODULES = new Map([
  ['data/lineage', './data/lineage/[destination]/page.tsx'],
  ['governance/guardrails', './governance/guardrails/[destination]/page.tsx'],
  ['governance/policies', './governance/policies/[destination]/page.tsx'],
  ['operations/health', './operations/health/[destination]/page.tsx'],
  ['operations/edge', './operations/edge/[destination]/page.tsx'],
  ['operations/services', './operations/services/[serviceId]/page.tsx'],
  ['runtime/models', './runtime/models/[destination]/page.tsx'],
  ['solutions/quality', './solutions/quality/[destination]/page.tsx'],
]);

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function inventory() {
  return reconcileServiceInventory({ platformServices: getServices() });
}

function renderExplorer(
  selectedServiceId: string | null,
  inventoryFilter: ServiceInventoryFilter = {},
  reconciled: ServiceInventoryReconciliation = inventory(),
  audits = SERVICE_CAPABILITY_AUDITS,
) {
  return renderToStaticMarkup(
    createElement(ServiceCapabilityExplorer, {
      audits,
      inventory: reconciled,
      inventoryFilter,
      selectedServiceId,
    }),
  );
}

function routeModule(pathnameWithQuery: string): string {
  const pathname = pathnameWithQuery.split('?')[0];
  const exact = resolve(APP, `.${pathname}/page.tsx`);
  if (existsSync(exact)) return exact;

  const segments = pathname.split('/').filter(Boolean);
  const dynamicModule = DYNAMIC_ROUTE_MODULES.get(segments.slice(0, 2).join('/'));
  if (segments.length === 3 && dynamicModule) return resolve(APP, dynamicModule);
  return exact;
}

test('capability map is a canonical, module-gated full-width operations route', () => {
  const page = source('src/app/(console)/operations/services/capability-map/page.tsx');
  const component = source('src/components/services/ServiceCapabilityExplorer.tsx');

  assert.match(page, /requireModuleForUser\('services'\)/);
  assert.match(page, /<PageFrame>/);
  assert.match(page, /SERVICE_CAPABILITY_AUDITS/);
  assert.match(page, /reconcileServiceInventory/);
  assert.match(page, /listLiveServiceTopologies/);
  assert.match(page, /platformServices: topology\.map\(\(entry\) => entry\.service\)/);
  assert.match(page, /topologies: topology/);
  assert.match(page, /selectedServiceId=/);
  assert.match(component, /h-full min-h-0 w-full/);
  assert.match(component, /CAPABILITY_GATES\.map/);
  assert.match(component, /data-capability-records/);
  assert.doesNotMatch(component, /<Table>/);
  assert.match(component, /<Progress/);
  assert.match(component, /aria-label="Service families"/);
  assert.match(component, /aria-label="Service families" className="flex min-w-0 flex-wrap gap-1"/);
  assert.doesNotMatch(component, /aria-label="Service families"[^>]*overflow-x-auto/);
  assert.match(component, /max-h-\[55vh\][^\"]*overflow-hidden/);
  assert.match(component, /min-h-0 flex-1 overflow-y-auto/);
  assert.doesNotMatch(component, /mx-auto/);
});

test('the explorer renders the exact 48-entry audit contract without inventing pending coverage', () => {
  const reconciled = inventory();
  const html = renderExplorer(null);
  const auditCounts = reconciled.entries.reduce(
    (counts, entry) => {
      counts[serviceInventoryAuditState(entry)] += 1;
      return counts;
    },
    { current: 0, stale: 0, pending: 0 },
  );

  assert.equal((html.match(/data-service-inventory-row=/g) ?? []).length, 48);
  assert.equal(
    auditCounts.current,
    SERVICE_CAPABILITY_AUDITS.filter((audit) => audit.auditState === 'current').length,
  );
  assert.equal(
    auditCounts.stale,
    SERVICE_CAPABILITY_AUDITS.filter((audit) => audit.auditState === 'stale').length,
  );
  assert.equal(auditCounts.pending, reconciled.totalCount - SERVICE_CAPABILITY_AUDITS.length);
  assert.deepEqual(
    reconciled.entries
      .filter((entry) => entry.capabilityAudit.status === 'audited')
      .map((entry) => entry.id)
      .sort(),
    SERVICE_CAPABILITY_AUDITS.map((audit) => audit.serviceId).sort(),
  );
  assert.equal((html.match(/data-inventory-stat=/g) ?? []).length, 4);
  assert.match(html, /Inventory<\/p><p[^>]*>48<\/p>/);
  assert.match(html, new RegExp(`Current audits<\\/p><p[^>]*>${auditCounts.current}<\\/p>`));
  assert.match(html, new RegExp(`Stale audits<\\/p><p[^>]*>${auditCounts.stale}<\\/p>`));
  assert.match(html, new RegExp(`Pending audits<\\/p><p[^>]*>${auditCounts.pending}<\\/p>`));
  assert.equal((html.match(/data-audit-state="current"/g) ?? []).length, auditCounts.current);
  assert.equal((html.match(/data-audit-state="stale"/g) ?? []).length, auditCounts.stale);
  assert.equal((html.match(/data-audit-state="pending"/g) ?? []).length, auditCounts.pending);
});

test('enterprise-source master state and selected audit detail use the same canonical evidence', () => {
  const html = renderExplorer('enterprise-source-corebank');

  assert.match(
    html,
    /data-service-inventory-row="enterprise-source-corebank"[\s\S]*?data-audit-state="stale"/,
  );
  assert.match(html, /Core Banking/);
  assert.match(html, /Audited capabilities/);
  assert.doesNotMatch(html, /Capability audit<\/p><p[^>]*>Pending/);
});

test('deep links distinguish a pending capability audit from an unknown service id', () => {
  const reconciled = inventory();
  const pendingEntry = reconciled.entries[0];
  assert.ok(pendingEntry);
  const pendingInventory = {
    ...reconciled,
    entries: reconciled.entries.map((entry) =>
      entry.id === pendingEntry.id
        ? { ...entry, capabilityAudit: { status: 'not-audited' as const } }
        : entry,
    ),
  };
  const pendingHtml = renderExplorer(
    pendingEntry.id,
    {},
    pendingInventory,
    SERVICE_CAPABILITY_AUDITS.filter((audit) => audit.serviceId !== pendingEntry.id),
  );
  const unknownHtml = renderExplorer('not-a-service');

  assert.ok(pendingHtml.includes(pendingEntry.label));
  assert.match(pendingHtml, /Capability audit<\/p><p[^>]*>Pending/);
  assert.match(pendingHtml, /No denominator or percentage is assigned/);
  assert.doesNotMatch(pendingHtml, /Service not found/);
  assert.match(unknownHtml, /Service not found/);
  assert.match(unknownHtml, /not part of the reconciled service inventory/);
  assert.doesNotMatch(unknownHtml, /Capability audit<\/p><p[^>]*>Pending/);
});

test('inventory filtering is URL-backed and preserves selection plus every facet', () => {
  const html = renderExplorer('otel-collector', {
    query: 'telemetry',
    family: 'observability',
    owner: 'operations-services',
    audit: 'stale',
    readiness: 'unverified',
  });

  assert.equal((html.match(/data-service-inventory-row=/g) ?? []).length, 1);
  assert.match(html, /data-service-inventory-row="otel-collector"/);
  assert.match(html, /action="\/operations\/services\/capability-map"/);
  assert.match(html, /name="q"/);
  assert.match(html, /name="family" value="observability"/);
  assert.match(html, /name="owner"/);
  assert.match(html, /name="audit"/);
  assert.match(html, /name="readiness"/);
  assert.doesNotMatch(html, /name="service" value="otel-collector"/);
  assert.match(html, /1\/48 services shown/);
  assert.match(
    html,
    /href="\/operations\/services\/capability-map\?q=telemetry&amp;family=runtime&amp;owner=operations-services&amp;audit=stale&amp;readiness=unverified"/,
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

test('every inventory detail links to its existing canonical IA owner route', () => {
  const reconciled = inventory();
  for (const entry of reconciled.entries) {
    assert.equal(
      existsSync(routeModule(entry.routes.management)),
      true,
      `${entry.id} -> ${entry.routes.management}`,
    );
    const html = renderExplorer(entry.id);
    assert.match(
      html,
      new RegExp(`href="${entry.routes.management.replaceAll('/', '\\/')}"`),
      `${entry.id} detail renders its canonical management link`,
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

test('the scrolling legacy component is removed so the explorer has one presentation owner', () => {
  assert.equal(
    existsSync(resolve(ROOT, 'src/components/services/ServiceCapabilityMap.tsx')),
    false,
  );
  const page = source('src/app/(console)/operations/services/capability-map/page.tsx');
  assert.doesNotMatch(page, /components\/services\/ServiceCapabilityMap|<ServiceCapabilityMap\b/);
  assert.match(page, /ServiceCapabilityExplorer/);
});

test('documentation defines the denominator, mutable-version rule, and systems of record', () => {
  const docs = source('docs/SERVICE_CAPABILITY_MAP.md');
  assert.match(docs, /## Denominator semantics/);
  assert.match(docs, /An unaudited service has no denominator/);
  assert.match(docs, /main-stable`, a mutable image tag/);
  assert.match(docs, /## Systems of record/);
  assert.match(docs, /onprem-fleet-orchestration/);
});
