// Deep per-phase content for /architecture/[phase] — components, OSS options, the diagram
// gallery, and how Off Grid maps. Sourced from the agentic-AI stack navigator.
export interface ArchComponent {
  name: string;
  job: string;
}

export interface ArchPhase {
  id: string;
  n: string;
  name: string;
  blurb: string;
  hero: string;
  diagrams: string[];
  components: ArchComponent[];
  oss: string[];
  maps: string[];
}

export const ARCH: ArchPhase[] = [
  {
    id: 'a',
    n: 'A',
    name: 'Data Plane',
    blurb:
      'Get data out of source systems, prepare it, govern it, land it. AI quality is capped here.',
    hero: '03-phase-a-data-plane',
    diagrams: [
      '03-phase-a-data-plane',
      '08-entity-source-systems',
      '09-entity-etl-pii',
      '10-entity-data-lake',
    ],
    components: [
      {
        name: 'Source systems',
        job: 'Where business data already lives — core banking, CRM, files, voice, IoT. Connect, don’t migrate.',
      },
      { name: 'CDC / ingestion', job: 'Pull or push into the lake without hammering the sources.' },
      {
        name: 'Schema registry',
        job: 'Versioned contracts between producers and consumers, enforced in CI.',
      },
      {
        name: 'Data catalog',
        job: 'What data we have, who owns it, what it means — the map agents navigate by.',
      },
      {
        name: 'PII discovery + classification',
        job: 'Find sensitive data, tag it, set policy before it flows downstream.',
      },
      {
        name: 'Consent management',
        job: 'Capture and propagate the legal basis per data subject, per purpose.',
      },
      {
        name: 'PII masking + synthetic',
        job: 'Tokenise / hash / substitute synthetic — safe to use without losing utility.',
      },
      {
        name: 'Data lake',
        job: 'Open table format with prod, masked-replica, and synthetic zones.',
      },
      {
        name: 'Fine-grained access',
        job: 'Row / column / cell control and tenant isolation at the lake exit.',
      },
      {
        name: 'Retention + erasure',
        job: 'Propagate “delete this person” across lake, KB, vectors, memory, audit.',
      },
    ],
    oss: [
      'Debezium',
      'Meltano',
      'Apache Kafka',
      'Apache Spark',
      'Apache Iceberg',
      'Trino',
      'SeaweedFS',
      'Microsoft Presidio',
    ],
    maps: ['Data'],
  },
  {
    id: 'b',
    n: 'B',
    name: 'AI Plane',
    blurb:
      'Convert prepared data into an AI-ready substrate — knowledge, tools, memory, model serving.',
    hero: '04-phase-b-ai-plane',
    diagrams: [
      '04-phase-b-ai-plane',
      '11-entity-knowledge-base',
      '12-entity-tool-layer',
      '15-entity-memory',
    ],
    components: [
      {
        name: 'Document parsing + chunking',
        job: 'Turn PDFs, scans, and contracts into clean text plus structure.',
      },
      {
        name: 'Reranking + hybrid search',
        job: 'BM25 + dense vector, then a cross-encoder reranker — the cheapest big quality win.',
      },
      {
        name: 'Vector store / KB index',
        job: 'Semantic search over your corpus — the library the agent reads from.',
      },
      {
        name: 'Provenance + citation',
        job: 'Every chunk signed; the output policy verifies each claim against a signed source.',
      },
      { name: 'Tool layer (MCP)', job: 'Purpose-bound, scoped, audited tools — no raw SQL.' },
      {
        name: 'Sandboxed code execution',
        job: 'Run untrusted code in microVMs, never the host running your services.',
      },
      {
        name: 'Memory',
        job: 'Short-term, long-term vector, entity graph, and file-based — a sidecar, not a layer.',
      },
      { name: 'Model serving', job: 'Run the model — own GPUs or a managed API.' },
      {
        name: 'Fine-tuning',
        job: 'Adapt tone and format, privacy-preserving — when retrieval isn’t enough.',
      },
    ],
    oss: ['Off Grid AI Gateway', 'LanceDB', 'LlamaIndex', 'BGE', 'MCP', 'E2B'],
    maps: ['Off Grid AI Gateway', 'Brain', 'Agents'],
  },
  {
    id: 'c',
    n: 'C',
    name: 'Control Plane',
    blurb:
      'The spine. The gateway every LLM call passes through — policy, audit, observability, FinOps.',
    hero: '05-phase-c-control-plane',
    diagrams: [
      '05-phase-c-control-plane',
      '13-entity-input-policy',
      '14-entity-ai-gateway',
      '16-entity-output-policy',
      '17-entity-identity-audit-spines',
    ],
    components: [
      {
        name: 'AI gateway',
        job: 'A single chokepoint every LLM call passes through. No exceptions.',
      },
      {
        name: 'Input policy',
        job: 'Catch PII, prompt injection, jailbreaks, and purpose drift before the model call.',
      },
      {
        name: 'Output policy + grounding',
        job: 'Validate the response — every claim traces to a citation, or it’s blocked.',
      },
      {
        name: 'Identity + token issuance',
        job: 'User, agent, and service identity; tokens carry purpose, not just permission.',
      },
      {
        name: 'RBAC / ABAC',
        job: 'Per-user, per-purpose, per-tenant policy on every tool and slice of data.',
      },
      {
        name: 'Audit + lineage',
        job: 'Every prompt, tool call, and model call recorded — the regulator’s answer.',
      },
      {
        name: 'Observability',
        job: 'Latency, tokens, success, drift — with full trace replay on a bad answer.',
      },
      {
        name: 'Eval + red team',
        job: 'Quality and safety regression testing as a deployment gate, not a report.',
      },
      {
        name: 'Bias + fairness',
        job: 'Quantify and remediate disparate outcomes on consequential decisions.',
      },
      {
        name: 'Incident response',
        job: 'Runbooks and a kill switch for the 2am leak, hallucination, or jailbreak.',
      },
      { name: 'FinOps', job: 'Track and cap model spend per team and per use case.' },
      {
        name: 'DLP + exfil prevention',
        job: 'Stop sensitive data leaving — including via an agent’s own tool calls.',
      },
      {
        name: 'Durable execution',
        job: 'Long agent runs that span hours and retries resume, not restart.',
      },
    ],
    oss: [
      'Off Grid AI Gateway',
      'Open Policy Agent',
      'Microsoft Presidio',
      'OpenTelemetry',
      'Langfuse',
      'Promptfoo',
      'Falco',
      'Temporal',
    ],
    maps: ['Gateway', 'Control', 'Fleet', 'Analytics'],
  },
  {
    id: 'e',
    n: 'E',
    name: 'Org & Regulatory',
    blurb:
      'The wrapper around everything — frameworks, policy, review, assessments. Skipping it stalls programmes.',
    hero: '07-phase-e-org-regulatory',
    diagrams: ['07-phase-e-org-regulatory'],
    components: [
      {
        name: 'Framework mapping',
        job: 'Map every technical control to the clauses of each framework you answer to.',
      },
      { name: 'AI use policy', job: 'What staff may do, with which tools, against which data.' },
      {
        name: 'Ethics / review board',
        job: 'Pre-deployment review — someone empowered to say no before a bad use case ships.',
      },
      {
        name: 'DPIA / FRIA',
        job: 'A privacy and fundamental-rights assessment before any high-risk use case ships.',
      },
    ],
    oss: ['Regulatory module', 'DPDP · EU AI Act · ISO 42001 · GDPR mappings'],
    maps: ['Regulatory'],
  },
  {
    id: 'd',
    n: 'D',
    name: 'Consumption',
    blurb: 'Where humans meet the agents — copilots, surfaces, confidence-based handoff, feedback.',
    hero: '06-phase-d-consumption',
    diagrams: ['06-phase-d-consumption'],
    components: [
      {
        name: 'Agent runtime / orchestration',
        job: 'The loop that plans, calls tools, and composes a response.',
      },
      {
        name: 'Human-in-the-loop',
        job: 'Pause for human sign-off on risky actions; escalate by confidence.',
      },
      {
        name: 'Conversational + generative UI',
        job: 'Chat, copilots, and UI the agent composes at runtime.',
      },
      {
        name: 'Trust indicators',
        job: 'Citation chips, confidence, model used, “why this answer”.',
      },
      {
        name: 'Voice + telephony',
        job: 'IVR menus become voice agents — real-time speech in and out.',
      },
      {
        name: 'Feedback + data flywheel',
        job: 'Thumbs and corrections feed the eval set — the improvement loop.',
      },
    ],
    oss: ['LangGraph', 'Agno', 'Pydantic AI', 'Vercel AI SDK'],
    maps: ['Console', 'Agents', 'Reports'],
  },
];

