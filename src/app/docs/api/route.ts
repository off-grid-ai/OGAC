import { ApiReference } from '@scalar/nextjs-api-reference';
import { posthogHeadTag } from '@/lib/posthog-snippet';

// Interactive OpenAPI reference (Scalar) — the API section of the docs, at /docs/api.
// cdn: self-hosted standalone bundle in public/ (vendored @scalar/api-reference@1.62.4). The default
// loads it from cdn.jsdelivr.net, which (a) is blocked by our strict script-src CSP → "Scalar is not
// defined" blank page, and (b) violates the on-prem "nothing leaves the network" rule. Serving it
// from our own origin fixes both and keeps /docs/api working fully air-gapped.
const scalar = ApiReference({
  url: '/openapi.json',
  theme: 'default',
  cdn: '/scalar.standalone.js',
  // Brand the reference as Off Grid AI, not the default "Scalar API Reference" + globe favicon.
  // pageTitle → the browser tab + the in-app document header; favicon → the header icon (self-hosted
  // Off Grid AI mark in public/, air-gap-safe). metaData.title backs the document/OG title.
  pageTitle: 'Off Grid AI Console API',
  favicon: '/logo.png',
  metaData: { title: 'Off Grid AI Console API' },
});

// Scalar returns its OWN HTML document, so it never runs through the React root layout where
// <PostHog/> lives — this page would otherwise have no analytics. Inject the PostHog bootstrap into
// its <head> so /docs/api is measured like every other surface. (CSP already allows it.)
export async function GET(): Promise<Response> {
  const res = await scalar();
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('text/html')) return res;
  const html = await res.text();
  const injected = html.includes('</head>')
    ? html.replace('</head>', `${posthogHeadTag()}</head>`)
    : html;
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(injected, { status: res.status, statusText: res.statusText, headers });
}
