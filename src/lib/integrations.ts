// The open-source tools the console orchestrates, by layer. The console is the control
// plane that makes these work together — some are embedded today (Postgres, LanceDB,
// Auth.js, llama.cpp via the gateway), the rest plug in per deployment.
export interface IntegrationLayer {
  layer: string;
  blurb: string;
  tools: string[];
}

export const INTEGRATIONS: IntegrationLayer[] = [
  {
    layer: 'AI Gateway',
    blurb:
      'Off Grid AI Gateway — an OpenAI-compatible, multimodal, MCP-native inference endpoint running fully on-device at 127.0.0.1:7878.',
    tools: ['Off Grid AI Gateway'],
  },
  {
    layer: 'Guardrails',
    blurb: 'Input/output policy — PII, injection, grounding.',
    tools: ['NeMo Guardrails', 'Guardrails AI', 'Microsoft Presidio', 'Rebuff'],
  },
  {
    layer: 'Observability & Logs',
    blurb: 'Traces, metrics, and the log store — the modern ELK.',
    tools: ['OpenTelemetry', 'Langfuse', 'SigNoz', 'VictoriaMetrics', 'VictoriaLogs'],
  },
  {
    layer: 'Evals & Red-team',
    blurb: 'Golden sets and quality gates, not one-time checks.',
    tools: ['Promptfoo', 'DeepEval', 'Ragas', 'Garak', 'Inspect'],
  },
  {
    layer: 'Policy & Authorization',
    blurb: 'Per-user, per-purpose policy as code.',
    tools: ['Open Policy Agent', 'Cedar', 'OpenFGA'],
  },
  {
    layer: 'Identity & Secrets',
    blurb: 'SSO and key management.',
    tools: ['Keycloak', 'Auth.js', 'OpenBao'],
  },
  {
    layer: 'Knowledge / RAG (Brain)',
    blurb: 'Ingestion→retrieval with citations.',
    tools: ['LanceDB', 'LlamaIndex', 'BGE embeddings'],
  },
  {
    layer: 'Data & Ingestion',
    blurb: 'Connect databases and warehouses; mask on the way in.',
    tools: [
      'Debezium',
      'Meltano',
      'Apache Kafka',
      'Apache Spark',
      'Apache Iceberg',
      'Trino',
      'SeaweedFS',
    ],
  },
  {
    layer: 'Lineage & Provenance',
    blurb: 'Every answer traceable to a signed source.',
    tools: ['OpenLineage', 'Marquez', 'Sigstore'],
  },
  {
    layer: 'Agent runtime & durability',
    blurb: 'Start with one lightweight runtime; add multi-agent only when work truly needs it.',
    tools: ['Agno', 'Pydantic AI', 'LangGraph', 'Temporal'],
  },
  {
    layer: 'Runtime Security',
    blurb: 'Sandboxing and exfil prevention.',
    tools: ['E2B', 'Firecracker', 'Falco'],
  },
  {
    layer: 'Datastore',
    blurb: 'The console’s own state and audit.',
    tools: ['PostgreSQL', 'Drizzle'],
  },
  {
    layer: 'Fleet Control (MDM)',
    blurb: 'Manage the devices running AI — provision, policy, audit, kill-switch.',
    tools: ['FleetDM', 'osquery'],
  },
];
