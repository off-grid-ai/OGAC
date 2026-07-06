// The module registry — the heart of modularity. Each capability is API-first and
// independently adoptable; a deployment enables only the modules it bought (see lib/modules).
export type ModuleId =
  | 'overview'
  | 'chat'
  | 'services'
  | 'projects'
  | 'artifacts'
  | 'prompts'
  | 'fleet'
  | 'gateway'
  | 'edge'
  | 'control'
  | 'data'
  | 'brain'
  | 'agents'
  | 'studio'
  | 'observability'
  | 'analytics'
  | 'finops'
  | 'accounting'
  | 'reports'
  | 'lineage'
  | 'regulatory'
  | 'integrations'
  | 'data-domains'
  | 'knowledge'
  | 'access'
  | 'admin'
  | 'storage'
  | 'provit'
  | 'api-docs'
  | 'agent-runs'
  | 'policy'
  | 'evals'
  | 'siem'
  | 'audit'
  | 'drift'
  | 'backups'
  | 'retrieval'
  | 'provenance'
  | 'secrets'
  | 'guardrails'
  | 'sandbox'
  | 'config';

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
    id: 'overview',
    label: 'Overview',
    description:
      'The operator home — governance posture, cost, traffic, service health, and recent activity in one glance, with quick actions into every module.',
    route: '/overview',
    service: 'console',
    internal: true,
  },
  {
    id: 'chat',
    label: 'Chat',
    description:
      'Your team’s private AI — answers grounded in your own docs and data, run on your gateways. Nothing leaves your network; no per-seat cost.',
    route: '/chat',
    service: 'gateway',
  },
  {
    id: 'services',
    label: 'Services',
    description:
      'The directory of every Off Grid surface — console, gateway, and product subdomains — with live health. One login covers them all.',
    route: '/services',
    service: 'console',
    internal: true,
  },
  {
    id: 'projects',
    label: 'Projects',
    description:
      'Group chats under shared instructions and a knowledgebase — a dedicated workspace per topic (ChatGPT/Claude Projects parity).',
    route: '/projects',
    service: 'gateway',
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    description:
      'A library of generated outputs — HTML, SVG, React, diagrams, and code saved from your chats and reopenable anytime.',
    route: '/artifacts',
    service: 'gateway',
  },
  {
    id: 'prompts',
    label: 'Prompts',
    description:
      'A library of reusable prompts — save, tag, and organize prompt texts, plus a Common Prompts view mined from what the org actually asks.',
    route: '/prompts',
    service: 'gateway',
  },
  {
    id: 'fleet',
    label: 'Fleet',
    description: 'Devices, enrollment, policy assignment, kill switch.',
    route: '/fleet',
    service: 'fleet-control',
  },
  {
    id: 'gateway',
    label: 'AI Gateway',
    description:
      'The LLM gateway — model routing (local + leashed cloud), providers, OpenAI-compatible endpoint, cache.',
    route: '/gateway',
    service: 'gateway',
  },
  {
    id: 'edge',
    label: 'Gateway',
    description:
      'The network gateway — the public HTTP edge (Caddy reverse proxy) fronting all published services, with WAF + rate limiting. Live policy and blocked traffic in one place.',
    route: '/edge',
    service: 'edge',
    internal: true,
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
    label: 'Connectors',
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
    id: 'studio',
    label: 'Studio',
    description: 'Build agents & workflows in plain language — wired to your connectors, data, tools, guardrails.',
    route: '/studio',
    service: 'agents',
  },
  {
    id: 'observability',
    label: 'Observability',
    description:
      'Agent QA: eval scores, online LLM-as-judge scores, drift, and full run traces (Langfuse-backed).',
    route: '/observability',
    service: 'qa',
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
    id: 'accounting',
    label: 'Usage & Spend',
    description:
      'Token usage and spend attributed per user, per project, and per model over any time range — the leaderboard of who spent what, on which models.',
    route: '/accounting',
    service: 'finops',
    internal: true,
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Regulator-ready, citation-backed reports and exports for the DPO/regulator.',
    route: '/reports',
    service: 'reports',
  },
  {
    id: 'lineage',
    label: 'Lineage',
    description: 'Source→answer data lineage for every agent run (OpenLineage/Marquez-backed).',
    route: '/lineage',
    service: 'lineage',
  },
  {
    id: 'regulatory',
    label: 'Regulatory',
    description: 'DPO view, framework mapping, audit/DPIA exports.',
    route: '/regulatory',
    service: 'regulatory',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Configure every underlying service (adapters, URLs, secrets, health) from the UI.',
    route: '/integrations',
    service: 'integrations',
    internal: true,
  },
  {
    id: 'data-domains',
    label: 'Data domains',
    description: 'Declare where data lives (customer→Salesforce, transactions→Postgres) — the rule engine agents route by.',
    route: '/data-domains',
    service: 'integrations',
    internal: true,
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    description:
      'Ask Your Org, on-prem: an admin-curated shared knowledge base, indexed once and retrieved permission-aware with citations in chat.',
    route: '/knowledge',
    service: 'gateway',
  },
  {
    id: 'access',
    label: 'Access',
    description: 'Manage users, roles, and machine clients via Keycloak.',
    route: '/access',
    service: 'keycloak',
    internal: true,
  },
  {
    id: 'admin',
    label: 'Admin',
    description: 'Tenants, provisioning, and ABAC access policy.',
    route: '/admin',
    service: 'admin',
    internal: true,
  },
  {
    id: 'storage',
    label: 'Storage',
    description: 'Upload, browse, and share files — stored on-prem, never leaves your infrastructure. Public/private per file, S3-compatible URL.',
    route: '/storage',
    service: 'files',
  },
  {
    id: 'provit',
    label: 'Provit',
    description:
      'Visual QA — catch visual regressions and review UI changes. Runs on-prem at its own subdomain, surfaced here with live status and its showcase.',
    route: '/provit',
    service: 'provit',
  },
  {
    id: 'api-docs',
    label: 'API docs & playground',
    description:
      'A curated catalog of the console’s public API surface — every endpoint grouped by area with method, auth level, and a live “try it” for safe GETs. The contract, browsable.',
    route: '/api-docs',
    service: 'console',
    internal: true,
  },
  {
    id: 'agent-runs',
    label: 'Agent Runs',
    description: 'Durable-execution history — every agent/workflow run, its pipeline timeline, and outcome. Recorded on-prem.',
    route: '/agent-runs',
    service: 'agents',
    internal: true,
  },
  {
    id: 'policy',
    label: 'Policy',
    description: 'Policy-as-code (OPA) — the active policy set plus recent allow/deny decisions read back from the engine.',
    route: '/policy',
    service: 'control',
    internal: true,
  },
  {
    id: 'evals',
    label: 'Evals',
    description: 'Golden sets and quality gates — pass-rates and recent eval/red-team runs by suite.',
    route: '/evals',
    service: 'control',
    internal: true,
  },
  {
    id: 'siem',
    label: 'Security Events',
    description: 'Security/audit event stream from OpenSearch — outcomes, top actors, and blocked/denied activity.',
    route: '/siem',
    service: 'control',
    internal: true,
  },
  {
    id: 'audit',
    label: 'Audit Log',
    description:
      'Accountability trail — who sent which chats, ran which workflows, and changed what. Filter by actor, action, project, outcome, and time; export CSV/JSON for compliance.',
    route: '/audit',
    service: 'control',
    internal: true,
  },
  {
    id: 'drift',
    label: 'Drift',
    description: 'Model/data drift monitoring (Evidently) — per-feature drift status and scores.',
    route: '/drift',
    service: 'control',
    internal: true,
  },
  {
    id: 'backups',
    label: 'Backups',
    description: 'Backup & DR status — latest dump, age, size, retention window, and off-box replication.',
    route: '/backups',
    service: 'console',
    internal: true,
  },
  {
    id: 'retrieval',
    label: 'Retrieval',
    description: 'Vector store (Qdrant) — collections, vector counts, and health for the retrieval backend.',
    route: '/retrieval',
    service: 'control',
    internal: true,
  },
  {
    id: 'provenance',
    label: 'Provenance',
    description: 'Signed provenance (Sigstore) — verify and browse cryptographically signed answers/artifacts.',
    route: '/provenance',
    service: 'control',
    internal: true,
  },
  {
    id: 'secrets',
    label: 'Secrets',
    description: 'Secrets management (OpenBao) — seal status, mounts, and secret lifecycle. Values never displayed.',
    route: '/secrets',
    service: 'control',
    internal: true,
  },
  {
    id: 'guardrails',
    label: 'Guardrails',
    description: 'Input/output policy — PII detection (Presidio + regex floor), injection, grounding. Engine + rules.',
    route: '/guardrails',
    service: 'control',
    internal: true,
  },
  {
    id: 'sandbox',
    label: 'Sandbox',
    description: 'Code-execution sandboxing (E2B/Firecracker) — backend status and recent execution runs.',
    route: '/sandbox',
    service: 'control',
    internal: true,
  },
  {
    id: 'config',
    label: 'Configuration',
    description: 'The single place to see and edit every environment setting — gateway, services, auth, adapters — with secrets masked. Applied on restart.',
    route: '/config',
    service: 'console',
    internal: true,
  },
];
