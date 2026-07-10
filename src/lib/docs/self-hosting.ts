import type { DocSection } from './types';

export const selfHostingSection: DocSection = {
  id: 'self-hosting',
  label: 'Self-hosting',
  pages: [
    {
      slug: 'self-hosting/getting-started',
      title: 'Getting started',
      description: 'Clone, bring up the stack, run the console.',
      body: `Off Grid AI is one interface with everything already set up and connected - you stand up
your own instance and set your org's rules once. Getting a local instance running is three steps.

## 1. Clone and configure

Copy the example environment file and fill in the values you need:

\`\`\`bash
git clone <your-repo-url> off-grid-ai
cd off-grid-ai/console
cp .env.example .env.local
\`\`\`

The defaults in \`.env.example\` work out of the box for local development - a Postgres URL, an SSO
placeholder, and a gateway URL. See [Configuration](/docs/self-hosting/configuration) for what each
group does and how to swap a backend.

## 2. Bring up the stack

The supporting services (Postgres, object storage, secrets, identity) run from the \`deploy/\`
directory. Start what you need:

\`\`\`bash
cd deploy && make up        # full stack
# or a subset:
make data                   # Postgres + object storage
make secrets                # secrets store only
make identity               # self-hosted SSO only
\`\`\`

Then push the database schema:

\`\`\`bash
cd ../console && npm run db:push
\`\`\`

## 3. Run the console

\`\`\`bash
npm run dev                 # dev server on :3000
# or a production build:
npm run build && npm start
\`\`\`

Open the console, sign in, and everything is wired: the model gateway, retrieval, policy, secrets,
and audit are all reachable through one surface. Connect a [data source](/docs/integrations/catalog)
and set your [routing rules](/docs/guides/policy) once - from there it just works.`,
    },
    {
      slug: 'self-hosting/deployment',
      title: 'Deployment',
      description: 'The shape of an Off Grid AI deployment on your own servers or your cloud.',
      body: `Off Grid AI runs wherever you run it - your own servers or your cloud account. The
topology is the same either way: one interface with everything set up and connected. A deployment
has three kinds of machine:

- **Control plane** - the console, identity, database, object storage, and the model aggregator.
- **Gateway nodes** - the machines that run the models (chat, vision, and image). Add or drain nodes
  from the [AI Gateway](/docs/guides/gateway).

![The AI Gateway - the nodes that serve your models, their roles, and enable or drain each one](/docs-shots/gateway.png)

- **Auxiliary services** - observability, feature flags, PII detection, and BI, each swappable behind
  a capability port.

## Edge

A reverse proxy (Caddy) fronts the public subdomains, and an outbound tunnel exposes them without
opening inbound ports - so the platform is reachable even as the network's public IP changes. The
model API, the console, and the docs are each served through it.

## Self-contained by default

The platform doesn't depend on any hosted Off Grid AI service to run - governance, retrieval, and
audit all live inside your deployment. Point routing at only the models in your own pool and it runs
with no outbound path at all; open cloud egress and the same rules govern which requests may reach a
cloud model. You set that once, for the whole org, and it applies everywhere.

This page is a map; the exact host list and network layout are specific to your deployment.`,
    },
    {
      slug: 'self-hosting/configuration',
      title: 'Configuration',
      description: 'Swap any backend with one environment variable.',
      body: `Every capability is reached through a port, so you configure the platform by choosing
implementations, not by changing code.

## Adapters

Set an adapter with an environment variable and the console uses it, falling back to the first-party
default if it's unreachable:

- Policy → a policy engine (e.g. OPA), Guardrails → PII detection (e.g. Presidio), Secrets → a
  secrets store (e.g. OpenBao), Retrieval → a vector store (e.g. Qdrant), Observability → a tracing
  store (e.g. Langfuse), Flags → feature flags (e.g. Unleash), and so on.

Because the fallback is always there, turning an integration on is never a hard dependency: if the
service is down, the platform keeps working on the built-in floor.

## Feature flags

Capabilities can be gated by runtime feature flags, managed on the **Configuration** page (create,
toggle, delete) - no redeploy to flip one. A deployment can also open all gates at once for a
demo/eval instance.

## One identity across every service

By default, cross-service calls are brokered through the console: it verifies your identity, checks
[policy](/docs/guides/policy), then talks to the backend with a per-service credential held in the
[secrets](/docs/guides/secrets) vault, and the no-auth backends are reachable only from the console
host. So a single credential - your SSO login or a machine client - already governs the whole
platform, with no per-service keys to hand out.

Some backends (for example the audit/search index) can additionally validate an identity-provider
token themselves. When you want a service to check identity directly rather than trust the console
broker, enable its native OIDC path: register a client for it in your identity provider, point it at
your realm, and turn its security on. It is an
opt-in operational step - the brokered path keeps working until you flip it - so you can move to
direct-service validation one service at a time, no flag day. Your platform team's runbook holds the
exact per-service settings.`,
    },
    {
      slug: 'self-hosting/scaling',
      title: 'Scaling & HA',
      description: 'Add capacity by adding nodes; drain without downtime.',
      body: `Scale the model tier by adding gateway nodes. The aggregator round-robins across the
enabled nodes for a given model, so more nodes means more throughput without config changes beyond
registering them on the [AI Gateway](/docs/guides/gateway).

![Scale by adding nodes - the aggregator round-robins the enabled nodes for a model](/docs-shots/gateway.png)

- **Add capacity** - register a node, assign it a model, enable it. It joins the routing pool.
- **Drain** - disable a node to take it out of rotation for maintenance without removing it.
- **Roles** - dedicate nodes to chat, vision, or image so one workload never starves another.

The control plane and its data have their own backup and recovery path; see
[Backups](/docs/guides/backups).`,
    },
  ],
};
