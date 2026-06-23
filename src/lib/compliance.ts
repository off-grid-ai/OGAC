import { googleEnabled, microsoftEnabled } from '@/auth.config';
import { getOrgPolicy, listAudit, listMaskingRules, listUsers } from '@/lib/store';

export type Status = 'satisfied' | 'partial' | 'gap';

export interface ControlStatus {
  id: string;
  name: string;
  status: Status;
  evidence: string;
}

export interface FrameworkCoverage {
  id: string;
  name: string;
  coverage: number;
  controlIds: string[];
}

export interface Compliance {
  generatedAt: string;
  posture: number;
  controls: ControlStatus[];
  frameworks: FrameworkCoverage[];
}

const FRAMEWORKS = [
  {
    id: 'dpdp',
    name: 'DPDP Act 2023 (India)',
    controlIds: ['pii-masking', 'erasure', 'audit', 'rbac', 'egress-dlp'],
  },
  {
    id: 'eu-ai-act',
    name: 'EU AI Act',
    controlIds: ['audit', 'grounding', 'input-guardrails', 'rbac'],
  },
  {
    id: 'iso-42001',
    name: 'ISO/IEC 42001',
    controlIds: ['audit', 'rbac', 'input-guardrails', 'grounding', 'identity'],
  },
  { id: 'gdpr', name: 'GDPR', controlIds: ['pii-masking', 'erasure', 'audit', 'rbac'] },
  {
    id: 'nist-ai-rmf',
    name: 'NIST AI RMF',
    controlIds: ['audit', 'grounding', 'input-guardrails', 'rbac'],
  },
  {
    id: 'hipaa',
    name: 'HIPAA',
    controlIds: ['pii-masking', 'erasure', 'audit', 'rbac', 'identity'],
  },
  { id: 'dora', name: 'DORA', controlIds: ['audit', 'rbac', 'egress-dlp', 'identity'] },
  {
    id: 'occ-sr-11-7',
    name: 'OCC SR 11-7 (model risk)',
    controlIds: ['audit', 'grounding', 'rbac', 'input-guardrails'],
  },
] as const;

function pick<T>(ok: boolean, yes: T, no: T): T {
  return ok ? yes : no;
}

function maskStatus(enabled: number, total: number): Status {
  if (enabled === 0) return 'gap';
  return enabled === total ? 'satisfied' : 'partial';
}

function ctl(id: string, name: string, status: Status, evidence: string): ControlStatus {
  return { id, name, status, evidence };
}

async function computeControls(): Promise<ControlStatus[]> {
  const [policy, rules, users, audit] = await Promise.all([
    getOrgPolicy(),
    listMaskingRules(),
    listUsers(),
    listAudit({ limit: 5000 }),
  ]);
  const enabled = rules.filter((r) => r.enabled).length;
  const roles = [...new Set(users.map((u) => u.role))];
  const g = policy.guardrails;
  const ssoOk = googleEnabled || microsoftEnabled;
  const guardOk = g.includes('injection-scan') || g.includes('pii-input');
  const groundOk = g.includes('grounding');

  return [
    ctl(
      'audit',
      'Audit trail (C7)',
      pick(audit.length > 0, 'satisfied', 'gap'),
      `${audit.length} events recorded`,
    ),
    ctl(
      'rbac',
      'Access control / RBAC (C5)',
      pick(roles.length > 1, 'satisfied', 'partial'),
      `${users.length} users · roles: ${roles.join(', ') || 'none'}`,
    ),
    ctl(
      'pii-masking',
      'PII masking (A9)',
      maskStatus(enabled, rules.length),
      `${enabled}/${rules.length} rules enabled`,
    ),
    ctl(
      'egress-dlp',
      'Egress / DLP (C16)',
      'satisfied',
      pick(policy.egressAllowed, 'cloud egress allowed (leashed)', 'cloud egress blocked'),
    ),
    ctl(
      'input-guardrails',
      'Input guardrails (C2)',
      pick(guardOk, 'satisfied', 'gap'),
      g.join(', ') || 'none',
    ),
    ctl(
      'grounding',
      'Output grounding (C3)',
      pick(groundOk, 'satisfied', 'partial'),
      pick(groundOk, 'grounding enforced', 'not enforced'),
    ),
    ctl('erasure', 'Right-to-erasure (A12a)', 'satisfied', 'DSAR endpoint available'),
    ctl(
      'identity',
      'Identity / SSO (C4)',
      pick(ssoOk, 'satisfied', 'partial'),
      pick(ssoOk, 'SSO configured', 'dev login only'),
    ),
  ];
}

function score(s: Status): number {
  if (s === 'satisfied') return 1;
  return s === 'partial' ? 0.5 : 0;
}

export async function computeCompliance(): Promise<Compliance> {
  const controls = await computeControls();
  const byId = new Map(controls.map((c) => [c.id, c]));
  const frameworks: FrameworkCoverage[] = FRAMEWORKS.map((f) => {
    const cs = f.controlIds.map((id) => byId.get(id)).filter((c): c is ControlStatus => Boolean(c));
    const cov = Math.round((cs.reduce((a, c) => a + score(c.status), 0) / cs.length) * 100);
    return { id: f.id, name: f.name, coverage: cov, controlIds: [...f.controlIds] };
  });
  const posture = Math.round(
    (controls.reduce((a, c) => a + score(c.status), 0) / controls.length) * 100,
  );
  return { generatedAt: new Date().toISOString(), posture, controls, frameworks };
}

export async function buildExport(
  frameworkId?: string,
): Promise<{ filename: string; body: string }> {
  const c = await computeCompliance();
  const frameworks = frameworkId ? c.frameworks.filter((f) => f.id === frameworkId) : c.frameworks;
  const lines: string[] = [];
  lines.push(`# Off Grid — Compliance Evidence Pack`);
  lines.push(`Generated: ${c.generatedAt}`);
  lines.push(`Overall posture: ${c.posture}%`);
  lines.push('');
  for (const f of frameworks) {
    lines.push(`## ${f.name} — ${f.coverage}% coverage`);
    for (const id of f.controlIds) {
      const ctrl = c.controls.find((x) => x.id === id);
      if (ctrl) lines.push(`- **${ctrl.name}** — ${ctrl.status.toUpperCase()} — ${ctrl.evidence}`);
    }
    lines.push('');
  }
  lines.push(`## All controls`);
  for (const ctrl of c.controls) {
    lines.push(`- **${ctrl.name}** — ${ctrl.status.toUpperCase()} — ${ctrl.evidence}`);
  }
  const suffix = frameworkId ? `-${frameworkId}` : '';
  return { filename: `offgrid-compliance${suffix}.md`, body: lines.join('\n') };
}
