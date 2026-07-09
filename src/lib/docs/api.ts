import type { DocSection } from './types';

export const apiSection: DocSection = {
  id: 'api',
  label: 'API & SDKs',
  pages: [
    {
      slug: 'api/overview',
      title: 'API overview',
      description: 'One authed API surface over the whole platform.',
      body: `Everything the console does is available through one authed API surface, so you can build
on the platform without touching the UI. There are three families:

![The gateway — one OpenAI-compatible endpoint every model call flows through, on your own nodes](/docs-shots/gateway.png)

- **Model API** (\`/v1/*\`) — OpenAI-compatible chat, embeddings, and images, served by your gateway.
- **Console API** (\`/api/v1/*\`) — the platform's own routes (connectors, agents, policy, flags,
  and everything else the console manages).
- **Service specs** (\`/specs/*\`) — the OpenAPI documents of the underlying services, proxied
  through one origin.

## The interactive reference

The full OpenAPI reference, with an inline playground for safe calls, is at
[/docs/api](/docs/api). Specs for the underlying services are browsable together from **API docs &
playground** in the console.

## One public surface

The unified API gateway (\`console-api.<your-domain>\`) serves all three families from a single
origin, with CORS for cross-origin apps. See [Authentication](/docs/api/authentication) to get a
token.`,
    },
    {
      slug: 'api/authentication',
      title: 'Authentication',
      description: 'Bearer tokens for machines, sessions for the browser.',
      body: `API calls authenticate two ways.

## Machine clients (bearer token)

For scripts, services, and SDKs, create a **machine client** under **Governance → Access**. It
issues a bearer token via the client-credentials grant, scoped to the services you tick. Send it as
a header:

\`\`\`
Authorization: Bearer <your-token>
\`\`\`

Scope a client to only the services it needs, and rotate its secret from the same surface.

## Browser sessions

In the console, your SSO session authorizes API calls automatically — no token handling in the
browser.

## CORS

The public API (\`/api/v1/*\`) sends permissive CORS so browser apps on other origins can call it
with a bearer token. Cookie-authenticated (session) routes are not exposed cross-origin, so your
session surfaces stay protected.`,
    },
    {
      slug: 'api/chat',
      title: 'Chat completions',
      description: 'OpenAI-compatible chat — point any OpenAI SDK at your gateway.',
      body: `The model endpoint is OpenAI-compatible, so existing OpenAI SDKs work by pointing their
base URL at your gateway and using your token.

## curl

\`\`\`bash
curl https://console-api.your-domain.com/v1/chat/completions \\
  -H "Authorization: Bearer $OFFGRID_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemma-4-e4b",
    "messages": [{"role": "user", "content": "Summarize our refund policy."}]
  }'
\`\`\`

## Python (OpenAI SDK)

\`\`\`python
from openai import OpenAI

client = OpenAI(
    base_url="https://console-api.your-domain.com/v1",
    api_key="OFFGRID_TOKEN",
)
resp = client.chat.completions.create(
    model="gemma-4-e4b",
    messages=[{"role": "user", "content": "Summarize our refund policy."}],
)
print(resp.choices[0].message.content)
\`\`\`

## Node (OpenAI SDK)

\`\`\`js
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://console-api.your-domain.com/v1',
  apiKey: process.env.OFFGRID_TOKEN,
});
const resp = await client.chat.completions.create({
  model: 'gemma-4-e4b',
  messages: [{ role: 'user', content: 'Summarize our refund policy.' }],
});
console.log(resp.choices[0].message.content);
\`\`\`

Which model you can use, and whether a request may reach a cloud model, is governed by your routing
rules — the gateway picks an enabled node for the model and returns the completion unchanged.`,
    },
    {
      slug: 'api/embeddings',
      title: 'Embeddings',
      description: 'Vectorize text on your own hardware.',
      body: `Embeddings are OpenAI-compatible and served by a model on your own gateway — no embedding
service, no text sent out.

\`\`\`bash
curl https://console-api.your-domain.com/v1/embeddings \\
  -H "Authorization: Bearer $OFFGRID_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "embed", "input": "text to embed"}'
\`\`\`

The console uses this same endpoint internally to index your knowledge, so anything you embed for
your own app is vectorized exactly the way retrieval expects.`,
    },
    {
      slug: 'api/images',
      title: 'Images',
      description: 'Generate images through the OpenAI-compatible endpoint.',
      body: `Image generation is OpenAI-compatible and served by your image gateway node.

\`\`\`bash
curl https://console-api.your-domain.com/v1/images/generations \\
  -H "Authorization: Bearer $OFFGRID_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "a red fox in a snowy forest", "width": 768, "height": 768, "steps": 20}'
\`\`\`

The console's Image generation in Chat calls this same route, then stores the result in your object
store. The prompt and the image never leave your infrastructure.`,
    },
    {
      slug: 'api/service-specs',
      title: 'Service specs',
      description: 'Every underlying service’s OpenAPI, through one origin.',
      body: `Each integrated service publishes its own OpenAPI document. Off Grid AI proxies them through
one authed origin so you can browse them together without CORS or LAN issues.

- \`/specs/<service>\` returns that service's OpenAPI JSON. The service token names the underlying
  capability — e.g. the vector store, tracing store, secrets store, data lineage, dashboards,
  feature flags, PII detection, and device management. The full set of available tokens is listed on
  the [API docs & playground](/operations/api-docs) page.
- The console (\`/openapi.json\`) is the platform's own spec, rendered interactively at
  [/docs/api](/docs/api).

An unreachable service reports its status rather than failing, so the spec browser always loads.`,
    },
    {
      slug: 'api/sdks',
      title: 'SDKs',
      description: 'Use the OpenAI SDKs today; a first-party SDK is on the roadmap.',
      body: `Because the model API is OpenAI-compatible, the official **OpenAI SDKs** (Python, Node,
and others) work today — point the base URL at your gateway and use a machine-client token, as in
[Chat completions](/docs/api/chat).

For the console API (connectors, agents, policy, and the rest), call the REST routes directly with a
bearer token; the [interactive reference](/docs/api) documents every one.

A first-party Off Grid AI SDK that wraps both surfaces is on the roadmap.`,
    },
  ],
};
