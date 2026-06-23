// The module registry — the heart of modularity. Each capability is API-first and
// independently adoptable; a deployment enables only the modules it bought (see lib/modules).
export type ModuleId =
  | 'fleet'
  | 'gateway'
  | 'control'
  | 'data'
  | 'brain'
  | 'agents'
  | 'analytics'
  | 'finops'
  | 'reports'
  | 'regulatory'
  | 'admin';

export interface ModuleDef {
  id: ModuleId;
  label: string;
  description: string;
  route: string;
  /** The headless service this module fronts — usable via API with no UI at all. */
  service: string;
  /** Internal management surface (not a sellable plane; hidden from the public landing). */
  internal?: boolean;
}

export const MODULES: readonly ModuleDef[] = [
  {
    id: 'fleet',
    label: 'Fleet',
    description: 'Devices, enrollment, policy assignment, kill switch.',
    route: '/fleet',
    service: 'fleet-control',
  },
  {
    id: 'gateway',
    label: 'Gateway',
    description:
      'Model routing (local + leashed cloud), providers, OpenAI-compatible endpoint, cache.',
    route: '/gateway',
    service: 'gateway',
  },
  {
    id: 'control',
    label: 'Control',
    description: 'Guardrails, egress policy, audit log, kill switch.',
    route: '/control',
    service: 'control',
  },
  {
    id: 'data',
    label: 'Data',
    description: 'Connectors, ingestion, PII masking, data catalog.',
    route: '/data',
    service: 'ingest',
  },
  {
    id: 'brain',
    label: 'Brain',
    description: 'Ingestion→retrieval (RAG): KB, SOPs, citations.',
    route: '/brain',
    service: 'brain',
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Pre-built AI agent use cases.',
    route: '/agents',
    service: 'agents',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    description: 'Usage, cost, latency, and drift across the fleet.',
    route: '/analytics',
    service: 'analytics',
  },
  {
    id: 'finops',
    label: 'FinOps',
    description: 'Virtual keys (token issuance), per-user/project usage, cost & budgets.',
    route: '/finops',
    service: 'finops',
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Regulator-ready, citation-backed reports and exports for the DPO/regulator.',
    route: '/reports',
    service: 'reports',
  },
  {
    id: 'regulatory',
    label: 'Regulatory',
    description: 'DPO view, framework mapping, audit/DPIA exports.',
    route: '/regulatory',
    service: 'regulatory',
  },
  {
    id: 'admin',
    label: 'Admin',
    description: 'Tenants, provisioning, and ABAC access policy.',
    route: '/admin',
    service: 'admin',
    internal: true,
  },
];
