/** @type {import('next').NextConfig} */
const nextConfig = {
  // LanceDB ships a native binary — keep it out of the webpack bundle.
  serverExternalPackages: ['@lancedb/lancedb'],
};

export default nextConfig;
