import type { DocSection } from './types';

export const conceptsSection: DocSection = {
  id: 'concepts',
  label: 'Core concepts',
  pages: [
    {
      slug: 'concepts/architecture',
      title: 'Architecture',
      description: 'One path from your data to a governed answer - set up once, reused by everything.',
      body: `Off Grid AI has a simple shape: one path that carries every use-case, with governance built
into the path rather than bolted onto each app. Data feeds a gateway to models, requests run through
governed pipelines, and everything is held to the rules you set once.

## Your data, made answerable

Your data lives in systems that can't answer questions. Off Grid AI changes that:

- **Connectors** pull from your systems of record (databases, warehouses, CRM, event streams).
- **Ingestion** prepares that content so your models can search it.
- **Retrieval** finds the relevant sources for a question, respecting who is allowed to see what.
- **Grounded answers** cite the exact source, so a person or an auditor can verify them.

## One gateway to every model

A single OpenAI-compatible gateway fronts every model your organization can reach - models running on
your own nodes, and, when your policy permits, cloud models. Because all model traffic flows through
one place, it's the one place to route, cache, rate-limit, and cost it. Nobody wires up a model
connection per app; they consume the gateway through a pipeline.

## Governance is in the path, not on each app

Every request passes through the same controls: policy, guardrails, identity, secrets, and a
tamper-evident audit trail. You define these **once** at the org level, and every consumer inherits
them - so a new app is governed the moment it exists. A routing rule you set (for example, keep
sensitive requests on an approved model) applies to every request, no matter who asks.

That's the point: the integration. The gateway enforces the same policies your data plane respects,
and writes to the same audit trail either way. One control plane, one identity model, one record -
set up once, reused by everything built on top.`,
    },
    {
      slug: 'concepts/governed-pipeline',
      title: 'The governed pipeline',
      description: 'Every model call runs the same path: policy, guardrails, retrieval, grounding, provenance.',
      body: `Every governed request - a chat turn, an agent run - runs the same path. You can watch it
happen on any agent run.

![An agent run trace - policy, guardrails, retrieval, answer, grounding, and provenance, stage by stage](/docs-shots/app-runs.png)

1. **Policy** - an attribute-based check decides whether the request is allowed. A matching deny
   rule stops it here.
2. **Guardrails (input)** - the prompt is scanned for PII and injection before it moves. A blocked
   verdict refuses the request; a baseline scan is always on, with entity-grade PII detection
   layered on when configured.
3. **Retrieve** - for a grounded request, the relevant sources are pulled from your knowledge, with
   their provenance references.
4. **Answer** - the model composes a reply from the retrieved sources.
5. **Ground** - the answer is verified against the sources, producing citations.
6. **Guardrails (output)** - the reply is scanned before it leaves.
7. **Audit + provenance** - the whole turn is recorded (model, tokens, which model answered, which
   guardrails fired, the cost key) and can be signed.

Nothing opts out of this. A custom agent you build runs the same pipeline as the built-ins, so it
inherits every rule you've set once - you don't re-govern each new thing. That is why an answer here
is defensible: you can show exactly what was checked, what was retrieved, and where the answer came
from.`,
    },
    {
      slug: 'concepts/pipelines-and-gateways',
      title: 'Gateways, pipelines, and consumers',
      description: 'The three tiers that make model access reusable and governed by default.',
      body: `Model access in Off Grid AI has three distinct tiers. Keeping them separate is what lets you
reuse governance instead of re-writing it for every app.

![Pipelines - reusable, governed model-access contracts, each bound to a gateway with a hard data ceiling](/docs-shots/pipelines-list.png)

## Gateways - the model backends

A **gateway** is a place requests go to be answered: a model cluster on your own nodes, or a cloud
provider you allow. It carries a class you can read at a glance - *on your own nodes* or *cloud* - and
its own health, so routing rules can key off it. Many pipelines can share one gateway; nobody wires a
model connection per app. See [Gateways](/docs/guides/gateways).

## Pipelines - the governed contract

A **pipeline** is the reusable, governed way to call models. It binds a gateway, sets routing and a
**hard data ceiling**, and layers policy, guardrails, and a quality bar on top. It is the chokepoint
every model call passes through, so it is also where quality, drift, cost, and audit are seen. See
[Pipelines](/docs/guides/pipelines).

## Consumers - apps, agents, chat, and external callers

**Apps, agents, and chat** don't call a model directly - they bind a pipeline as their "Runs on" and
inherit every control it carries. **External systems** call a pipeline over its own provisioned API
key. See [Binding & consuming a pipeline](/docs/guides/pipeline-binding).

## The run is the join key

Every request through a pipeline is a **run**, stamped with its pipeline, gateway, model, caller, and
cost. That's why the per-pipeline lenses (observability, audit, cost, drift) are honest: they are the
same run data, filtered to the pipeline. A gateway's totals are the sum of its pipelines; an app's are
the runs it made. Nothing is pre-aggregated, so every view agrees.`,
    },
    {
      slug: 'concepts/modules',
      title: 'Modules',
      description: 'The console is modular - adopt the whole control plane or just one part.',
      body: `Off Grid AI is organized into modules, each an independently adoptable capability. A
deployment enables the set you bought; the console shows only those.

![The console modules, grouped by job - workspace, intelligence, gateway, data, governance, and insights](/docs-shots/overview.png)

## Grouped by job

- **Workspace** - where people use AI: Chat, Projects, Artifacts, Prompts, Knowledge, Storage,
  Studio.
- **Intelligence** - Agents, Agent runs, Evals, Sandbox.
- **Gateway & nodes** - the model gateway, the nodes that serve models, and the network edge.
- **Data** - connectors, ingestion, retrieval, and lineage.
- **Governance** - policy, guardrails, access, secrets, regulatory, provenance.
- **Insights** - observability, analytics, cost, drift, security events.
- **Operations** - backups, configuration, API docs, admin.

## API-first

Every module is API-first: it works headless, with the console as an optional UI over it. That's
what lets you take just the gateway, just the data plane, or the whole control plane, and add the
rest when you're ready.`,
    },
    {
      slug: 'concepts/multi-tenancy',
      title: 'Multi-tenancy & isolation',
      description: 'How one deployment serves many orgs without one ever seeing another\'s data.',
      body: `One Off Grid AI deployment can serve several organizations at once, each fully walled off from
the others. The point of isolation is simple: a valid login for one org must never return another
org's chats, runs, connectors, or audit records - not by accident, not by a crafted request.

## The isolation model

- **One realm, an org claim per user.** Everyone signs in through the same identity provider; each
  user's token carries the org they belong to. The console reads that claim on every request.
- **An org tag on every tenant-scoped record.** Chats, agent runs, connectors, routing rules,
  studio templates, provenance records, and the rest each carry an \`org_id\`. Every query is filtered
  to the caller's org at one seam, not re-implemented per route.
- **Files namespaced by org.** Objects in your store are pathed by org, so a presigned URL is scoped
  to the org that owns the file.

## The database backstop

Filtering in the query layer is the primary control; a defense-in-depth backstop sits behind it in
the database itself. Row-level rules on the tenant-scoped tables enforce the same \`org_id\` boundary
at the storage layer, so even a query that forgot the filter still can't cross orgs.

The backstop is deliberately a no-op until you opt in: it activates only when the app sets the
current-org session variable and connects as a non-superuser role, so switching it on changes nothing
you can see on day one - it only removes the last way isolation could be bypassed. Turning it on is an
operational step for a shared deployment, documented for your platform team.

## Single-tenant is just one org

A deployment for one organization is the same code with a single org - nothing about the model is
bolted on later. Everything an org owns ([backups](/docs/guides/backups) included) is scoped by the
same boundary, so growing from one org to many is a switch, not a migration.`,
    },
    {
      slug: 'concepts/data-sovereignty',
      title: 'Where data can go, and who decides',
      description: 'A routing control you set once that governs where every request is allowed to run.',
      body: `Off Grid AI's differentiator is the platform itself - the whole AI stack, assembled and
governed, set up once. *Where* it runs is a deployment choice you make, and *where a given request is
allowed to go* is a rule you set once and everything obeys. This page is about that control, not a
privacy pitch: it's one more thing you configure at the org level instead of re-deciding per app.

## What runs on your side

You choose where the platform lives - your own servers or your own cloud. In either case:

- **Prompts and answers** run through your gateway.
- **Documents and their search index** live in your store, prepared by a model you run.
- **The audit trail** is your record, in your database.

## The routing control

Where a request may run is decided by a routing rule, set once at the org level. A rule like
\`data_class = PII → keep on the approved model\` means sensitive requests always route where you
decided, no matter who submits them or which app they came from. Cloud access is opt-in: a request
only reaches a cloud model when a rule allows it, and every such call is logged and attributable.

![The routing control - set once, applied to every request, whoever submits it](/docs-shots/control.png)

## Fully self-contained if you need it

Because you can run every model on your own nodes, Off Grid AI can operate with no outbound path at
all - useful for an isolated network. In that mode, only your own models serve requests, and the
platform works exactly the same: the governance, retrieval, evals, and audit are all present. The
capability is there when a use-case demands it; it isn't the reason to adopt the platform.`,
    },
  ],
};
