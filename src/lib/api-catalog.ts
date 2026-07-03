// The curated catalog of the console's public HTTP API surface — the single source of truth for the
// API docs & playground module. PURE and zero-import so it is trivially unit-testable and safe to
// import into either a server component or a client bundle.
//
// Each entry is hand-authored by inspecting the real route handlers under src/app/api/v1/**:
//   - `method` / `path` mirror the handler's exported verb + its file path
//   - `auth` reflects the gate the handler applies:
//       'public' — no auth (open status/health, or node↔console endpoints gated by a token in-body)
//       'user'   — requireUser / a signed-in session (any role)
//       'admin'  — requireAdmin / an admin-only session (or Bearer service token)
//   - `safeGet` marks a GET that is side-effect-free AND unauthenticated, so the in-page playground
//     may call it directly from the browser. Only genuinely safe endpoints get this.
// This module intentionally holds no logic — it is plain data.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type AuthLevel = 'public' | 'user' | 'admin';

export interface ApiParam {
  name: string;
  in: 'path' | 'query' | 'body';
  required?: boolean;
  description?: string;
}

export interface ApiEndpoint {
  method: HttpMethod;
  path: string;
  summary: string;
  auth: AuthLevel;
  /** Query/path/body params worth documenting. */
  params?: readonly ApiParam[];
  /** An illustrative response shape (not a live sample). */
  sampleResponse?: unknown;
  /** True only for side-effect-free, unauthenticated GETs the playground may call. */
  safeGet?: boolean;
}

export interface ApiArea {
  area: string;
  description: string;
  endpoints: readonly ApiEndpoint[];
}

