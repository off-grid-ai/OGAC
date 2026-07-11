// ASYNC assembly: fetch the SAME live data sources the console dashboards use, resolve the tenant
// name from the org, build the tamper-evident provenance, then delegate the data → ReportDoc mapping
// to the PURE builders in build-doc.ts. This file is thin IO glue (no branching decision logic beyond
// "which family?"), proven by the report-pdf integration test + the verify:reports harness; the shape
// correctness lives in the pure, unit-tested build-doc.ts.
//
// Every builder takes a `now` (ISO) from the caller — builders never read ambient time. tenantName is
// resolved from the org id (org id === tenant id); provenance is derived AFTER render (the manifest
// hashes the bytes), so buildReportDoc renders once and returns { doc, bytes, filename }.
import { computeAnalytics } from '@/lib/analytics';
import { computeCompliance } from '@/lib/compliance';
import { listEvalRuns, listGoldenCases } from '@/lib/evals';
import { buildManifest } from '@/lib/provenance';
import { REGULATORS } from '@/lib/reports-spec';
import {
  buildAuditDoc,
  buildComplianceDoc,
  buildEvalDoc,
  buildInventoryDoc,
  buildRegulatorDoc,
  buildTrustDoc,
  type DataResidency,
  type DocMetaInput,
  type EvalCaseLine,
} from '@/lib/reports/build-doc';
import type { ReportDoc } from '@/lib/reports/model';
import { renderReportDoc } from '@/lib/reports/render';
import {
  getOrgPolicy,
  listConnectors,
  listDatasets,
  listDevices,
  listGovernance,
  listRoutingRules,
  listTenants,
} from '@/lib/store';
import {
  buildPosture,
  COMPLIANCE_ARTIFACTS,
  INDIA_BFSI_FRAMINGS,
  rollupFramings,
  summarisePosture,
} from '@/lib/trust-center';
import { collectPostureInputs } from '@/lib/trust-center-inputs';
import { DEFAULT_ORG } from '@/lib/tenancy';

// Every report family this builder can produce as a ReportDoc.
const REGULATOR_IDS = Object.keys(REGULATORS);
export function isReportDocId(id: string): boolean {
  return (
    REGULATOR_IDS.includes(id) ||
    ['compliance', 'trust', 'inventory', 'audit-summary', 'eval-report'].includes(id)
  );
}

/** Resolve the tenant display name for an org id (org id === tenant id). Falls back to a readable
 * label so the cover never shows a raw id or an empty string. */
async function tenantNameFor(orgId: string | undefined): Promise<string> {
  const id = orgId ?? DEFAULT_ORG;
  const tenants = await listTenants();
  const t = tenants.find((x) => x.id === id || x.slug === id);
  if (t?.name?.trim()) return t.name.trim();
  return id === DEFAULT_ORG ? 'Off Grid AI' : id;
}

function residencyFrom(
  policy: { egressAllowed: boolean; allowedModels: string[] },
  routes: { attribute: string; value: string; action: string; model: string }[],
): DataResidency {
  return {
    egressAllowed: policy.egressAllowed,
    allowedModels: policy.allowedModels,
    regionRules: routes
      .filter((r) => r.attribute === 'region')
      .map((r) => ({ value: r.value, action: r.action, model: r.model })),
  };
}

// ── Per-family async assembly (data + now → ReportDoc, provenance attached later) ────────────────────

