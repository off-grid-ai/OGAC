const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // microphone=(self): chat voice-input (STT) uses getUserMedia, which the browser blocks entirely
  // unless the origin is permitted here — `(self)` lets OUR page prompt for the mic (same-origin
  // only, no third-party/iframe access), so the normal browser permission dialog appears.
  // camera=(self) likewise for future voice/video. geolocation stays fully disabled.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://us-assets.i.posthog.com",
      "style-src 'self' 'unsafe-inline'",
      // gateway.getoffgridai.co serves the SeaweedFS file store (images/video previews in Storage,
      // knowledge-base files, artifacts) — allow it as an image/media/fetch source.
      "img-src 'self' data: blob: https://gateway.getoffgridai.co https://us.i.posthog.com https://us-assets.i.posthog.com",
      "media-src 'self' blob: https://gateway.getoffgridai.co",
      // data: — fonts are embedded as base64 data: URIs (woff/woff2); without this they're CSP-blocked
      // and text falls back to system fonts console-wide.
      "font-src 'self' data:",
      "connect-src 'self' https://gateway.getoffgridai.co https://us.i.posthog.com https://us-assets.i.posthog.com",
      // cal.com booking widget embedded (iframe only) in the sign-in "Book a call" modal. No cal
      // script is loaded — script-src stays tight; this only permits framing cal.com's booking page.
      "frame-src 'self' https://cal.com https://app.cal.com",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

// ─── T6 RESTful URL hierarchy (task #177) ─────────────────────────────────────────────────────────
// Every route now lives under its section segment (workspace/build/gateway/data/governance/insights/
// operations). URLs are a contract — bookmarks, deep-links, and doc screenshots must keep working —
// so every OLD flat path 301-redirects to its new nested home, including the `/:id`/`/:path*` param
// forms so detail-page deep links survive. Pure config; the folder moves + registry own the live map.
//
// Each entry maps an old top-level segment to its new prefix. We emit two rules per segment: the bare
// path and a wildcard (`/:path*`) so children (detail ids, tab sub-paths, query strings) carry over.
const SECTION_REDIRECTS = [
  // Workspace
  ['/chat', '/workspace/chat'],
  ['/knowledge', '/workspace/knowledge'],
  ['/storage', '/workspace/storage'],
  ['/projects', '/workspace/projects'],
  ['/prompts', '/workspace/prompts'],
  ['/artifacts', '/workspace/artifacts'],
  // Build
  ['/studio', '/build/studio'],
  ['/apps', '/build/apps'],
  ['/agents', '/build/agents'],
  ['/agent-runs', '/build/agent-runs'],
  ['/tools', '/build/tools'],
  ['/brain', '/build/brain'],
  ['/evals', '/build/evals'],
  ['/sandbox', '/build/sandbox'],
  ['/pipelines', '/build/pipelines'],
  // Gateway & Fleet (resolves the AI-Gateway / Gateways / Services IA overlap).
  // NB: `/gateway` (the old aggregator page) had NO children AND `/gateway` is now the SECTION
  // prefix for the live nested routes (/gateway/services, /gateway/registry, …). A wildcard here
  // would hijack those live paths, so `/gateway` is bare-only (see bareOnly below).
  ['/services', '/gateway/services'],
  ['/gateway', '/gateway/ai', { bareOnly: true }],
  ['/gateways', '/gateway/registry'],
  ['/fleet', '/gateway/fleet'],
  ['/edge', '/gateway/edge'],
  // Data
  ['/integrations', '/data/integrations'],
  ['/connectors', '/data/connectors'],
  ['/data-domains', '/data/domains'],
  ['/retrieval', '/data/retrieval'],
  ['/lineage', '/data/lineage'],
  ['/tool-catalog', '/data/tool-catalog'],
  // Governance (landing rename: /control → /governance)
  ['/control', '/governance'],
  ['/policy', '/governance/policy'],
  ['/access', '/governance/access'],
  ['/guardrails', '/governance/guardrails'],
  ['/secrets', '/governance/secrets'],
  ['/regulatory', '/governance/regulatory'],
  ['/provenance', '/governance/provenance'],
  // Insights (landing rename: /observability → /insights)
  ['/observability', '/insights'],
  ['/analytics', '/insights/analytics'],
  ['/drift', '/insights/drift'],
  ['/finops', '/insights/finops'],
  ['/accounting', '/insights/accounting'],
  ['/reports', '/insights/reports'],
  ['/siem', '/insights/siem'],
  ['/audit', '/insights/audit'],
  // Operations
  ['/admin', '/operations/admin'],
  ['/config', '/operations/config'],
  ['/backups', '/operations/backups'],
  ['/api-docs', '/operations/api-docs'],
];

function urlRedirects() {
  const rules = [];
  for (const [from, to, opts] of SECTION_REDIRECTS) {
    // bare path (e.g. /policy → /governance/policy)
    rules.push({ source: from, destination: to, permanent: true });
    // children: detail ids, tab sub-paths, and nested routes (e.g. /gateways/:id →
    // /gateway/registry/:id, /pipelines/:id/policy → /build/pipelines/:id/policy). Skipped when the
    // old segment now doubles as a live SECTION prefix (opts.bareOnly), so we never hijack a new route.
    if (!opts?.bareOnly) {
      rules.push({ source: `${from}/:path*`, destination: `${to}/:path*`, permanent: true });
    }
  }
  return rules;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  async redirects() {
    return urlRedirects();
  },
  // Native / vendored-binary packages — keep them out of the webpack bundle (require at runtime).
  // c2pa-node ships a native binding + a vendored sharp; sigstore is required server-side only.
  // @offgrid/gateway pulls in @temporalio/worker (swc/wasm native binaries) that webpack cannot
  // bundle — keep it external so the node control API routes require it at runtime.
  // @temporalio/client is bound only via a dynamic import in the durable agent-runtime adapter
  // (src/lib/adapters/agentruntime.ts) — required at runtime on the server path, never bundled.
  // @temporalio/worker + /workflow are used only by the standalone worker process (src/worker/,
  // scripts/temporal-worker.mts), never by a Next route; external here as belt-and-suspenders so
  // their swc/wasm native binaries are never pulled into the webpack bundle.
  serverExternalPackages: [
    '@lancedb/lancedb',
    'c2pa-node',
    'sigstore',
    '@temporalio/client',
    '@temporalio/worker',
    '@temporalio/workflow',
  ],
  // Stable build id so the multiple console instances behind the edge LB produce identical
  // asset hashes — otherwise /_next/static/* 404s when a request lands on the other instance.
  generateBuildId: () => process.env.OFFGRID_BUILD_ID ?? 'offgrid-onprem',
  webpack: (config) => {
    // @offgrid/gateway (file: dep) transitively imports @temporalio/worker, which loads swc
    // native/wasm binaries webpack cannot bundle. The console only uses gateway's HTTP client
    // helpers (clusterModels), never the Temporal worker, so stub that unreachable branch out.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@temporalio/worker': false,
    };
    return config;
  },
};

export default nextConfig;
