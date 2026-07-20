import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServiceCapabilityExplorer } from '../src/components/services/ServiceCapabilityExplorer.tsx';
import { SERVICE_CAPABILITY_AUDITS } from '../src/lib/service-capability-map.ts';
import { reconcileServiceInventory } from '../src/lib/service-inventory.ts';
import { getServices } from '../src/lib/services-directory.ts';

function inventory() {
  return reconcileServiceInventory({ platformServices: getServices() });
}

function renderExplorer(
  selectedServiceId: string | null = null,
  inventoryFilter: { query?: string; family?: 'observability'; owner?: 'operations-services' } = {},
) {
  return renderToStaticMarkup(
    createElement(ServiceCapabilityExplorer, {
      audits: SERVICE_CAPABILITY_AUDITS,
      inventory: inventory(),
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

test('family navigation and service selection preserve URL-backed filter state', () => {
  const html = renderExplorer('otel-collector', {
    query: 'telemetry',
    family: 'observability',
    owner: 'operations-services',
  });

  assert.equal((html.match(/data-service-inventory-row=/g) ?? []).length, 1);
  assert.match(html, /data-service-inventory-row="otel-collector"/);
  assert.match(html, /name="service" value="otel-collector"/);
  assert.match(html, /name="family" value="observability"/);
  assert.match(html, /name="q" value="telemetry"/);
  assert.match(html, /name="owner"/);
  assert.match(
    html,
    /href="\/operations\/services\/capability-map\?service=otel-collector&amp;q=telemetry&amp;family=runtime&amp;owner=operations-services"/,
  );
  assert.match(
    html,
    /href="\/operations\/services\/capability-map\?service=otel-collector&amp;q=telemetry&amp;family=observability&amp;owner=operations-services"[^>]*aria-current="page"/,
  );
});

test('audited, pending, and unknown service deep links render distinct detail states', () => {
  const audited = renderExplorer('otel-collector');
  const pending = renderExplorer('postgres');
  const unknown = renderExplorer('not-a-service');

  assert.match(audited, /Audited capabilities/);
  assert.match(audited, /OpenTelemetry Collector/);
  assert.match(audited, />Available</);
  assert.match(audited, /Used in workflow/);

  assert.match(pending, /Console Database/);
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