export function getPhase(id: string): ArchPhase | undefined {
  return ARCH.find((p) => p.id === id);
}

// The maturity journey a CIO actually lives through — from ungoverned consumer AI to a
// self-serve platform. Each stage earns the next; you can't skip. Drives /journey.
export interface JourneyStage {
  n: string;
  name: string;
  reality: string; // where the org is at this stage, in the CIO's terms
  console: string; // what Off Grid Console gives you to reach / hold this stage
}

export const STAGES: JourneyStage[] = [
  {
    n: '0',
    name: 'Shadow AI',
    reality:
      'Staff paste company data into consumer chatbots. No gateway, no policy, no line item. You have zero visibility into what leaves the building or what it costs.',
    console:
      'The starting point, not a destination. The console exists to end it — give people sanctioned AI before they route around you.',
  },
  {
    n: '1',
    name: 'Sanctioned access',
    reality:
      'One gateway. Every model call routes through it, keyed per user and team, under one AI-use policy. Shadow AI stops because the sanctioned path is easier.',
    console:
      'The single Off Grid AI Gateway is the chokepoint: PII scanned in, policy enforced, every request logged to an append-only audit. Issue virtual keys with budgets in minutes.',
  },
  {
    n: '2',
    name: 'First production use case',
    reality:
      'One narrow agent, one team, heavy human-in-the-loop, real evaluation from day one. You prove value and learn what a single agent actually costs.',
    console:
      'Pre-built use cases (claims/FNOL, KYC, SOP synthesis) run on the gateway with grounded retrieval, citation checks, and Agent QA from day one — golden-set + Ragas offline evals plus LLM-as-judge scoring on live traffic, recorded in Langfuse.',
  },
  {
    n: '3',
    name: 'Multiple agents, shared platform',
    reality:
      'The platform consolidates. New agents ship in weeks, not months, because they inherit the same knowledge base, tools, and policy. An ops dashboard shows the fleet.',
    console:
      'Capability ports + the Brain (versioned knowledge), shared tool registry, RBAC/ABAC, and Fleet/Analytics mean a new agent reuses everything that already passed production — and Agent QA watches the whole fleet, with Evidently drift + degradation detection flagging any agent that regresses.',
  },
  {
    n: '4',
    name: 'Autonomous workflows',
    reality:
      'Durable, multi-step agent workflows that survive a crash and resume. Majority-machine, minority-human — humans only on the edges that matter.',
    console:
      'The agent-runtime port swaps to Temporal for durable execution; lineage (Marquez) and traces (Langfuse/OTLP) make every autonomous step replayable and explainable.',
  },
  {
    n: '5',
    name: 'Org-wide platform',
    reality:
      'Idea to product in days, with no platform team in the loop. Model risk is a board-level line item. Teams spin up new use cases self-serve, inside the guardrails.',
    console:
      'Multi-tenant provisioning, the governance registry, and IRDAI/RBI/SEBI/DPDP report packs turn the platform into something a regulator and a board can both sign off on.',
  },
];
