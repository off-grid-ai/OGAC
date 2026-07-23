import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServiceCapabilityExplorer } from '../src/components/services/ServiceCapabilityExplorer.tsx';
import { SERVICE_CAPABILITY_AUDITS } from '../src/lib/service-capability-map.ts';
import {
  filterServiceInventory,
  reconcileServiceInventory,
  serviceInventoryAuditState,
  serviceInventoryReadinessState,
  type ServiceInventoryFilter,
  type ServiceInventoryReconciliation,
} from '../src/lib/service-inventory.ts';
import { getServices } from '../src/lib/services-directory.ts';

function inventory() {
  return reconcileServiceInventory({ platformServices: getServices() });
}

const PAGE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/app/(console)/operations/services/capability-map/page.tsx'),
  'utf8',
);

function renderExplorer(
  selectedServiceId: string | null = null,
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

test('capability explorer keeps the 49-entry inventory in an independently scrolling master pane', () => {
  const html = renderExplorer();

  assert.equal((html.match(/data-service-inventory-row=/g) ?? []).length, 49);
  assert.match(html, /aria-label="Service families"/);
  assert.match(html, /aria-label="Service capability inventory"/);
  assert.match(html, /aria-label="Selected service detail"/);
  assert.match(html, /lg:overflow-hidden/);
  assert.match(html, /lg:overflow-y-auto/);
  assert.match(html, /49-entry contract matched/);
  assert.match(html, /Choose a service to inspect its evidence/);
  assert.doesNotMatch(html, /mx-auto|max-w-2xl|max-w-3xl/);
});

test('narrow navigation renders either the service list or the selected detail with a filter-preserving back link', () => {
  const filtered = renderExplorer('otel-collector', {
    query: 'telemetry',
    family: 'observability',
    owner: 'operations-services',
    audit: 'current',
    readiness: 'verified',
  });
  const unselected = renderExplorer();

  assert.match(filtered, /class="hidden lg:flex[^\"]*" aria-label="Service capability inventory"/);
  assert.match(filtered, /class="block[^\"]*lg:overflow-y-auto" aria-label="Selected service detail"/);
  assert.match(filtered, /> Back to services<\/a>/);
  assert.match(
    filtered,
    /href="\/operations\/services\/capability-map\?q=telemetry&amp;family=observability&amp;owner=operations-services&amp;audit=current&amp;readiness=verified"/,
  );
  assert.match(unselected, /class="flex[^\"]*" aria-label="Service capability inventory"/);
  assert.match(unselected, /class="hidden lg:block[^\"]*" aria-label="Selected service detail"/);
  assert.doesNotMatch(unselected, /Back to services/);
});

test('audited capabilities use responsive records without an internally scrolling evidence table', () => {
  const audit = SERVICE_CAPABILITY_AUDITS.find((candidate) => candidate.serviceId === 'streaming');
  assert.ok(audit);
  const html = renderExplorer('streaming');

  assert.equal((html.match(/data-capability-record="/g) ?? []).length, audit.items.length);
  assert.match(html, /data-capability-records/);
  assert.match(html, /grid-cols-2[^\"]*sm:grid-cols-4/);
  assert.doesNotMatch(html, /data-slot="table-container"/);
  assert.doesNotMatch(html, /<table/);
  for (const gate of ['Available', 'Integrated', 'UI exposed', 'Used in workflow']) {
    assert.match(html, new RegExp(`>${gate}<`));
  }
  assert.match(html, /Concrete gap/);
  assert.match(html, /Open streaming service/);
});

test('filter navigation preserves facets while clearing the previous service selection', () => {
  const inventoryFilter = {
    query: 'telemetry',
    family: 'observability' as const,
    owner: 'operations-services' as const,
  };
  const reconciled = inventory();
  const expectedEntries = filterServiceInventory(reconciled.entries, inventoryFilter);
  const html = renderExplorer('otel-collector', inventoryFilter, reconciled);

  assert.equal((html.match(/data-service-inventory-row=/g) ?? []).length, expectedEntries.length);
  for (const entry of expectedEntries) {
    assert.match(html, new RegExp(`data-service-inventory-row="${entry.id}"`));
  }
  assert.doesNotMatch(html, /name="service" value="otel-collector"/);
  assert.match(html, /name="family" value="observability"/);
  assert.match(html, /name="q" value="telemetry"/);
  assert.match(html, /name="owner"/);
  assert.match(
    html,
    /href="\/operations\/services\/capability-map\?q=telemetry&amp;family=runtime&amp;owner=operations-services"/,
  );
  assert.match(
    html,
    /href="\/operations\/services\/capability-map\?q=telemetry&amp;family=observability&amp;owner=operations-services"[^>]*aria-current="page"/,
  );
});

test('filter controls keep search actions and facet widths in independent responsive grids', () => {
  const html = renderExplorer();

  assert.match(
    html,
    /role="group" aria-label="Service search controls" class="grid grid-cols-\[minmax\(0,1fr\)_auto\] gap-2"/,
  );
  assert.match(
    html,
    /role="group" aria-label="Service inventory filters" class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1"/,
  );
  assert.match(html, /placeholder="Search services"/);
  assert.match(html, />Both IA owners</);
  assert.match(html, />Any audit state</);
  assert.match(html, />Any readiness</);
});

test('audit and readiness facets narrow all 49 services and survive every explorer link', () => {
  const expectedEntries = inventory().entries.filter(
    (entry) =>
      serviceInventoryAuditState(entry) === 'stale' &&
      serviceInventoryReadinessState(entry) === 'unverified',
  );
  const html = renderExplorer('otel-collector', {
    audit: 'stale',
    readiness: 'unverified',
  });

  assert.equal((html.match(/data-service-inventory-row=/g) ?? []).length, expectedEntries.length);
  for (const entry of expectedEntries) {
    assert.match(html, new RegExp(`data-service-inventory-row="${entry.id}"`));
  }
  assert.match(html, /name="audit"[^>]*><option value="">Any audit state<\/option>/);
  assert.match(html, /<option value="stale" selected="">stale audit<\/option>/);
  assert.match(html, /<option value="unverified" selected="">not verified<\/option>/);
  assert.match(
    html,
    /href="\/operations\/services\/capability-map\?family=runtime&amp;audit=stale&amp;readiness=unverified"/,
  );
  for (const entry of expectedEntries) {
    assert.match(
      html,
      new RegExp(
        `href="\\/operations\\/services\\/capability-map\\?service=${entry.id}&amp;audit=stale&amp;readiness=unverified"`,
      ),
    );
  }
});

test('capability-map route validates audit and readiness search params before filtering', () => {
  assert.match(PAGE_SOURCE, /rawAudit = typeof params\.audit === 'string'/);
  assert.match(PAGE_SOURCE, /rawReadiness = typeof params\.readiness === 'string'/);
  assert.match(PAGE_SOURCE, /audit: isServiceInventoryAuditState\(rawAudit\)/);
  assert.match(PAGE_SOURCE, /readiness: isServiceInventoryReadinessState\(rawReadiness\)/);
});

test('audited, pending, and unknown service deep links render distinct detail states', () => {
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
  const audited = renderExplorer('otel-collector');
  const pending = renderExplorer(
    pendingEntry.id,
    {},
    pendingInventory,
    SERVICE_CAPABILITY_AUDITS.filter((audit) => audit.serviceId !== pendingEntry.id),
  );
  const unknown = renderExplorer('not-a-service');

  assert.match(audited, /Audited capabilities/);
  assert.match(audited, /OpenTelemetry Collector/);
  assert.match(audited, />Available</);
  assert.match(audited, /Used in workflow/);

  assert.ok(pending.includes(pendingEntry.label));
  assert.match(pending, /Capability audit<\/p><p[^>]*>Pending/);
  assert.match(pending, /No denominator or percentage is assigned/);
  assert.doesNotMatch(pending, /Audited capabilities/);

  assert.match(unknown, /Service not found/);
  assert.match(unknown, /not-a-service is not part of the reconciled service inventory/);
  assert.doesNotMatch(unknown, /Choose a service to inspect its evidence/);
});

test('every master-row selection is a shareable URL and the selected row exposes page semantics', () => {
  const reconciled = inventory();
  const html = renderExplorer('postgres');

  for (const entry of reconciled.entries) {
    assert.match(
      html,
      new RegExp(
        `href="\\/operations\\/services\\/capability-map\\?service=${entry.id.replaceAll('-', '\\-')}"`,
      ),
      `${entry.id} has a direct capability-map URL`,
    );
  }
  assert.match(
    html,
    /href="\/operations\/services\/capability-map\?service=postgres"[^>]*aria-current="page"/,
  );
});
