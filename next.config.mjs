import { nextRedirects } from './src/modules/route-migrations.mjs';

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

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Client-side Router Cache TTL. Next 15 defaults `dynamic` to 0s, so every re-visit to a
    // (dynamic) route refetches its RSC payload from the server — brutal here because the console
    // is served over a Cloudflare tunnel to an on-prem Mac, so each nav is a full round-trip. Caching
    // the payload for a short window makes moving BACK to an already-seen page instant (no server
    // hit), while still refreshing within the window so data never goes stale for long.
    staleTimes: { dynamic: 30, static: 180 },
    // Tree-shake big barrel packages so a page ships only the icons/components it uses, not the whole
    // library. @phosphor-icons/react especially is thousands of modules imported by nearly every page.
    optimizePackageImports: ['@phosphor-icons/react', '@phosphor-icons/react/dist/ssr', 'recharts', 'date-fns'],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  async redirects() {
    return nextRedirects();
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
    // @react-pdf/renderer renders governance PDFs server-side (src/lib/reports/render.tsx). It ships
    // native yoga/wasm and reads public/logo.png off disk at render time — keep it out of the webpack
    // bundle so `next build` doesn't try to inline those and so the disk read resolves under next start.
    '@react-pdf/renderer',
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
