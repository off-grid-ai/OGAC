import type { DocSection } from './types';

export const conceptsSection: DocSection = {
  id: 'concepts',
  label: 'Core concepts',
  pages: [
    {
      slug: 'concepts/architecture',
      title: 'Architecture',
      description: 'The two intelligence flows and the governance spine between them.',
      body: `Off Grid has a simple shape: two flows of intelligence, with a governance spine between them.

## Harness the intelligence inside your org

Your data lives in systems that can't answer questions. Off Grid changes that:

- **Connectors** pull from your systems of record (databases, warehouses, CRM, event streams).
- **Ingestion** chunks and embeds content on your own hardware into a vector store.
- **Retrieval** finds the relevant sources for a question, respecting who is allowed to see what.
- **Grounded answers** cite the exact source, so a person or an auditor can verify them.

## Leverage the intelligence outside your org

One OpenAI-compatible gateway fronts every model: open-weight models on your own nodes, and, when
your policy permits, cloud models. The gateway is the single place model traffic flows through, so
it's the single place to route, cache, rate-limit, and cost it.

## The governance spine

Every request passes through the same controls: policy, guardrails, identity, secrets, and a
tamper-evident audit trail. The master switch is egress: a request tagged as sensitive data cannot
route to a cloud model when egress is off, no matter who asks. The default is deny.

The point is the integration. The gateway that reaches the outside world enforces the same policies
that protect the inside world, and writes to the same audit trail either way. One control plane,
one identity model, one record.`,
    },
    {
      slug: 'concepts/governed-pipeline',
      title: 'The governed pipeline',
      description: 'Every model call runs the same path: policy, guardrails, retrieval, grounding, provenance.',
      body: `Every governed request — a chat turn, an agent run — runs the same path. You can watch it
happen on any agent run.

1. **Policy** — an attribute-based check decides whether the request is allowed. A matching deny
   rule stops it here.
2. **Guardrails (input)** — the prompt is scanned for PII and injection before it moves. A blocked
   verdict refuses the request; the regex floor is always on, with Presidio for entity-grade
   detection when configured.
3. **Retrieve** — for a grounded request, the relevant sources are pulled from your knowledge, with
   their provenance references.
4. **Answer** — the model composes a reply from the retrieved sources.
5. **Ground** — the answer is verified against the sources, producing citations.
6. **Guardrails (output)** — the reply is scanned before it leaves.
7. **Audit + provenance** — the whole turn is recorded (model, tokens, whether data left the box,
   which guardrails fired, the cost key) and can be signed.

Nothing opts out of this. A custom agent you build runs the same pipeline as the built-ins, so it
inherits every rule you've set. That is why an answer here is defensible: you can show exactly what
was checked, what was retrieved, and where the answer came from.`,
    },
    {
      slug: 'concepts/modules',
      title: 'Modules',
      description: 'The console is modular — adopt the whole control plane or just one part.',
      body: `Off Grid is organized into modules, each an independently adoptable capability. A
deployment enables the set you bought; the console shows only those.

## Grouped by job

- **Workspace** — where people use AI: Chat, Projects, Artifacts, Prompts, Knowledge, Storage,
  Studio.
- **Intelligence** — Agents, Agent runs, Brain, Evals, Sandbox.
- **Gateway & Fleet** — the model gateway, the nodes that serve models, and the network edge.
- **Data** — connectors, ingestion, retrieval, and lineage.
- **Governance** — policy, guardrails, access, secrets, regulatory, provenance.
- **Insights** — observability, analytics, cost, drift, security events.
- **Operations** — backups, configuration, API docs, admin.

## API-first

Every module is API-first: it works headless, with the console as an optional UI over it. That's
what lets you take just the gateway, just the data plane, or the whole control plane, and add the
rest when you're ready.`,
    },
    {
      slug: 'concepts/multi-tenancy',
      title: 'Multi-tenancy & isolation',
      description: 'How one deployment serves many orgs without one ever seeing another’s data.',
      body: `One Off Grid deployment can serve several organizations at once, each fully walled off from
the others. The point of isolation is simple: a valid login for one org must never return another
org's chats, runs, connectors, or audit records — not by accident, not by a crafted request.

## The isolation model

- **One realm, an org claim per user.** Everyone signs in through the same identity provider; each
  user's token carries the org they belong to. The console reads that claim on every request.
- **An org column on every tenant-scoped table.** Chats, agent runs, connectors, routing rules,
  studio templates, provit repos, and the rest each carry an \`org_id\`. Every query is filtered to
  the caller's org at one seam, not re-implemented per route.
- **Files namespaced by org.** Objects in your store are pathed by org, so a presigned URL is scoped
  to the org that owns the file.

## The database backstop

Filtering in the query layer is the primary control; a defense-in-depth backstop sits behind it in
the database itself. Postgres row-level security policies on the tenant-scoped tables enforce the
same \`org_id\` boundary, so even a query that forgot the filter still can't cross orgs.

The backstop is deliberately a no-op until you opt in: it activates only when the app sets the
current-org session variable and connects as a non-superuser role, so switching it on changes nothing
you can see on day one — it only removes the last way isolation could be bypassed. Turning it on is an
operational step for a shared deployment, documented for your platform team.

## Single-tenant is just one org

A deployment for one organization is the same code with a single org — nothing about the model is
bolted on later. Everything an org owns ([backups](/docs/guides/backups) included) is scoped by the
same boundary, so growing from one org to many is a switch, not a migration.`,
    },
    {
      slug: 'concepts/data-sovereignty',
      title: 'Data sovereignty',
      description: 'Where your data lives, and what it takes to keep it that way.',
      body: `Sovereignty here is not a setting — it's where the software runs and how the boundaries are
enforced.

## What stays on your infrastructure

- **Prompts and answers** — chat and agent traffic is served by your gateway nodes.
- **Documents and embeddings** — indexed in your own vector store, embedded by a model on your own
  hardware. No embedding service, no content sent out.
- **The audit trail** — your record, in your database.

## The egress boundary

The one way data can leave is a cloud-model call, and that is gated. Egress is off by default; a
routing rule can only send a request to a cloud model when egress is on, and a rule like
\`data_class = PII → block\` forces sensitive data to stay regardless. Every allowed egress is
logged and attributable.

## Air-gapped

Because everything runs on your infrastructure and cloud is opt-in, Off Grid can run fully
air-gapped: no outbound path at all. In that mode, only local models serve requests, and the
platform works the same — the governance, retrieval, and audit are all local.`,
    },
  ],
};
