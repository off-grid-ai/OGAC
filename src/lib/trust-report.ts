// Trust & Security Center — pure report generator.
//
// SOLID: PURE. Takes the already-derived posture + summary + framings + artifacts and renders a
// self-contained Markdown "trust summary" a buyer can hand to procurement. No I/O — the export route
// collects the live snapshot, derives with trust-center.ts, then formats here. Unit-testable.
//
// HONESTY: the report shows in-progress / planned items verbatim, so the downloaded document never
// overstates posture. COPY RULE: no OSS-engine names — everything comes from the (capability-only)
// posture titles/details.

import {
  controlBriefs,
  PILLAR_LABELS,
  PILLARS,
  type ComplianceArtifact,
  type FramingRollup,
  type PostureItem,
  type PostureStatus,
  type TrustSummary,
} from '@/lib/trust-center';

const STATUS_LABEL: Record<PostureStatus, string> = {
  implemented: 'Implemented',
  'in-progress': 'In progress',
  planned: 'Planned',
  'not-applicable': 'Not applicable',
};

export interface ReportModel {
  summary: TrustSummary;
  posture: PostureItem[];
  framings: FramingRollup[];
  artifacts: ComplianceArtifact[];
}

export interface ReportOutput {
  filename: string;
  body: string;
}

export function buildTrustReport(model: ReportModel): ReportOutput {
  const { summary, posture, framings, artifacts } = model;
  const L: string[] = [];

  L.push('# Off Grid AI — Trust & Security Summary');
  L.push('');
  L.push(`Generated: ${summary.generatedAt}`);
  L.push(`Overall posture: ${summary.score}% of applicable controls implemented`);
  L.push(
    `Implemented: ${summary.totals.implemented} · In progress: ${summary.totals.inProgress} · Planned: ${summary.totals.planned}`,
  );
  L.push('');
  L.push(
    '> Posture is reported honestly: items still being hardened are shown as “In progress”, not claimed complete.',
  );
  L.push('');

  // Posture, grouped by pillar (skip the compliance-artifacts pillar — it has its own section).
  for (const pillar of PILLARS) {
    if (pillar === 'compliance-artifacts') continue;
    const items = posture.filter((p) => p.pillar === pillar);
    if (items.length === 0) continue;
    L.push(`## ${PILLAR_LABELS[pillar]}`);
    L.push('');
    for (const it of items) {
      L.push(`### ${it.title} — ${STATUS_LABEL[it.status]}`);
      L.push(it.detail);
      const briefs = controlBriefs(it.evidenceFor);
      if (briefs.length > 0) {
        L.push('');
        L.push(`Maps to: ${briefs.map((b) => `${b.ref} (${b.title})`).join('; ')}`);
      }
      L.push('');
    }
  }

  // Regulatory mapping — global frameworks are covered via the mapped controls; here we surface the
  // India-BFSI framings explicitly since they're the deal-gating ones for the target buyer.
  L.push('## Regulatory mapping — India BFSI');
  L.push('');
  for (const f of framings) {
    L.push(`### ${f.name} — ${f.regulator} — ${f.coverage}% evidenced`);
    L.push(f.summary);
    const briefs = controlBriefs(f.controlIds);
    if (briefs.length > 0) {
      L.push('');
      L.push('Mapped controls:');
      for (const b of briefs) L.push(`- ${b.ref} — ${b.title}`);
    }
    L.push('');
  }

  // Compliance-artifact checklist — honest statuses.
  L.push('## Compliance artifacts');
  L.push('');
  for (const a of artifacts) {
    L.push(`- **${a.name}** — ${a.status.toUpperCase()} — ${a.description}`);
  }
  L.push('');

  return { filename: 'offgrid-trust-summary.md', body: L.join('\n') };
}
