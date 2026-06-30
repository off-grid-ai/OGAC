/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native / vendored-binary packages — keep them out of the webpack bundle (require at runtime).
  // c2pa-node ships a native binding + a vendored sharp; sigstore is required server-side only.
  serverExternalPackages: ['@lancedb/lancedb', 'c2pa-node', 'sigstore'],
  // Stable build id so the multiple console instances behind the edge LB produce identical
  // asset hashes — otherwise /_next/static/* 404s when a request lands on the other instance.
  generateBuildId: () => process.env.OFFGRID_BUILD_ID ?? 'offgrid-onprem',
};

export default nextConfig;
