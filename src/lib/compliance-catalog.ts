// Compliance framework + control catalog — the bundled, ships-with-the-product control library
// for the Regulatory module (same "bundle the ecosystem catalog" pattern as evals/tools/guardrails).
//
// SOLID seam: EVERYTHING in this file is pure and dependency-free (no Next / auth / DB / aliases).
// The catalog (three real frameworks), the cross-framework mapping, the coverage math, and the
// status-transition rule all unit-test in isolation with zero mocks. The org's ADOPTION state
// (which frameworks are tracked, each control's status) lives in a separate I/O lib
// (compliance-adoption.ts) behind a self-creating table; this file never touches it.
//
// GROUNDING: control titles + framework refs are accurate to the real published frameworks —
// ISO/IEC 42001 Annex A control objectives, NIST AI RMF (GOVERN/MAP/MEASURE/MANAGE), and the
// EU AI Act obligation articles. Descriptions are plain-language for a non-lawyer, not legal text.
// A representative control set per framework (not exhaustive legal enumeration). No fabricated
// article numbers — every `ref` is a real clause/article/subcategory in its framework.

// ─── Types ──────────────────────────────────────────────────────────────────

export type FrameworkId = 'iso-42001' | 'nist-ai-rmf' | 'eu-ai-act';

export interface CatalogControl {
  id: string; // stable slug, unique within a framework (e.g. 'iso-a7-data-governance')
  ref: string; // the real framework reference (e.g. 'Annex A.7', 'MAP 2.1', 'Art. 10')
  title: string; // the real control title
  description: string; // plain-language, for a non-lawyer
  mapsTo: string[]; // control ids in OTHER frameworks this control also satisfies
}

export interface CatalogFramework {
  id: FrameworkId;
  name: string;
  authority: string; // who publishes it
  summary: string; // one-line, plain-language
  controls: CatalogControl[];
}

// ─── The catalog (three real frameworks) ─────────────────────────────────────

const ISO_42001: CatalogFramework = {
  id: 'iso-42001',
  name: 'ISO/IEC 42001',
  authority: 'ISO/IEC',
  summary:
    'The AI management-system standard. Annex A is the canonical control library for governing AI responsibly across its lifecycle.',
  controls: [
    {
      id: 'iso-a2-ai-policy',
      ref: 'Annex A.2',
      title: 'AI policy',
      description:
        'Have a written, approved policy that states how the organisation develops and uses AI, and keep it reviewed.',
      mapsTo: ['nist-govern-1-1', 'eu-art-9-risk-mgmt'],
    },
    {
      id: 'iso-a3-roles',
      ref: 'Annex A.3',
      title: 'Internal organisation — roles & responsibilities',
      description:
        'Assign clear owners and accountabilities for AI systems so someone is answerable for each one.',
      mapsTo: ['nist-govern-2-1'],
    },
    {
      id: 'iso-a4-resources',
      ref: 'Annex A.4',
      title: 'Resources for AI systems',
      description:
        'Document the data, tooling, compute and people each AI system depends on so it can be run and audited.',
      mapsTo: ['nist-map-1-1'],
    },
    {
      id: 'iso-a5-impact-assessment',
      ref: 'Annex A.5',
      title: 'Assessing impacts of AI systems',
      description:
        'Assess the impact of an AI system on individuals and society (a DPIA/AI-impact assessment) before and during use.',
      mapsTo: ['nist-map-1-1', 'eu-art-9-risk-mgmt', 'eu-risk-tier'],
    },
    {
      id: 'iso-a6-lifecycle',
      ref: 'Annex A.6',
      title: 'AI system lifecycle management',
      description:
        'Manage the whole lifecycle — design, development, verification, deployment, operation, retirement — with documented gates.',
      mapsTo: ['nist-manage-1-1', 'eu-art-11-technical-docs', 'eu-art-15-accuracy'],
    },
    {
      id: 'iso-a7-data-governance',
      ref: 'Annex A.7',
      title: 'Data for AI systems (data governance)',
      description:
        'Govern the data used to build and run AI: provenance, quality, and appropriate handling of personal data.',
      mapsTo: ['nist-map-2-1', 'eu-art-10-data-gov'],
    },
    {
      id: 'iso-a8-transparency',
      ref: 'Annex A.8',
      title: 'Information for interested parties (transparency)',
      description:
        'Give users and affected people the information they need about the AI system — what it does and its limits.',
      mapsTo: ['nist-measure-2-1', 'eu-art-13-transparency'],
    },
    {
      id: 'iso-a9-human-oversight',
      ref: 'Annex A.9',
      title: 'Use of AI systems — human oversight',
      description:
        'Keep a human able to understand, intervene in, and override the AI system when it matters.',
      mapsTo: ['nist-manage-2-1', 'eu-art-14-oversight'],
    },
    {
      id: 'iso-a10-third-party',
      ref: 'Annex A.10',
      title: 'Third-party and customer relationships',
      description:
        'Manage suppliers and customers of AI — allocate responsibilities and require the same standards down the chain.',
      mapsTo: ['nist-govern-6-1'],
    },
  ],
};

