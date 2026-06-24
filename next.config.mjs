/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native / vendored-binary packages — keep them out of the webpack bundle (require at runtime).
  // c2pa-node ships a native binding + a vendored sharp; sigstore is required server-side only.
  serverExternalPackages: ['@lancedb/lancedb', 'c2pa-node', 'sigstore'],
};

export default nextConfig;
