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

// The vendored bundle still asks for Scalar's WEBFONTS from fonts.scalar.com, which our CSP blocks
// (`font-src 'self' data:`) — four console errors per page load, and on a genuinely air-gapped box four
// DNS lookups that go nowhere. Same defect class as the vendored script: the page must not reach out.
// Declaring the font stack up front means the @font-face requests are never made, and the reference reads
// in the console's own type (Menlo for code, system sans for prose) instead of a half-loaded Inter.
const FONT_OVERRIDE = `<style>
:root, .scalar-app, .scalar-api-reference {
  --scalar-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --scalar-font-code: Menlo, ui-monospace, SFMono-Regular, monospace;
}
</style>`;

// Scalar returns its OWN HTML document, so it never runs through the React root layout where
// <PostHog/> lives — this page would otherwise have no analytics. Inject the PostHog bootstrap into
// its <head> so /docs/api is measured like every other surface. (CSP already allows it.)
export async function GET(): Promise<Response> {
  const res = await scalar();
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('text/html')) return res;
  const html = await res.text();
  const injected = html.includes('</head>')
    ? html.replace('</head>', `${FONT_OVERRIDE}${posthogHeadTag()}</head>`)
    : html;
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(injected, { status: res.status, statusText: res.statusText, headers });
}
