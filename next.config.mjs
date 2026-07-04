const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
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
      "font-src 'self'",
      "connect-src 'self' https://gateway.getoffgridai.co https://us.i.posthog.com https://us-assets.i.posthog.com",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  // Native / vendored-binary packages — keep them out of the webpack bundle (require at runtime).
  // c2pa-node ships a native binding + a vendored sharp; sigstore is required server-side only.
  // @offgrid/gateway pulls in @temporalio/worker (swc/wasm native binaries) that webpack cannot
  // bundle — keep it external so the node control API routes require it at runtime.
  serverExternalPackages: ['@lancedb/lancedb', 'c2pa-node', 'sigstore'],
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
