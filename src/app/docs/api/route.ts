import { ApiReference } from '@scalar/nextjs-api-reference';

// Interactive OpenAPI reference (Scalar) — the API section of the docs, at /docs/api.
// cdn: self-hosted standalone bundle in public/ (vendored @scalar/api-reference@1.62.4). The default
// loads it from cdn.jsdelivr.net, which (a) is blocked by our strict script-src CSP → "Scalar is not
// defined" blank page, and (b) violates the on-prem "nothing leaves the network" rule. Serving it
// from our own origin fixes both and keeps /docs/api working fully air-gapped.
export const GET = ApiReference({
  url: '/openapi.json',
  theme: 'default',
  cdn: '/scalar.standalone.js',
  // Brand the reference as Off Grid, not the default "Scalar API Reference" + globe favicon.
  // pageTitle → the browser tab + the in-app document header; favicon → the header icon (self-hosted
  // Off Grid mark in public/, air-gap-safe). metaData.title backs the document/OG title.
  pageTitle: 'Off Grid Console API',
  favicon: '/logo.png',
  metaData: { title: 'Off Grid Console API' },
});