export const API_CATALOG: readonly ApiArea[] = [
  {
    area: 'Status',
    description: 'Public health + status surface. No auth — for uptime monitors and status pages.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/status',
        summary:
          'Overall status rollup with per-service up/down + performance. 503 when everything is down.',
        auth: 'public',
        safeGet: true,
        sampleResponse: {
          status: 'operational',
          up: 6,
          total: 6,
          services: [
            { id: 'gateway', label: 'AI Gateway', status: 'up', performance: 'good', ms: 12 },
          ],
          checkedAt: '2026-07-01T00:00:00.000Z',
        },
      },
      {
        method: 'GET',
        path: '/api/v1/services/health',
        summary: 'Live health probe of every Off Grid service in the directory.',
        auth: 'public',
        safeGet: true,
      },
    ],
  },
  {
    area: 'Gateway',
    description:
      'The LLM gateway control + observability plane — nodes/models, traffic, logs, usage, and cost.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/gateway/nodes',
        summary: 'Per-node model view (load/switch/pull), proxied through the cluster gateway.',
        auth: 'public',
      },
      {
        method: 'GET',
        path: '/api/v1/gateway/analytics',
        summary: 'Gateway usage analytics (requests, tokens, latency) from OpenSearch.',
        auth: 'public',
      },
      {
        method: 'GET',
        path: '/api/v1/gateway/traffic',
        summary: 'Recent gateway traffic timeseries.',
        auth: 'public',
      },
      {
        method: 'GET',
        path: '/api/v1/gateway/logs',
        summary: 'Recent gateway request logs.',
        auth: 'public',
      },
      {
        method: 'GET',
        path: '/api/v1/gateway/finops',
        summary: 'Gateway cost + token spend rollup.',
        auth: 'public',
      },
      {
        method: 'GET',
        path: '/api/v1/gateway/config',
        summary: 'Read gateway runtime configuration.',
        auth: 'admin',
      },
      {
        method: 'GET',
        path: '/api/v1/gateway/tokens',
        summary: 'List issued gateway API tokens (secrets masked).',
        auth: 'admin',
      },
      {
        method: 'POST',
        path: '/api/v1/gateway/tokens',
        summary: 'Issue a new gateway API token (shown once).',
        auth: 'admin',
      },
    ],
  },
  {
    area: 'Files & Storage',
    description: 'On-prem, S3-compatible file storage — upload, browse, and share per-file.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/files',
        summary: 'List the caller-visible files.',
        auth: 'user',
      },
      {
        method: 'POST',
        path: '/api/v1/files',
        summary: 'Upload a file (public/private per file).',
        auth: 'user',
        params: [{ name: 'file', in: 'body', required: true, description: 'multipart file upload' }],
      },
      {
        method: 'GET',
        path: '/api/v1/files/{id}',
        summary: 'Fetch a single file’s metadata or content.',
        auth: 'user',
        params: [{ name: 'id', in: 'path', required: true }],
      },
    ],
  },
  {
    area: 'Knowledge',
    description:
      'Org knowledge base — permission-aware collections and documents, retrieved with citations.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/knowledge/collections',
        summary: 'List knowledge collections the caller’s role may retrieve.',
        auth: 'user',
      },
      {
        method: 'POST',
        path: '/api/v1/knowledge/collections',
        summary: 'Create a knowledge collection (admin only).',
        auth: 'admin',
      },
      {
        method: 'GET',
        path: '/api/v1/knowledge/collections/{id}/documents',
        summary: 'List documents in a collection.',
        auth: 'user',
        params: [{ name: 'id', in: 'path', required: true }],
      },
      {
        method: 'GET',
        path: '/api/v1/knowledge/documents/{docId}',
        summary: 'Fetch a single knowledge document.',
        auth: 'user',
        params: [{ name: 'docId', in: 'path', required: true }],
      },
      {
        method: 'GET',
        path: '/api/v1/search',
        summary: 'Search across the caller’s accessible knowledge.',
        auth: 'user',
        params: [{ name: 'q', in: 'query', required: true, description: 'search query' }],
      },
    ],
  },
  {
    area: 'Prompts',
    description: 'Reusable prompt library — save, tag, and organize prompt texts.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/prompts',
        summary: 'List the caller’s prompts.',
        auth: 'user',
      },
      {
        method: 'POST',
        path: '/api/v1/prompts',
        summary: 'Save a new prompt.',
        auth: 'user',
      },
      {
        method: 'GET',
        path: '/api/v1/prompts/{id}',
        summary: 'Fetch a single prompt.',
        auth: 'user',
        params: [{ name: 'id', in: 'path', required: true }],
      },
      {
        method: 'GET',
        path: '/api/v1/prompts/common',
        summary: 'Common prompts mined from what the org actually asks.',
        auth: 'user',
      },
    ],
  },
  {
    area: 'FinOps',
    description: 'Per-user/project token budgets and spend.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/finops/budgets',
        summary: 'List token budgets.',
        auth: 'user',
      },
      {
        method: 'POST',
        path: '/api/v1/finops/budgets',
        summary: 'Create a token budget (admin only).',
        auth: 'admin',
      },
      {
        method: 'GET',
        path: '/api/v1/finops/budgets/{id}',
        summary: 'Fetch a single budget.',
        auth: 'user',
        params: [{ name: 'id', in: 'path', required: true }],
      },
    ],
  },
  {
    area: 'Fleet',
    description: 'On-device nodes — enrollment, policy pull, audit push, and command polling.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/devices',
        summary: 'List the enrolled fleet.',
        auth: 'admin',
      },
      {
        method: 'POST',
        path: '/api/v1/devices/enroll',
        summary: 'Enroll a device with an admin-issued token.',
        auth: 'public',
        params: [
          { name: 'token', in: 'body', required: true, description: 'enrollment token' },
          { name: 'name', in: 'body', required: true },
          { name: 'os', in: 'body', required: true, description: 'macOS | iOS | Windows' },
        ],
      },
      {
        method: 'GET',
        path: '/api/v1/devices/{id}/policy',
        summary: 'Pull the current policy bundle for a device.',
        auth: 'public',
        params: [{ name: 'id', in: 'path', required: true }],
      },
      {
        method: 'POST',
        path: '/api/v1/devices/{id}/audit',
        summary: 'Push a batch of audit events from a device.',
        auth: 'public',
        params: [{ name: 'id', in: 'path', required: true }],
      },
      {
        method: 'GET',
        path: '/api/v1/devices/{id}/commands',
        summary: 'Poll pending commands (consumed on read).',
        auth: 'public',
        params: [{ name: 'id', in: 'path', required: true }],
      },
      {
        method: 'GET',
        path: '/api/v1/audit',
        summary: 'Fleet audit log, newest first.',
        auth: 'admin',
        params: [
          { name: 'deviceId', in: 'query' },
          { name: 'limit', in: 'query' },
        ],
      },
    ],
  },
  {
    area: 'Admin',
    description:
      'The admin control plane — tenants, access policy, routing, governance, and QA. Admin-only.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/admin/enroll-token',
        summary: 'Issue a device enrollment token.',
        auth: 'admin',
      },
      {
        method: 'GET',
        path: '/api/v1/admin/policy',
        summary: 'Get the current org policy bundle.',
        auth: 'admin',
      },
      {
        method: 'POST',
        path: '/api/v1/admin/policy',
        summary: 'Push a new org policy (bumps version).',
        auth: 'admin',
      },
      {
        method: 'POST',
        path: '/api/v1/admin/devices/{id}/kill',
        summary: 'Trigger the kill switch for a device.',
        auth: 'admin',
        params: [{ name: 'id', in: 'path', required: true }],
      },
      {
        method: 'GET',
        path: '/api/v1/admin/tenants',
        summary: 'List tenants.',
        auth: 'admin',
      },
      {
        method: 'POST',
        path: '/api/v1/admin/tenants',
        summary: 'Provision a tenant.',
        auth: 'admin',
      },
      {
        method: 'GET',
        path: '/api/v1/admin/abac-rules',
        summary: 'List ABAC access rules.',
        auth: 'admin',
      },
      {
        method: 'POST',
        path: '/api/v1/admin/abac/evaluate',
        summary: 'Evaluate an access decision (deny-overrides).',
        auth: 'admin',
      },
      {
        method: 'GET',
        path: '/api/v1/admin/routing',
        summary: 'List model routing rules by priority.',
        auth: 'admin',
      },
      {
        method: 'POST',
        path: '/api/v1/admin/retrieve',
        summary: 'Route a query by intent, returning fused, provenance-carrying hits.',
        auth: 'admin',
        params: [{ name: 'query', in: 'body', required: true }],
      },
      {
        method: 'GET',
        path: '/api/v1/admin/finops',
        summary: 'FinOps cost + usage metered from the audit log.',
        auth: 'admin',
      },
      {
        method: 'GET',
        path: '/api/v1/admin/qa/status',
        summary: 'Agent-QA summary — offline score, drift verdict, online-scoring state.',
        auth: 'admin',
      },
      {
        method: 'POST',
        path: '/api/v1/admin/qa/sweep',
        summary:
          'Scheduled QA sweep — eval + drift → degradation verdict (200 healthy / 503 degraded).',
        auth: 'admin',
      },
    ],
  },
] as const;

// Flattened view — every endpoint, area-tagged. Handy for tests and search.
export function allEndpoints(): (ApiEndpoint & { area: string })[] {
  return API_CATALOG.flatMap((a) => a.endpoints.map((e) => ({ ...e, area: a.area })));
}

// The endpoints the in-page playground is allowed to call: safe, unauthenticated GETs only.
export function playgroundEndpoints(): ApiEndpoint[] {
  return allEndpoints().filter((e) => e.safeGet === true && e.method === 'GET');
}
