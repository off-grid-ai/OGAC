/** @type {import('next').NextConfig} */
const nextConfig = {
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