const NIST_AI_RMF: CatalogFramework = {
  id: 'nist-ai-rmf',
  name: 'NIST AI RMF',
  authority: 'NIST (US)',
  summary:
    'A voluntary risk-management framework organised into four functions — GOVERN, MAP, MEASURE, MANAGE — with categories and subcategories.',
  controls: [
    {
      id: 'nist-govern-1-1',
      ref: 'GOVERN 1.1',
      title: 'Legal & policy requirements are understood and managed',
      description:
        'Know which laws and policies apply to your AI and build managing them into how the organisation runs.',
      mapsTo: ['iso-a2-ai-policy', 'eu-art-9-risk-mgmt'],
    },
    {
      id: 'nist-govern-2-1',
      ref: 'GOVERN 2.1',
      title: 'Roles, responsibilities & accountability are documented',
      description: 'Write down who is accountable for AI risk decisions across the organisation.',
      mapsTo: ['iso-a3-roles'],
    },
    {
      id: 'nist-govern-6-1',
      ref: 'GOVERN 6.1',
      title: 'Third-party risks are addressed',
      description:
        'Manage risks that come from vendors, models, and data you did not build yourself.',
      mapsTo: ['iso-a10-third-party'],
    },
    {
      id: 'nist-map-1-1',
      ref: 'MAP 1.1',
      title: 'Context is established and understood',
      description:
        'Understand the intended purpose, setting, and people affected by the AI system before building it.',
      mapsTo: ['iso-a4-resources', 'iso-a5-impact-assessment'],
    },
    {
      id: 'nist-map-2-1',
      ref: 'MAP 2.1',
      title: 'AI system tasks, data, and knowledge limits are defined',
      description: 'Define what the system does, what data it uses, and where its knowledge stops.',
      mapsTo: ['iso-a7-data-governance', 'eu-art-10-data-gov'],
    },
    {
      id: 'nist-measure-2-1',
      ref: 'MEASURE 2.1',
      title: 'Test sets and metrics are documented',
      description:
        'Measure the system with documented test data and metrics so its behaviour is evidenced, not assumed.',
      mapsTo: ['iso-a8-transparency', 'eu-art-15-accuracy'],
    },
    {
      id: 'nist-measure-2-7',
      ref: 'MEASURE 2.7',
      title: 'Security and resilience are evaluated',
      description:
        'Test the system against attacks and failure — prompt injection, data poisoning, and robustness.',
      mapsTo: ['eu-art-15-accuracy'],
    },
    {
      id: 'nist-manage-1-1',
      ref: 'MANAGE 1.1',
      title: 'Risks are prioritised and responded to',
      description: 'Decide which AI risks matter most and act on them — accept, mitigate, or stop.',
      mapsTo: ['iso-a6-lifecycle', 'eu-art-9-risk-mgmt'],
    },
    {
      id: 'nist-manage-2-1',
      ref: 'MANAGE 2.1',
      title: 'Mechanisms to sustain AI systems are in place',
      description:
        'Keep the system safe in operation — monitoring, human fallback, and the ability to turn it off.',
      mapsTo: ['iso-a9-human-oversight', 'eu-art-14-oversight'],
    },
    {
      id: 'nist-manage-4-1',
      ref: 'MANAGE 4.1',
      title: 'Post-deployment monitoring is planned',
      description:
        'Monitor the system after launch and feed what you learn back into managing its risk.',
      mapsTo: ['iso-a6-lifecycle', 'eu-art-12-logging'],
    },
  ],
};