async function assembleDoc(id: string, orgId: string | undefined, now: string): Promise<ReportDoc> {
  const tenantName = await tenantNameFor(orgId);
  const baseMeta = (extra: Partial<DocMetaInput> & Pick<DocMetaInput, 'title' | 'recipient' | 'classification' | 'filenameBase'>): DocMetaInput => ({
    tenantName,
    now,
    ...extra,
  });

  if (id in REGULATORS) {
    const spec = REGULATORS[id];
    const [compliance, governance, policy, datasets, devices, routes] = await Promise.all([
      computeCompliance(),
      listGovernance(orgId),
      getOrgPolicy(),
      listDatasets(orgId),
      listDevices(orgId),
      listRoutingRules(orgId),
    ]);
    return buildRegulatorDoc(
      {
        spec,
        compliance,
        governance: governance.map((g) => ({ title: g.title, kind: g.kind, status: g.status, owner: g.owner })),
        residency: residencyFrom(policy, routes),
        datasets: datasets.map((d) => ({ name: d.name, classification: d.classification, source: d.source, rows: d.rows })),
        deviceCount: devices.length,
      },
      baseMeta({
        title: `Regulator Response Pack — ${spec.name}`,
        subtitle: spec.frameworks.join(' · ').toUpperCase(),
        framework: spec.frameworks[0]?.toUpperCase(),
        recipient: { role: 'regulator', name: spec.name },
        classification: 'Confidential',
        filenameBase: `offgrid-regulator-${id}`,
      }),
    );
  }

  if (id === 'compliance') {
    const [compliance, governance] = await Promise.all([computeCompliance(), listGovernance(orgId)]);
    return buildComplianceDoc(
      { compliance, governance: governance.map((g) => ({ title: g.title, kind: g.kind, status: g.status, owner: g.owner })) },
      baseMeta({
        title: 'Compliance Evidence Pack',
        subtitle: 'DPDP · EU AI Act · ISO/IEC 42001 · GDPR',
        framework: 'DPDP Act 2023',
        recipient: { role: 'dpo', name: `${tenantName} Data Protection Officer` },
        classification: 'Confidential',
        filenameBase: 'offgrid-compliance-evidence',
      }),
    );
  }

  if (id === 'trust') {
    const inputs = await collectPostureInputs();
    const posture = buildPosture(inputs);
    const summary = summarisePosture(posture, now);
    const framings = rollupFramings(INDIA_BFSI_FRAMINGS, posture);
    return buildTrustDoc(
      { summary, posture, framings, artifacts: COMPLIANCE_ARTIFACTS },
      baseMeta({
        title: 'Trust & Security Summary',
        subtitle: 'Security posture · data & AI governance · compliance artifacts',
        recipient: { role: 'dpo', name: `${tenantName} Data Protection Officer` },
        classification: 'Confidential',
        filenameBase: 'offgrid-trust-summary',
      }),
    );
  }

  if (id === 'inventory') {
    const [policy, devices, connectors, datasets, routes] = await Promise.all([
      getOrgPolicy(),
      listDevices(orgId),
      listConnectors(orgId),
      listDatasets(orgId),
      listRoutingRules(orgId),
    ]);
    return buildInventoryDoc(
      {
        residency: residencyFrom(policy, routes),
        devices: devices.map((d) => ({ name: d.name, os: d.os, role: d.role, status: d.status })),
        connectors: connectors.map((c) => ({ name: c.name, type: c.type, status: c.status })),
        datasets: datasets.map((d) => ({ name: d.name, classification: d.classification, source: d.source, rows: d.rows })),
      },
      baseMeta({
        title: 'Model & Data Inventory',
        subtitle: 'Allowed models · enrolled devices · connected sources · datasets',
        recipient: { role: 'cdo', name: `${tenantName} Chief Data Officer` },
        classification: 'Internal',
        filenameBase: 'offgrid-inventory',
      }),
    );
  }

  if (id === 'audit-summary') {
    const analytics = await computeAnalytics();
    return buildAuditDoc(
      analytics,
      baseMeta({
        title: 'Audit & Usage Summary',
        subtitle: 'Volume · latency · outcomes · per-model · drift & performance',
        recipient: { role: 'cdo', name: `${tenantName} Chief Data Officer` },
        classification: 'Internal',
        filenameBase: 'offgrid-audit-summary',
      }),
    );
  }

  if (id === 'eval-report') {
    const [cases, runs] = await Promise.all([listGoldenCases(), listEvalRuns(1, orgId)]);
    const latest = runs[0];
    const caseLines: EvalCaseLine[] = cases.map((c) => {
      const r = latest?.results?.find((x) => x.query === c.query);
      const verdict: EvalCaseLine['verdict'] = r ? (r.pass ? 'pass' : 'fail') : 'na';
      return { query: c.query, expected: c.expected, verdict, top: r?.top ?? '' };
    });
    return buildEvalDoc(
      {
        caseCount: cases.length,
        latest: latest ? { passed: latest.passed, total: latest.total, score: latest.score } : undefined,
        cases: caseLines,
      },
      baseMeta({
        title: 'Retrieval Quality Report',
        subtitle: 'Golden-set evaluation of the retrieval brain',
        recipient: { role: 'internal', name: `${tenantName} AI Governance` },
        classification: 'Internal',
        filenameBase: 'offgrid-eval-report',
      }),
    );
  }

  throw new Error(`unknown report doc id: ${id}`);
}

export interface BuiltReport {
  doc: ReportDoc;
  bytes: Uint8Array;
  filename: string;
  manifest: ReturnType<typeof buildManifest>;
}

/** Build a report family into a ReportDoc (unvalidated — the caller validates before rendering).
 * Returns null for an id this builder does not own (caller falls back to the markdown/custom path). */
export async function buildReportDoc(
  id: string,
  orgId: string | undefined,
  now: string,
): Promise<ReportDoc | null> {
  if (!isReportDocId(id)) return null;
  return assembleDoc(id, orgId, now);
}

/** Full pipeline: build → render → hash the FINAL bytes → sign → return bytes + manifest. The
 * manifest's sha256 therefore always matches the returned bytes (verifiable end to end). The caller
 * (route) validates the doc BEFORE rendering. Returns null for an unknown id. */
export async function renderReportWithProvenance(
  id: string,
  orgId: string | undefined,
  now: string,
): Promise<BuiltReport | null> {
  const doc = await buildReportDoc(id, orgId, now);
  if (!doc) return null;
  const bytes = await renderReportDoc(doc);
  const filename = `${doc.filenameBase}.pdf`;
  const manifest = buildManifest(bytes, filename, 'application/pdf', now);
  return { doc, bytes, filename, manifest };
}
