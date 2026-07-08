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
  | 'gateways'
  | 'pipelines'
  | 'edge'
  | 'control'
  | 'data'
  | 'brain'
  | 'agents'
  | 'studio'
  | 'tools'
  | 'observability'
  | 'analytics'
  | 'finops'
  | 'accounting'
  | 'reports'
  | 'lineage'
  | 'regulatory'
  | 'integrations'
  | 'tool-catalog'
  | 'data-domains'
  | 'catalog'
  | 'governance'
  | 'knowledge'
  | 'access'
  | 'teams'
  | 'admin'
  | 'storage'
  | 'provit'
  | 'api-docs'
  | 'agent-runs'
  | 'runs'
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
  | 'exporters'
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
    route: '/workspace/chat',
    service: 'gateway',
  },
  {
    id: 'services',
    label: 'Services',
    description:
      'The directory of every Off Grid AI surface — console, gateway, and product subdomains — with live health. One login covers them all.',
    route: '/gateway/services',
    service: 'console',
    internal: true,
  },
  {
    id: 'projects',
    label: 'Projects',
    description:
      'Group chats under shared instructions and a knowledgebase — a dedicated workspace per topic (ChatGPT/Claude Projects parity).',
    route: '/workspace/projects',
    service: 'gateway',
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    description:
      'A library of generated outputs — HTML, SVG, React, diagrams, and code saved from your chats and reopenable anytime.',
    route: '/workspace/artifacts',
    service: 'gateway',
  },
  {
    id: 'prompts',
    label: 'Prompts',
    description:
      'A library of reusable prompts — save, tag, and organize prompt texts, plus a Common Prompts view mined from what the org actually asks.',
    route: '/workspace/prompts',
    service: 'gateway',
  },
  {
    id: 'fleet',
    label: 'Fleet',
    description: 'Devices, enrollment, policy assignment, kill switch.',
    route: '/gateway/fleet',
    service: 'fleet-control',
  },
  {
    id: 'gateway',
    label: 'AI Gateway',
    description:
      'The LLM gateway — model routing (local + leashed cloud), providers, OpenAI-compatible endpoint, cache.',
    route: '/gateway/ai',
    service: 'gateway',
  },
  {
    id: 'gateways',
    label: 'Gateways',
    description:
      'The registry of model-serving gateways your pipelines run on — on-prem cluster, OpenAI, Anthropic, OpenRouter — each with its egress class (data stays on-prem vs. leaves) and live health.',
    route: '/gateway/registry',
    service: 'gateway',
    internal: true,
  },
  {
    id: 'pipelines',
    label: 'Pipelines',
    description:
      'The heart of Off Grid AI — reusable, composable, governed model-access contracts. A pipeline binds a gateway, sets the routing + egress leash, fixes a hard data ceiling, and layers policy + guardrails; apps, agents, and chat consume it. Versioned and templated.',
    route: '/build/pipelines',
    service: 'gateway',
    internal: true,
  },
  {
    id: 'edge',
    label: 'Gateway',
    description:
      'The network gateway — the public HTTP edge (Caddy reverse proxy) fronting all published services, with WAF + rate limiting. Live policy and blocked traffic in one place.',
    route: '/gateway/edge',
    service: 'edge',
    internal: true,
  },
  {
    id: 'control',
    label: 'Control',
    description: 'Guardrails, egress policy, audit log, kill switch.',
    route: '/governance',
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
    route: '/build/brain',
    service: 'brain',
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Pre-built AI agent use cases.',
    route: '/build/agents',
    service: 'agents',
  },
  {
    id: 'studio',
    label: 'Studio',
    description: 'Build agents & workflows in plain language — wired to your connectors, data, tools, guardrails.',
    route: '/build/studio',
    service: 'agents',
  },
  {
    id: 'tools',
    label: 'Tools',
    description:
      'The one home for the tools your apps can call — the registered HTTP/MCP tool registry, the curated MCP catalog to add from, and the built-in primitives (web search, read URL, HTTP) with their air-gap state.',
    route: '/build/tools',
    service: 'agents',
    internal: true,
  },
  {
    id: 'observability',
    label: 'Observability',
    description:
      'Agent QA: eval scores, online LLM-as-judge scores, drift, and full run traces (Langfuse-backed).',
    route: '/insights',
    service: 'qa',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    description: 'Usage, cost, latency, and drift across the fleet.',
    route: '/insights/analytics',
    service: 'analytics',
  },
  {
    id: 'finops',
    label: 'FinOps',
    description: 'Virtual keys (token issuance), per-user/project usage, cost & budgets.',
    route: '/insights/finops',
    service: 'finops',
  },
  {
    id: 'accounting',
    label: 'Usage & Spend',
    description:
      'Token usage and spend attributed per user, per project, and per model over any time range — the leaderboard of who spent what, on which models.',
    route: '/insights/accounting',
    service: 'finops',
    internal: true,
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Regulator-ready, citation-backed reports and exports for the DPO/regulator.',
    route: '/insights/reports',
    service: 'reports',
  },
  {
    id: 'lineage',
    label: 'Lineage',
    description: 'Source→answer data lineage for every agent run (OpenLineage/Marquez-backed).',
    route: '/data/lineage',
    service: 'lineage',
  },
  {
    id: 'regulatory',
    label: 'Regulatory',
    description: 'DPO view, framework mapping, audit/DPIA exports.',
    route: '/governance/regulatory',
    service: 'regulatory',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Configure every underlying service (adapters, URLs, secrets, health) from the UI.',
    route: '/data/integrations',
    service: 'integrations',
    internal: true,
  },
  {
    id: 'tool-catalog',
    label: 'Tool catalog',
    description:
      'A curated catalog of open-source MCP servers (Model Context Protocol) — one-click add a tool from the ecosystem as a registered MCP tool your apps can use.',
    route: '/data/tool-catalog',
    service: 'integrations',
    internal: true,
  },
  {
    id: 'data-domains',
    label: 'Data domains',
    description: 'Declare where data lives (customer→Salesforce, transactions→Postgres) — the rule engine agents route by.',
    route: '/data/domains',
    service: 'integrations',
    internal: true,
  },
  {
    id: 'catalog',
    label: 'Data catalog',
    description:
      'The registry of every dataset the org holds — source, owner, classification, PII flags, row count, and freshness. What data do I have, in one place.',
    route: '/data/catalog',
    service: 'ingest',
    internal: true,
  },
  {
    id: 'governance',
    label: 'Data governance',
    description:
      'Deep data governance — per-dataset classification, retention & right-to-be-forgotten across the warehouse, vector store, and lineage, plus freshness SLAs and broken-sync alerts.',
    route: '/data/governance',
    service: 'ingest',
    internal: true,
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    description:
      'Ask Your Org, on-prem: an admin-curated shared knowledge base, indexed once and retrieved permission-aware with citations in chat.',
    route: '/workspace/knowledge',
    service: 'gateway',
  },
  {
    id: 'access',
    label: 'Access',
    description: 'Manage users, roles, and machine clients via Keycloak.',
    route: '/governance/access',
    service: 'keycloak',
    internal: true,
  },
  {
    id: 'teams',
    label: 'Teams',
    description:
      'Teams / business units between the org and the pipeline. A pipeline can belong to a team, and team members get delegated access to their team’s pipelines.',
    route: '/governance/teams',
    service: 'console',
    internal: true,
  },
  {
    id: 'admin',
    label: 'Admin',
    description: 'Tenants, provisioning, and ABAC access policy.',
    route: '/operations/admin',
    service: 'admin',
    internal: true,
  },
  {
    id: 'storage',
    label: 'Storage',
    description: 'Upload, browse, and share files — stored on-prem, never leaves your infrastructure. Public/private per file, S3-compatible URL.',
    route: '/workspace/storage',
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
    route: '/operations/api-docs',
    service: 'console',
    internal: true,
  },
  {
    id: 'agent-runs',
    label: 'Agent Runs',
    description: 'Durable-execution history — every agent/workflow run, its pipeline timeline, and outcome. Recorded on-prem.',
    route: '/build/agent-runs',
    service: 'agents',
    internal: true,
  },
  {
    id: 'runs',
    label: 'Runs',
    description:
      'Every job across the platform — apps, agents, and chat — with live status in one place. See what is running, queued, awaiting review, succeeded, or failed, and drill into any run.',
    route: '/operations/runs',
    service: 'console',
    internal: true,
  },
  {
    id: 'policy',
    label: 'Policy',
    description: 'Policy-as-code (OPA) — the active policy set plus recent allow/deny decisions read back from the engine.',
    route: '/governance/policy',
    service: 'control',
    internal: true,
  },
  {
    id: 'evals',
    label: 'Evals',
    description: 'Golden sets and quality gates — pass-rates and recent eval/red-team runs by suite.',
    route: '/build/evals',
    service: 'control',
    internal: true,
  },
  {
    id: 'siem',
    label: 'Security Events',
    description: 'Security/audit event stream from OpenSearch — outcomes, top actors, and blocked/denied activity.',
    route: '/insights/siem',
    service: 'control',
    internal: true,
  },
  {
    id: 'audit',
    label: 'Audit Log',
    description:
      'Accountability trail — who sent which chats, ran which workflows, and changed what. Filter by actor, action, project, outcome, and time; export CSV/JSON for compliance.',
    route: '/insights/audit',
    service: 'control',
    internal: true,
  },
  {
    id: 'drift',
    label: 'Drift',
    description: 'Model/data drift monitoring (Evidently) — per-feature drift status and scores.',
    route: '/insights/drift',
    service: 'control',
    internal: true,
  },
  {
    id: 'backups',
    label: 'Backups',
    description: 'Backup & DR status — latest dump, age, size, retention window, and off-box replication.',
    route: '/operations/backups',
    service: 'console',
    internal: true,
  },
  {
    id: 'retrieval',
    label: 'Retrieval',
    description: 'Vector store (Qdrant) — collections, vector counts, and health for the retrieval backend.',
    route: '/data/retrieval',
    service: 'control',
    internal: true,
  },
  {
    id: 'provenance',
    label: 'Provenance',
    description: 'Signed provenance (Sigstore) — verify and browse cryptographically signed answers/artifacts.',
    route: '/governance/provenance',
    service: 'control',
    internal: true,
  },
  {
    id: 'secrets',
    label: 'Secrets',
    description: 'Secrets management (OpenBao) — seal status, mounts, and secret lifecycle. Values never displayed.',
    route: '/governance/secrets',
    service: 'control',
    internal: true,
  },
  {
    id: 'exporters',
    label: 'Export',
    description:
      'Send audit, lineage, and cost/usage metrics to your own SIEM, data catalog, and observability stack (Splunk, Purview/Collibra, Grafana/Prometheus) — the platform is a good citizen of your existing tooling, not an island.',
    route: '/governance/exporters',
    service: 'console',
    internal: true,
  },
  {
    id: 'guardrails',
    label: 'Guardrails',
    description: 'Input/output policy — PII detection (Presidio + regex floor), injection, grounding. Engine + rules.',
    route: '/governance/guardrails',
    service: 'control',
    internal: true,
  },
  {
    id: 'sandbox',
    label: 'Sandbox',
    description: 'Code-execution sandboxing (E2B/Firecracker) — backend status and recent execution runs.',
    route: '/build/sandbox',
    service: 'control',
    internal: true,
  },
  {
    id: 'config',
    label: 'Configuration',
    description: 'The single place to see and edit every environment setting — gateway, services, auth, adapters — with secrets masked. Applied on restart.',
    route: '/operations/config',
    service: 'console',
    internal: true,
  },
];
