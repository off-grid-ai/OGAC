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
  | 'platform-health'
  | 'analytics'
  | 'roi'
  | 'finops'
  | 'accounting'
  | 'reports'
  | 'lineage'
  | 'regulatory'
  | 'trust'
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
  /** Nav marks this module "Soon" — the surface is present but part of it is not yet live. */
  comingSoon?: boolean;
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
    route: '/work/chat',
    service: 'gateway',
  },
  {
    id: 'services',
    label: 'Services',
    description:
      'The directory of every Off Grid AI surface — console, gateway, and product subdomains — with live health. One login covers them all.',
    route: '/operations/services',
    service: 'console',
    internal: true,
  },
  {
    id: 'projects',
    label: 'Projects',
    description:
      'Group chats under shared instructions and a knowledgebase — a dedicated workspace per topic (ChatGPT/Claude Projects parity).',
    route: '/work/projects',
    service: 'gateway',
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    description:
      'A library of generated outputs — HTML, SVG, React, diagrams, and code saved from your chats and reopenable anytime.',
    route: '/work/artifacts',
    service: 'gateway',
  },
  {
    id: 'prompts',
    label: 'Prompts',
    description:
      'A library of reusable prompts — save, tag, and organize prompt texts, plus a Common Prompts view mined from what the org actually asks.',
    route: '/work/prompts',
    service: 'gateway',
  },
  {
    id: 'fleet',
    label: 'Managed devices',
    description:
      'Device inventory and health across the estate. Live enrollment and device commands are coming soon.',
    route: '/operations/devices',
    service: 'fleet-control',
    comingSoon: true,
  },
  {
    id: 'gateway',
    label: 'Models',
    description:
      'The LLM gateway — model routing (local + leashed cloud), providers, OpenAI-compatible endpoint, cache.',
    route: '/runtime/models',
    service: 'gateway',
  },
  {
    id: 'gateways',
    label: 'Gateways',
    description:
      'The registry of model-serving gateways your pipelines run on — on-prem cluster, OpenAI, Anthropic, OpenRouter — each with its egress class (data stays on-prem vs. leaves) and live health.',
    route: '/runtime/gateways',
    service: 'gateway',
    internal: true,
  },
  {
    id: 'pipelines',
    label: 'Pipelines',
    description:
      'The heart of Off Grid AI — reusable, composable, governed model-access contracts. A pipeline binds a gateway, sets the routing + egress leash, fixes a hard data ceiling, and layers policy + guardrails; apps, agents, and chat consume it. Versioned and templated.',
    route: '/runtime/pipelines',
    service: 'gateway',
    internal: true,
  },
  {
    id: 'edge',
    label: 'Edge',
    description:
      'The network gateway — the public HTTP edge (Caddy reverse proxy) fronting all published services, with WAF + rate limiting. Live policy and blocked traffic in one place.',
    route: '/operations/edge',
    service: 'edge',
    internal: true,
  },
  {
    id: 'control',
    label: 'Posture',
    description: 'Guardrails, egress policy, audit log, kill switch.',
    route: '/governance/posture',
    service: 'control',
  },
  {
    id: 'data',
    label: 'Sources',
    description: 'Connectors, ingestion, PII masking, data catalog.',
    route: '/data/sources',
    service: 'ingest',
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Pre-built AI agent use cases.',
    route: '/solutions/agents',
    service: 'agents',
  },
  {
    id: 'studio',
    label: 'Apps',
    description:
      'Build agents & workflows in plain language — wired to your connectors, data, tools, guardrails.',
    route: '/solutions/apps',
    service: 'agents',
  },
  {
    id: 'tools',
    label: 'Tools',
    description:
      'The one home for the tools your apps can call — the registered HTTP/MCP tool registry, the curated MCP catalog to add from, and the built-in primitives (web search, read URL, HTTP) with their air-gap state.',
    route: '/solutions/tools',
    service: 'agents',
    internal: true,
  },
  {
    id: 'observability',
    label: 'AI behavior',
    description: 'Agent QA: eval scores, online LLM-as-judge scores, drift, and full run traces.',
    route: '/insights/ai',
    service: 'qa',
  },
  {
    id: 'platform-health',
    label: 'Platform Health',
    description:
      'Live platform metrics, logs, and traces — request/error rate, latency, log search, and distributed traces from the observability stack.',
    route: '/operations/health',
    service: 'observability',
  },
  {
    id: 'analytics',
    label: 'Usage',
    description: 'Usage, cost, latency, and drift across the fleet.',
    route: '/insights/usage',
    service: 'analytics',
  },
  {
    id: 'roi',
    label: 'Outcomes',
    description:
      'Hours and $ saved per app and per department — the value each automation returns against its actual AI cost, for renewals and budget justification.',
    route: '/insights/outcomes',
    service: 'analytics',
  },
  {
    id: 'finops',
    label: 'API & budgets',
    description: 'Virtual keys (token issuance), per-user/project usage, cost & budgets.',
    route: '/runtime/api-budgets',
    service: 'finops',
  },
  {
    id: 'accounting',
    label: 'Cost',
    description:
      'Token usage and spend attributed per user, per project, and per model over any time range — the leaderboard of who spent what, on which models.',
    route: '/insights/cost',
    service: 'finops',
    internal: true,
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Regulator-ready, citation-backed reports and exports for the DPO/regulator.',
    route: '/governance/trust/reports',
    service: 'reports',
  },
  {
    id: 'lineage',
    label: 'Lineage',
    description: 'Source→answer data lineage for every agent run.',
    route: '/data/lineage',
    service: 'lineage',
  },
  {
    id: 'regulatory',
    label: 'Regulatory',
    description: 'DPO view, framework mapping, audit/DPIA exports.',
    route: '/governance/trust/regulatory',
    service: 'regulatory',
  },
  {
    id: 'trust',
    label: 'Trust Center',
    description:
      'The security & compliance evidence surface for a buyer’s CISO/procurement gate — posture, data governance, AI governance, regulatory mapping, and a compliance-artifact checklist, with a downloadable trust summary.',
    route: '/governance/trust',
    service: 'regulatory',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description:
      'Configure every underlying service (adapters, URLs, secrets, health) from the UI.',
    route: '/operations/configuration/adapters',
    service: 'integrations',
    internal: true,
  },
  {
    id: 'tool-catalog',
    label: 'Tool catalog',
    description:
      'A curated catalog of open-source MCP servers (Model Context Protocol) — one-click add a tool from the ecosystem as a registered MCP tool your apps can use.',
    route: '/solutions/tools?view=catalog',
    service: 'integrations',
    internal: true,
  },
  {
    id: 'data-domains',
    label: 'Data domains',
    description:
      'Declare where data lives (customer→Salesforce, transactions→Postgres) — the rule engine agents route by.',
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
    route: '/data/catalog/governance',
    service: 'ingest',
    internal: true,
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    description:
      'Ask Your Org, on-prem: an admin-curated shared knowledge base, indexed once and retrieved permission-aware with citations in chat.',
    route: '/data/knowledge',
    service: 'gateway',
  },
  {
    id: 'access',
    label: 'Access',
    description: 'Manage users, roles, and machine clients with enterprise SSO.',
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
    label: 'Files',
    description:
      'Upload, browse, and share files — stored on-prem, never leaves your infrastructure. Public/private per file, S3-compatible URL.',
    route: '/work/files',
    service: 'files',
  },
  {
    id: 'provit',
    label: 'Provit',
    description:
      'Visual QA — catch visual regressions and review UI changes before they ship. Coming soon.',
    route: '/operations/visual-qa',
    service: 'provit',
    comingSoon: true,
  },
  {
    id: 'api-docs',
    label: 'API docs & playground',
    description:
      'A curated catalog of the console’s public API surface — every endpoint grouped by area with method, auth level, and a live “try it” for safe GETs. The contract, browsable.',
    route: '/runtime/api',
    service: 'console',
    internal: true,
  },
  {
    id: 'agent-runs',
    label: 'Agent Runs',
    description:
      'Durable-execution history — every agent/workflow run, its pipeline timeline, and outcome. Recorded on-prem.',
    route: '/operations/runs?kind=agent',
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
    label: 'Policies',
    description:
      'Policy-as-code — the active policy set plus recent allow/deny decisions read back from the engine.',
    route: '/governance/policies',
    service: 'control',
    internal: true,
  },
  {
    id: 'evals',
    label: 'Quality',
    description:
      'Golden sets and quality gates — pass-rates and recent eval/red-team runs by suite.',
    route: '/solutions/quality',
    service: 'control',
    internal: true,
  },
  {
    id: 'siem',
    label: 'Security Events',
    description:
      'Security/audit event stream from OpenSearch — outcomes, top actors, and blocked/denied activity.',
    route: '/governance/evidence/security',
    service: 'control',
    internal: true,
  },
  {
    id: 'audit',
    label: 'Audit Log',
    description:
      'Accountability trail — who sent which chats, ran which workflows, and changed what. Filter by actor, action, project, outcome, and time; export CSV/JSON for compliance.',
    route: '/governance/evidence/audit',
    service: 'control',
    internal: true,
  },
  {
    id: 'drift',
    label: 'Quality results',
    description: 'Model/data drift monitoring — per-feature drift status and scores.',
    route: '/insights/quality',
    service: 'control',
    internal: true,
  },
  {
    id: 'backups',
    label: 'Backups',
    description:
      'Backup & DR status — latest dump, age, size, retention window, and off-box replication.',
    route: '/operations/backups',
    service: 'console',
    internal: true,
  },
  {
    id: 'retrieval',
    label: 'Retrieval',
    description: 'Vector store — collections, vector counts, and health for the retrieval backend.',
    route: '/data/knowledge/indexes',
    service: 'control',
    internal: true,
  },
  {
    id: 'provenance',
    label: 'Provenance',
    description:
      'Signed provenance (Sigstore) — verify and browse cryptographically signed answers/artifacts.',
    route: '/governance/evidence/provenance',
    service: 'control',
    internal: true,
  },
  {
    id: 'secrets',
    label: 'Secrets',
    description:
      'Secrets management — seal status, mounts, and secret lifecycle. Values never displayed.',
    route: '/governance/secrets',
    service: 'control',
    internal: true,
  },
  {
    id: 'exporters',
    label: 'Export',
    description:
      'Send audit, lineage, and cost/usage metrics to your own SIEM, data catalog, and observability stack (Splunk, Purview/Collibra, Grafana/Prometheus) — the platform is a good citizen of your existing tooling, not an island.',
    route: '/governance/evidence/export',
    service: 'console',
    internal: true,
  },
  {
    id: 'guardrails',
    label: 'Guardrails',
    description: 'Input/output policy — PII detection, injection, grounding. Engine + rules.',
    route: '/governance/guardrails',
    service: 'control',
    internal: true,
  },
  {
    id: 'sandbox',
    label: 'Sandbox',
    description:
      'Code-execution sandboxing (E2B/Firecracker) — backend status and recent execution runs.',
    route: '/solutions/test',
    service: 'control',
    internal: true,
  },
  {
    id: 'config',
    label: 'Configuration',
    description:
      'The single place to see and edit every environment setting — gateway, services, auth, adapters — with secrets masked. Applied on restart.',
    route: '/operations/configuration',
    service: 'console',
    internal: true,
  },
];