const EU_AI_ACT: CatalogFramework = {
  id: 'eu-ai-act',
  name: 'EU AI Act',
  authority: 'European Union',
  summary:
    'Risk-tiered law (prohibited / high-risk / limited / minimal). High-risk systems carry the core obligations captured below.',
  controls: [
    {
      id: 'eu-risk-tier',
      ref: 'Title II–III',
      title: 'Risk classification of the AI system',
      description:
        'Classify each system into a risk tier — prohibited, high-risk, limited, or minimal — because the obligations follow the tier.',
      mapsTo: ['iso-a5-impact-assessment'],
    },
    {
      id: 'eu-art-9-risk-mgmt',
      ref: 'Art. 9',
      title: 'Risk management system',
      description:
        'Run a continuous risk-management process across the AI system’s lifecycle for high-risk systems.',
      mapsTo: ['iso-a2-ai-policy', 'nist-govern-1-1', 'nist-manage-1-1'],
    },
    {
      id: 'eu-art-10-data-gov',
      ref: 'Art. 10',
      title: 'Data and data governance',
      description:
        'Use training/validation/test data that is relevant, representative, and error-checked, with governance over it.',
      mapsTo: ['iso-a7-data-governance', 'nist-map-2-1'],
    },
    {
      id: 'eu-art-11-technical-docs',
      ref: 'Art. 11',
      title: 'Technical documentation',
      description:
        'Keep technical documentation that shows the system meets the requirements — drawn up before it goes to market.',
      mapsTo: ['iso-a6-lifecycle'],
    },
    {
      id: 'eu-art-12-logging',
      ref: 'Art. 12',
      title: 'Record-keeping (logging)',
      description:
        'Automatically log events over the system’s lifetime so its operation is traceable.',
      mapsTo: ['nist-manage-4-1'],
    },
    {
      id: 'eu-art-13-transparency',
      ref: 'Art. 13',
      title: 'Transparency & information to users',
      description:
        'Make the system transparent enough for deployers to interpret its output and use it correctly.',
      mapsTo: ['iso-a8-transparency', 'nist-measure-2-1'],
    },
    {
      id: 'eu-art-14-oversight',
      ref: 'Art. 14',
      title: 'Human oversight',
      description:
        'Design the system so people can effectively oversee it and step in — including a stop control.',
      mapsTo: ['iso-a9-human-oversight', 'nist-manage-2-1'],
    },
    {
      id: 'eu-art-15-accuracy',
      ref: 'Art. 15',
      title: 'Accuracy, robustness & cybersecurity',
      description:
        'Achieve an appropriate level of accuracy and resilience against errors, faults, and attacks.',
      mapsTo: ['nist-measure-2-1', 'nist-measure-2-7', 'iso-a6-lifecycle'],
    },
  ],
};

export const CATALOG: CatalogFramework[] = [ISO_42001, NIST_AI_RMF, EU_AI_ACT];

// ─── Derived lookups & cross-map ──────────────────────────────────────────────

export interface CrossMapEntry {
  control: { framework: FrameworkId; id: string; ref: string; title: string };
  satisfies: { framework: FrameworkId; id: string; ref: string; title: string }[];
}

const ALL_CONTROLS: { framework: FrameworkId; control: CatalogControl }[] = CATALOG.flatMap((f) =>
  f.controls.map((control) => ({ framework: f.id, control })),
);

const CONTROL_INDEX = new Map(ALL_CONTROLS.map((c) => [c.control.id, c]));

