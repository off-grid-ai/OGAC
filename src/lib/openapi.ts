// Hand-authored OpenAPI 3.1 spec for the node↔console contract. Served at /openapi.json and
// rendered as an interactive playground at /docs (Scalar). The contract IS the product for
// "API only" customers, so the docs ship from day one.
const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Device id.',
} as const;

const listOf = (ref: string) => ({
  type: 'object',
  properties: {
    object: { type: 'string', enum: ['list'] },
    data: { type: 'array', items: { $ref: ref } },
  },
});

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Off Grid AI Console API',
    version: '0.1.0',
    description:
      'The node↔console contract for the common control plane. Nodes enroll, pull policy, ' +
      'push audit, and poll commands; admins issue tokens, push policy, trigger the kill ' +
      'switch, and read the fleet audit. On-prem, local-first.\n\n' +
      '📖 **[Open the Handbook](/handbook)** — concepts, integration guides, operations, ' +
      'and runbooks for the whole platform.',
  },
  externalDocs: {
    description: 'Handbook — concepts, integrations, operations & runbooks',
    url: '/handbook',
  },
  servers: [{ url: '/', description: 'This deployment' }],
  tags: [
    { name: 'node', description: 'Called by Off Grid AI nodes (Desktop/Mobile).' },
    { name: 'admin', description: 'Called by the console / admins.' },
    {
      name: 'agent-qa',
      description: 'Automated agent QA — offline evals, online scoring, drift & degradation.',
    },
    {
      name: 'provenance',
      description: 'Tamper-evidence — C2PA image credentials, Sigstore, ed25519 export manifests.',
    },
    { name: 'sandbox', description: 'Isolated execution of agent-authored code.' },
    { name: 'mdm', description: 'Fleet Control — device management (first-party registry / FleetDM).' },
  ],
  paths: {
    '/api/v1/devices': {
      get: {
        tags: ['admin'],
        summary: 'List devices',
        responses: {
          '200': {
            description: 'The fleet.',
            content: { 'application/json': { schema: listOf('#/components/schemas/Device') } },
          },
        },
      },
    },
    '/api/v1/devices/enroll': {
      post: {
        tags: ['node'],
        summary: 'Enroll a device',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'name', 'os'],
                properties: {
                  token: { type: 'string', description: 'Admin-issued enrollment token.' },
                  name: { type: 'string' },
                  os: { type: 'string', enum: ['macOS', 'iOS', 'Windows'] },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Enrolled; device identity issued.' },
          '400': { description: 'Missing fields.' },
          '401': { description: 'Invalid or used token.' },
        },
      },
    },
    '/api/v1/devices/{id}/policy': {
      get: {
        tags: ['node'],
        summary: 'Pull policy bundle',
        parameters: [idParam],
        responses: {
          '200': {
            description: 'Current policy.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/PolicyBundle' } },
            },
          },
          '404': { description: 'Unknown device.' },
        },
      },
    },
    '/api/v1/devices/{id}/audit': {
      post: {
        tags: ['node'],
        summary: 'Push audit batch',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  events: { type: 'array', items: { $ref: '#/components/schemas/AuditEvent' } },
                },
              },
            },
          },
        },
        responses: {
          '202': { description: 'Accepted.' },
          '404': { description: 'Unknown device.' },
        },
      },
    },
    '/api/v1/devices/{id}/commands': {
      get: {
        tags: ['node'],
        summary: 'Poll commands',
        parameters: [idParam],
        responses: {
          '200': {
            description: 'Pending commands (consumed on read).',
            content: { 'application/json': { schema: listOf('#/components/schemas/Command') } },
          },
        },
      },
    },
    '/api/v1/admin/enroll-token': {
      post: {
        tags: ['admin'],
        summary: 'Issue enrollment token',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { role: { type: 'string' } } },
            },
          },
        },
        responses: { '201': { description: 'Token issued.' } },
      },
    },
    '/api/v1/admin/policy': {
      get: {
        tags: ['admin'],
        summary: 'Get org policy',
        responses: {
          '200': {
            description: 'Current org policy.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/PolicyBundle' } },
            },
          },
        },
      },
      post: {
        tags: ['admin'],
        summary: 'Push policy (bumps version)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  egressAllowed: { type: 'boolean' },
                  guardrails: { type: 'array', items: { type: 'string' } },
                  allowedModels: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'New policy version.' } },
      },
    },
    '/api/v1/admin/devices/{id}/kill': {
      post: {
        tags: ['admin'],
        summary: 'Trigger kill switch',
        parameters: [idParam],
        responses: {
          '202': { description: 'Kill command queued.' },
          '404': { description: 'Unknown device.' },
        },
      },
    },
    '/api/v1/audit': {
      get: {
        tags: ['admin'],
        summary: 'Fleet audit log',
        parameters: [
          { name: 'deviceId', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'Audit events, newest first.',
            content: { 'application/json': { schema: listOf('#/components/schemas/AuditEvent') } },
          },
        },
      },
    },
    '/api/v1/admin/connectors': {
      get: {
        tags: ['admin'],
        summary: 'List data connectors',
        responses: { '200': { description: 'Connectors.' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Add a connector',
        responses: { '201': { description: 'Created.' }, '400': { description: 'Invalid.' } },
      },
    },
    '/api/v1/admin/connectors/{id}': {
      delete: {
        tags: ['admin'],
        summary: 'Delete a connector',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted.' } },
      },
    },
    '/api/v1/admin/connectors/{id}/sync': {
      post: {
        tags: ['admin'],
        summary: 'Trigger a connector sync (creates an ingest job)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '202': { description: 'Sync queued.' },
          '404': { description: 'Unknown connector.' },
        },
      },
    },
    '/api/v1/admin/ingest-jobs': {
      get: {
        tags: ['admin'],
        summary: 'List ingest jobs',
        responses: { '200': { description: 'Jobs.' } },
      },
    },
    '/api/v1/admin/datasets': {
      get: {
        tags: ['admin'],
        summary: 'List datasets (catalog + classification)',
        responses: { '200': { description: 'Datasets.' } },
      },
    },
    '/api/v1/admin/masking-rules': {
      get: {
        tags: ['admin'],
        summary: 'List masking rules',
        responses: { '200': { description: 'Rules.' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Create a masking rule',
        responses: { '201': { description: 'Created.' }, '400': { description: 'Invalid.' } },
      },
    },
    '/api/v1/admin/masking-rules/{id}': {
      patch: {
        tags: ['admin'],
        summary: 'Enable/disable a masking rule',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated.' }, '400': { description: 'Invalid.' } },
      },
    },
    '/api/v1/admin/erasure': {
      post: {
        tags: ['admin'],
        summary: 'Right-to-erasure (DSAR) over a subject scope',
        responses: { '200': { description: 'Erased count.' } },
      },
    },
    '/api/v1/admin/users': {
      get: {
        tags: ['admin'],
        summary: 'List console users (RBAC)',
        responses: { '200': { description: 'Users.' } },
      },
    },
    '/api/v1/admin/users/{id}': {
      patch: {
        tags: ['admin'],
        summary: 'Set a user role',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated.' }, '400': { description: 'Invalid role.' } },
      },
    },
    '/api/v1/admin/policy/history': {
      get: {
        tags: ['admin'],
        summary: 'Policy version history',
        responses: { '200': { description: 'Versions, newest first.' } },
      },
    },
    '/api/v1/admin/analytics': {
      get: {
        tags: ['admin'],
        summary: 'Usage analytics (latency p50/p95, outcomes, drift/perf signals)',
        responses: { '200': { description: 'Analytics.' } },
      },
    },
    '/api/v1/admin/compliance': {
      get: {
        tags: ['admin'],
        summary: 'Compliance posture + framework coverage',
        responses: { '200': { description: 'Compliance.' } },
      },
    },
    '/api/v1/admin/compliance/export': {
      get: {
        tags: ['admin'],
        summary: 'Download the compliance evidence pack (Markdown)',
        parameters: [{ name: 'framework', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: 'Markdown attachment.' } },
      },
    },
    '/api/v1/admin/brain/documents': {
      get: {
        tags: ['admin'],
        summary: 'List Brain documents',
        responses: { '200': { description: 'Documents.' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Add a document (embed + index)',
        responses: { '201': { description: 'Indexed.' }, '400': { description: 'Invalid.' } },
      },
    },
    '/api/v1/admin/brain/search': {
      get: {
        tags: ['admin'],
        summary: 'Semantic search over the Brain (citation set)',
        parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: 'Scored hits.' } },
      },
    },
    '/api/v1/admin/tenants': {
      get: {
        tags: ['admin'],
        summary: 'List tenants',
        responses: { '200': { description: 'Tenants.' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Provision a tenant',
        responses: { '201': { description: 'Created.' }, '400': { description: 'Missing name.' } },
      },
    },
    '/api/v1/admin/tenants/{id}': {
      patch: {
        tags: ['admin'],
        summary: 'Update provisioned modules',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Updated.' },
          '404': { description: 'Unknown tenant.' },
        },
      },
      delete: {
        tags: ['admin'],
        summary: 'Delete a tenant',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted.' } },
      },
    },
    '/api/v1/admin/abac-rules': {
      get: {
        tags: ['admin'],
        summary: 'List ABAC rules',
        responses: { '200': { description: 'Rules.' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Create an ABAC rule',
        responses: { '201': { description: 'Created.' }, '400': { description: 'Invalid.' } },
      },
    },
    '/api/v1/admin/abac-rules/{id}': {
      delete: {
        tags: ['admin'],
        summary: 'Delete an ABAC rule',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted.' } },
      },
    },
    '/api/v1/admin/abac/evaluate': {
      post: {
        tags: ['admin'],
        summary: 'Evaluate an access decision (deny-overrides)',
        responses: { '200': { description: 'Decision { allow, matched }.' } },
      },
    },
    '/api/v1/admin/brain/ingest': {
      post: {
        tags: ['admin'],
        summary: 'Ingest a source into the Brain (text / file / image / database)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['kind'],
                properties: {
                  kind: { type: 'string', enum: ['text', 'file', 'image', 'database'] },
                  title: { type: 'string' },
                  name: { type: 'string' },
                  text: { type: 'string' },
                  source: { type: 'string' },
                  dataUrl: { type: 'string', description: 'base64 data URL (image)' },
                  datasetId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Ingested document.' },
          '400': { description: 'Missing fields.' },
          '404': { description: 'Unknown dataset.' },
        },
      },
    },
    '/api/v1/admin/tools': {
      get: {
        tags: ['admin'],
        summary: 'List registered tools (the router’s tool source)',
        responses: { '200': { description: 'Tools.' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Register a tool (http | mcp)',
        responses: { '201': { description: 'Created.' }, '400': { description: 'Invalid.' } },
      },
    },
    '/api/v1/admin/tools/{id}': {
      patch: {
        tags: ['admin'],
        summary: 'Enable/disable a tool',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated.' }, '400': { description: 'Invalid.' } },
      },
      delete: {
        tags: ['admin'],
        summary: 'Delete a tool',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted.' } },
      },
    },
    '/api/v1/admin/routing': {
      get: {
        tags: ['admin'],
        summary: 'List model routing rules (by priority)',
        responses: { '200': { description: 'Rules.' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Add a routing rule (condition → local|cloud|block)',
        responses: { '201': { description: 'Created.' }, '400': { description: 'Invalid.' } },
      },
    },
    '/api/v1/admin/routing/{id}': {
      patch: {
        tags: ['admin'],
        summary: 'Enable/disable a routing rule',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated.' }, '400': { description: 'Invalid.' } },
      },
      delete: {
        tags: ['admin'],
        summary: 'Delete a routing rule',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted.' } },
      },
    },
    '/api/v1/admin/routing/evaluate': {
      post: {
        tags: ['admin'],
        summary: 'Evaluate where a request routes given its attributes (cloud leashed by egress)',
        responses: { '200': { description: 'Routing decision.' } },
      },
    },
    '/api/v1/admin/flags': {
      get: {
        tags: ['admin'],
        summary: 'List feature flags (runtime toggles)',
        responses: { '200': { description: 'Flags.' } },
      },
      patch: {
        tags: ['admin'],
        summary: 'Toggle a feature flag',
        responses: { '200': { description: 'Updated.' }, '400': { description: 'Invalid.' } },
      },
    },
    '/api/v1/admin/prompts': {
      get: {
        tags: ['admin'],
        summary: 'List prompt templates',
        responses: { '200': { description: 'Prompts.' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Create a prompt template',
        responses: { '201': { description: 'Created.' }, '400': { description: 'Invalid.' } },
      },
    },
    '/api/v1/admin/prompts/{id}/versions': {
      get: {
        tags: ['admin'],
        summary: 'List a prompt’s versions',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Versions, newest first.' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Publish a new immutable prompt version',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '201': { description: 'Created.' },
          '404': { description: 'Unknown prompt.' },
        },
      },
    },
    '/api/v1/admin/sign': {
      post: {
        tags: ['admin'],
        summary: 'Sign a payload (or verify with `signature`) — tamper-evident provenance',
        responses: {
          '201': { description: 'Signature.' },
          '200': { description: 'Verification result.' },
          '400': { description: 'Invalid.' },
        },
      },
    },
    '/api/v1/admin/cache': {
      get: {
        tags: ['admin'],
        summary: 'Response-cache stats (size, hit rate, exact vs semantic)',
        responses: { '200': { description: 'Cache stats.' } },
      },
    },
    '/api/v1/admin/governance': {
      get: {
        tags: ['admin'],
        summary: 'List governance items (Phase E org/regulatory wrapper)',
        responses: { '200': { description: 'Items.' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Add a governance item (policy / ethics_review / raci / training / vendor / …)',
        responses: { '201': { description: 'Created.' }, '400': { description: 'Invalid.' } },
      },
    },
    '/api/v1/admin/governance/{id}': {
      delete: {
        tags: ['admin'],
        summary: 'Delete a governance item',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted.' } },
      },
    },
    '/api/v1/admin/keys': {
      get: {
        tags: ['admin'],
        summary: 'List virtual keys (token issuance)',
        responses: { '200': { description: 'Keys.' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Issue a virtual key (scoped to user|project, optional budget) — token shown once',
        responses: {
          '201': { description: 'Issued { key, token }.' },
          '400': { description: 'Invalid.' },
        },
      },
    },
    '/api/v1/admin/keys/{id}': {
      patch: {
        tags: ['admin'],
        summary: 'Enable/disable (revoke) a key',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated.' }, '400': { description: 'Invalid.' } },
      },
      delete: {
        tags: ['admin'],
        summary: 'Delete a key',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted.' } },
      },
    },
    '/api/v1/admin/finops': {
      get: {
        tags: ['admin'],
        summary: 'FinOps: cost + usage metered from the audit log (by model / key / subject)',
        responses: { '200': { description: 'FinOps rollup.' } },
      },
    },
    '/api/v1/admin/sources': {
      get: {
        tags: ['admin'],
        summary: 'List retrieval destinations the router can route to (KB / database / tool)',
        responses: { '200': { description: 'Sources.' } },
      },
    },
    '/api/v1/admin/retrieve': {
      post: {
        tags: ['admin'],
        summary: 'Route a query by intent and return fused, provenance-carrying hits',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: { query: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Route result { query, decision, hits[] }.' },
          '400': { description: 'Missing query.' },
        },
      },
    },
    '/api/v1/admin/grounding/verify': {
      post: {
        tags: ['admin'],
        summary: 'Verify an answer against cited sources (standalone — no Brain required)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['answer', 'sources'],
                properties: {
                  answer: { type: 'string' },
                  sources: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { id: { type: 'string' }, text: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Grounding result { score, verdicts[] }.' },
          '400': { description: 'Invalid body.' },
        },
      },
    },
    '/api/v1/admin/agents': {
      get: {
        tags: ['admin'],
        summary: 'List pre-built agent use cases + derived activity',
        responses: { '200': { description: 'Agent catalog.' } },
      },
    },
    '/api/v1/admin/agents/runs': {
      get: {
        tags: ['admin'],
        summary: 'List agent run traces (steps + provenance + citations)',
        responses: { '200': { description: 'Runs.' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Execute an agent over a query and record a traced run',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['agentId', 'query'],
                properties: { agentId: { type: 'string' }, query: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Run trace { steps[], answer, citations[] }.' },
          '400': { description: 'Invalid.' },
          '404': { description: 'Unknown agent.' },
        },
      },
    },
    '/api/v1/admin/reports': {
      get: {
        tags: ['admin'],
        summary: 'List regulator-ready report types',
        responses: { '200': { description: 'Report catalog.' } },
      },
    },
    '/api/v1/admin/reports/{id}/export': {
      get: {
        tags: ['admin'],
        summary: 'Generate a report live and download it (Markdown)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Markdown attachment.' },
          '404': { description: 'Unknown report.' },
        },
      },
    },
    '/api/v1/admin/adapters': {
      get: {
        tags: ['admin'],
        summary: 'List capability→adapter bindings (which OSS tool serves each capability)',
        parameters: [
          {
            name: 'health',
            in: 'query',
            schema: { type: 'string', enum: ['1'] },
            description: 'Probe the live inference backend.',
          },
        ],
        responses: { '200': { description: 'Bindings { capability, active, alternatives }.' } },
      },
    },
    '/api/v1/admin/golden-cases': {
      get: {
        tags: ['admin'],
        summary: 'List golden cases',
        responses: { '200': { description: 'Cases.' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Add a golden case',
        responses: { '201': { description: 'Created.' }, '400': { description: 'Invalid.' } },
      },
    },
    '/api/v1/admin/evals': {
      get: {
        tags: ['admin'],
        summary: 'List eval runs',
        responses: { '200': { description: 'Runs.' } },
      },
    },
    '/api/v1/admin/evals/run': {
      post: {
        tags: ['admin'],
        summary: 'Run an offline eval through the active adapter (golden / promptfoo / Ragas)',
        description:
          'Runs the evals capability’s active adapter (OFFGRID_ADAPTER_EVALS). golden (default) scores recall over the Brain; promptfoo runs an assertion matrix via its CLI; Ragas calls a sidecar. OSS adapters fall back to golden if unavailable.',
        responses: { '201': { description: 'Scored run (EvalRunResult).' } },
      },
    },
    '/api/v1/admin/qa/drift': {
      get: {
        tags: ['agent-qa'],
        summary: 'Drift / degradation report',
        description:
          'Compares a recent window of eval scores against a baseline window. Active drift adapter (OFFGRID_ADAPTER_DRIFT): native (Population Stability Index + mean-degradation, default) or evidently. Returns status stable | warning | drift.',
        responses: { '200': { description: 'DriftReport.' } },
      },
    },
    '/api/v1/admin/qa/score': {
      post: {
        tags: ['agent-qa'],
        summary: 'Online eval — judge one interaction and push scores to Langfuse',
        description:
          'LLM-as-judge (via the gateway) scores an interaction’s quality + faithfulness, then writes the scores to Langfuse (where they trend over time = the degradation signal). Gated by the `online-evals` feature flag. Degrades gracefully: judged:false if the gateway is unreachable, posted:false if Langfuse is.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['input', 'output'],
                properties: {
                  input: { type: 'string' },
                  output: { type: 'string' },
                  sources: { type: 'array', items: { type: 'string' } },
                  traceId: { type: 'string', description: 'attach scores to an existing trace' },
                  name: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'ScoreResult (traceId, verdict, judged, posted).' } },
      },
    },
    '/api/v1/admin/qa/status': {
      get: {
        tags: ['agent-qa'],
        summary: 'Agent-QA summary — offline score, drift verdict, online-scoring state',
        description:
          'One call answering "are the agents still doing a good job?": latest offline eval score, the drift/degradation verdict, and whether online scoring is configured + enabled.',
        responses: { '200': { description: 'QA summary (offline, drift, online).' } },
      },
    },
    '/api/v1/admin/qa/sweep': {
      post: {
        tags: ['agent-qa'],
        summary: 'Scheduled QA sweep — eval + drift → degradation verdict',
        description:
          'Run on a cadence (cron / CI). Runs an offline eval + drift analysis, emits a `qa.sweep` span (alert on degraded=true), and returns the verdict. 200 healthy, 503 degraded — so a monitor / CI gate can react to the status code.',
        responses: {
          '200': { description: 'Healthy sweep { degraded:false, eval, drift }.' },
          '503': { description: 'Degraded sweep { degraded:true, reasons, eval, drift }.' },
        },
      },
    },
    '/api/v1/admin/provenance/c2pa': {
      post: {
        tags: ['provenance'],
        summary: 'C2PA Content Credentials for images (sign / verify)',
        description:
          'POST { image (base64), mimeType: image/png|image/jpeg, action?: sign|verify }. sign embeds a signed manifest (c2pa-node, bundled signer — no fees/keys); verify reads + validates it. Text/document exports use the ed25519 detached manifest instead.',
        responses: {
          '201': { description: 'Signed image { image (base64), bytes }.' },
          '200': { description: 'Verify result { hasManifest, valid, ... }.' },
        },
      },
    },
    '/api/v1/admin/provenance/sigstore': {
      get: {
        tags: ['provenance'],
        summary: 'Sigstore signing availability',
        responses: { '200': { description: '{ signingConfigured }.' } },
      },
      post: {
        tags: ['provenance'],
        summary: 'Sigstore keyless sign / verify',
        description:
          'POST { action: sign|verify, payload?, identityToken?, bundle? }. sign → keyless Sigstore bundle (public-good Fulcio/Rekor, free; OFFGRID_FULCIO_URL/_REKOR_URL to self-host; needs an OIDC identity token). verify → standalone bundle verification.',
        responses: {
          '201': { description: 'Sigstore bundle.' },
          '200': { description: 'Verify result { valid, error? }.' },
        },
      },
    },
    '/api/v1/admin/provenance/verify': {
      post: {
        tags: ['provenance'],
        summary: 'Verify a detached export provenance manifest',
        description:
          'POST { manifest, sha256? }. Verifies the manifest signature with the active signing port (ed25519 needs only the public key) and, if sha256 is given, that it matches the file.',
        responses: { '200': { description: 'Verify result { signatureValid, hashMatches?, algorithm }.' } },
      },
    },
    '/api/v1/admin/sandbox/run': {
      post: {
        tags: ['sandbox'],
        summary: 'Run agent-authored code in the active sandbox',
        description:
          'POST { language: python|node, code, timeoutMs? }. Double-gated: the agent-code-exec flag (default OFF) and the no-exec default both must allow it. Engine: none (refuses) | docker (ephemeral, network-disabled, resource-capped container — free, no key, no Linux/KVM host).',
        responses: {
          '200': { description: 'Run result { engine, ok, stdout, stderr, exitCode, timedOut }.' },
          '403': { description: 'Refused — flag off or no-exec default.' },
        },
      },
    },
    '/api/v1/admin/mdm/devices': {
      get: {
        tags: ['mdm'],
        summary: 'Fleet Control device inventory',
        description:
          'Devices through the active MDM adapter (OFFGRID_ADAPTER_MDM): the first-party device registry by default, or FleetDM (osquery, MIT Fleet Free) when selected. FleetDM falls back to the first-party registry if unreachable.',
        responses: { '200': { description: 'Device list { backend, data[] }.' } },
      },
    },
  },
  components: {
    schemas: {
      Tenant: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          plan: { type: 'string' },
          enabledModules: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      AbacRule: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          role: { type: 'string' },
          attribute: { type: 'string' },
          operator: { type: 'string', enum: ['eq', 'neq', 'in'] },
          value: { type: 'string' },
          resource: { type: 'string' },
          effect: { type: 'string', enum: ['allow', 'deny'] },
        },
      },
      Device: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          os: { type: 'string', enum: ['macOS', 'iOS', 'Windows'] },
          role: { type: 'string' },
          status: { type: 'string', enum: ['online', 'offline'] },
          lastSeen: { type: 'string' },
          policyVersion: { type: 'integer' },
          enrolledAt: { type: 'string', format: 'date-time' },
        },
      },
      PolicyBundle: {
        type: 'object',
        properties: {
          version: { type: 'integer' },
          egressAllowed: { type: 'boolean' },
          guardrails: { type: 'array', items: { type: 'string' } },
          allowedModels: { type: 'array', items: { type: 'string' } },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AuditEvent: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          deviceId: { type: 'string' },
          ts: { type: 'string', format: 'date-time' },
          model: { type: 'string' },
          tokens: { type: 'integer' },
          leftDevice: { type: 'boolean' },
          tool: { type: ['string', 'null'] },
          outcome: { type: 'string', enum: ['ok', 'blocked', 'redacted'] },
          latencyMs: { type: 'integer' },
          checks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                verdict: { type: 'string', enum: ['pass', 'warn', 'redacted', 'blocked', 'fail'] },
                score: { type: 'number' },
                ms: { type: 'integer' },
              },
            },
          },
        },
      },
      Command: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          deviceId: { type: 'string' },
          type: { type: 'string', enum: ['kill', 'reprovision'] },
          createdAt: { type: 'string', format: 'date-time' },
          consumed: { type: 'boolean' },
        },
      },
    },
  },
} as const;