export function getFramework(id: FrameworkId): CatalogFramework | undefined {
  return CATALOG.find((f) => f.id === id);
}

export function findControl(
  id: string,
): { framework: FrameworkId; control: CatalogControl } | undefined {
  return CONTROL_INDEX.get(id);
}

// A control id belongs to the catalog iff it's in the index — used to validate adoption/status writes.
export function isKnownControl(id: string): boolean {
  return CONTROL_INDEX.has(id);
}

export function isKnownFramework(id: string): id is FrameworkId {
  return CATALOG.some((f) => f.id === id);
}

// The full cross-framework mapping: for every control, the equivalent controls it also satisfies.
// Symmetric — if A.mapsTo includes B, the entry for B also lists A. Mappings are declared one-way
// in the catalog for brevity; we complete the closure here so the UI can show it from either side.
export function buildCrossMap(): CrossMapEntry[] {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const { control } of ALL_CONTROLS) {
    for (const other of control.mapsTo) {
      if (!CONTROL_INDEX.has(other)) continue; // ignore any stale ref
      link(control.id, other);
      link(other, control.id);
    }
  }
  const brief = (id: string): CrossMapEntry['satisfies'][number] => {
    const e = CONTROL_INDEX.get(id)!;
    return { framework: e.framework, id, ref: e.control.ref, title: e.control.title };
  };
  return ALL_CONTROLS.filter(({ control }) => (adj.get(control.id)?.size ?? 0) > 0).map(
    ({ framework, control }) => ({
      control: { framework, id: control.id, ref: control.ref, title: control.title },
      satisfies: [...(adj.get(control.id) ?? [])].sort().map(brief),
    }),
  );
}

// The controls another framework's controls satisfy for a single control id (symmetric closure).
export function crossMapFor(id: string): CrossMapEntry['satisfies'] {
  const entry = buildCrossMap().find((e) => e.control.id === id);
  return entry ? entry.satisfies : [];
}

// ─── Status model (pure transition rule) ─────────────────────────────────────

export const CONTROL_STATUSES = ['new', 'in-progress', 'met'] as const;
export type ControlTrackStatus = (typeof CONTROL_STATUSES)[number];

export function isControlStatus(v: unknown): v is ControlTrackStatus {
  return typeof v === 'string' && (CONTROL_STATUSES as readonly string[]).includes(v);
}

// Any status can move to any other (operators correct mistakes and re-open a met control), but the
// value MUST be a known status — this is the guard the write route relies on. Never throws.
export type StatusTransition =
  | { ok: true; status: ControlTrackStatus }
  | { ok: false; error: string };

export function validateStatusTransition(next: unknown): StatusTransition {
  if (!isControlStatus(next)) {
    return { ok: false, error: `status must be one of ${CONTROL_STATUSES.join(' | ')}` };
  }
  return { ok: true, status: next };
}

// ─── Coverage math (pure) ─────────────────────────────────────────────────────

// A control's contribution to coverage: met = 1, in-progress = 0.5, new/untracked = 0.
export function statusScore(s: ControlTrackStatus | undefined): number {
  if (s === 'met') return 1;
  if (s === 'in-progress') return 0.5;
  return 0;
}

export interface FrameworkProgress {
  id: FrameworkId;
  name: string;
  total: number;
  met: number;
  inProgress: number;
  coverage: number; // 0–100
}

// Compute a framework's coverage from a map of controlId → status. Untracked controls count as 0.
export function frameworkProgress(
  framework: CatalogFramework,
  statuses: Record<string, ControlTrackStatus>,
): FrameworkProgress {
  const total = framework.controls.length;
  let met = 0;
  let inProgress = 0;
  let sum = 0;
  for (const c of framework.controls) {
    const s = statuses[c.id];
    if (s === 'met') met += 1;
    else if (s === 'in-progress') inProgress += 1;
    sum += statusScore(s);
  }
  const coverage = total === 0 ? 0 : Math.round((sum / total) * 100);
  return { id: framework.id, name: framework.name, total, met, inProgress, coverage };
}
