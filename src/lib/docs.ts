// Product documentation — the content model behind /docs. Pages are plain markdown (rendered with
// react-markdown), grouped into sidebar sections. Adding a page = one entry here. Copy follows the
// brand guides (brand/): lead with the outcome, speak to "you", proof over adjectives, no em dashes,
// no AI-slop vocabulary.

export interface DocPage {
  slug: string; // path under /docs (e.g. 'quickstart', 'guides/chat')
  title: string;
  description: string; // one line, shown under the title + in search
  body: string; // markdown
}

export interface DocSection {
  id: string;
  label: string;
  pages: DocPage[];
}

export const DOC_SECTIONS: DocSection[] = [
  {
    id: 'introduction',
    label: 'Introduction',
    pages: [
      {
        slug: '',
        title: 'What is Off Grid',
        description: 'Your organization’s private AI platform — models, data, and governance on your own hardware.',
        body: `Off Grid is your organization's private AI platform. You run capable models on your own
hardware, connect your own data, and put every request under your own governance. Nothing leaves
your infrastructure unless you allow it.

Most AI platforms make you choose: the frontier models, or your data staying private. Off Grid
removes the trade-off. The intelligence *inside* your org (your documents, systems, and knowledge)
and the intelligence *outside* it (open-weight and, when you permit it, cloud models) meet on one
control plane that you own.

## What you get

- **A private ChatGPT for your org.** Chat, projects, and knowledge, answered by models running on
  your own gateways. No per-seat cost, no prompts sent to a vendor.
- **Your data, made answerable.** Connect core systems, upload documents, and ask questions in plain
  language. Every answer cites the source it came from.
- **Governed by default.** Policy, PII masking, access control, and a tamper-evident audit trail sit
  in front of every request. A request only reaches a cloud model if your rules allow it; the default
  is deny.
- **One surface to run it all.** Agents, image generation, evals, cost, drift, lineage, and fleet
  management — the whole estate in one console.

## Who it's for

Off Grid runs the AI operations for a regulated organization. It serves four people: the platform
team keeping it fast and cheap, the compliance officer who has to defend it to a regulator, the
builder shipping AI features, and the finance owner watching the spend. Each gets a surface built
for their job.

## On your infrastructure

Everything runs on hardware you control — on-prem or in your own cloud. The models run on your
gateway nodes. Your documents are indexed in your own vector store. The audit log is your record.
When a request is allowed out to a cloud model, that decision is logged and attributable. This is
not a privacy promise laid over someone else's servers; it is where the software runs.

Ready to try it? Start with the [Quickstart](/docs/quickstart).`,
      },
      {
        slug: 'quickstart',
        title: 'Quickstart',
        description: 'From sign-in to your first grounded answer in a few minutes.',
        body: `This gets you from sign-in to a working, grounded answer. It assumes an Off Grid Console is
already deployed for your org (if not, see [Self-hosting](/docs/self-hosting)).

## 1. Sign in

Open your console (e.g. \`https://console.yourorg.com\`) and sign in with your work account. Access
is managed through your identity provider — Google, Microsoft, or Keycloak — so you use the login
you already have. Don't have an account yet? Ask your admin, or book a call from the sign-in screen.

## 2. Ask something

Open **Chat**, pick a model, and ask a question. The answer is generated on your own gateway — the
footer confirms it: *runs on your on-prem gateways, nothing leaves your network*. This is your
private ChatGPT.

## 3. Give it your knowledge

Go to **Knowledge** and upload a document (a policy PDF, an SOP, a spec). Off Grid chunks and indexes
it on your own hardware. Back in Chat, ask a question the document answers — the reply now cites the
source, and it won't invent facts beyond what it retrieved.

## 4. Build an assistant

Open **Studio → New assistant**. Describe what you want in plain language ("answer HR policy
questions and cite the policy"). Off Grid suggests the setup, you pick any skills, and you try it
right there. Publish it to your team.

## 5. Generate an image

In Chat, pick an image model from the model list and describe what you want. The image is rendered
on your own image gateway and saved to your storage.

That's the loop: ask, ground, build, generate — all on your infrastructure. The rest of these docs
go capability by capability.`,
      },
    ],
  },
  {
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
- **Grounded answers** cite the exact source, so a person — or an auditor — can verify them.

## Leverage the intelligence outside your org

One OpenAI-compatible gateway fronts every model: open-weight models on your own nodes, and, when
your policy permits, cloud models. The gateway is the single place model traffic flows through, so
it's the single place to route, cache, rate-limit, and cost it.

## The governance spine

Every request passes through the same controls: policy (who and what is allowed), guardrails (PII
detection and masking), identity, secrets, and a tamper-evident audit trail. The master switch is
egress: a request tagged as sensitive data physically cannot route to a cloud model when egress is
off, no matter who asks. The default is deny.

The point is the integration. The gateway that reaches the outside world enforces the same policies
that protect the inside world, and writes to the same audit trail either way. One control plane, one
identity model, one record.`,
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
    ],
  },
  {
    id: 'guides',
    label: 'Capabilities',
    pages: [
      {
        slug: 'guides/chat',
        title: 'Chat',
        description: 'Your private ChatGPT — grounded, governed, and answered on your own hardware.',
        body: `Chat is your org's private assistant. It streams from your own gateways, so prompts and
answers stay on your network.

## What it does

- **Models on your hardware.** Pick a model from the picker; the answer is generated on your gateway
  nodes. Vision models read images; image models generate them (see below).
- **Projects.** Group related chats under shared instructions and a knowledgebase — a workspace per
  topic.
- **Knowledge grounding.** With grounding on, the assistant answers only from your uploaded
  documents and cites them, so it won't invent facts.
- **Skills and tools.** Type \`/\` to invoke a skill, or give an agent tools so it can act, not just
  talk.

## Message actions

Stop a running answer mid-stream, retry a turn (same or different model), edit a previous message
and branch the conversation, and copy or rate any reply. Failed turns show the reason inline with a
one-click retry, and your prompt is never lost.

## Images in chat

Pick an image model from the model list and the composer switches to image generation — describe
what you want and the image renders in the thread, saved to your storage. It runs on your own image
gateway; nothing leaves the box.

## Artifacts

Generated HTML, SVG, React, and diagrams are saved as artifacts you can reopen, edit in place with a
live preview, and roll back to a prior version.`,
      },
      {
        slug: 'guides/knowledge',
        title: 'Knowledge & retrieval',
        description: 'Turn your documents and systems into grounded, cited answers.',
        body: `Knowledge is how your own content becomes answerable. You upload documents or connect a
system; Off Grid indexes it on your hardware; Chat and agents answer from it with citations.

## Add knowledge

Upload files on the **Knowledge** page (PDFs, text, docs) or index a connected data source. Off Grid
chunks the content and embeds it using a model on your own gateway — no embedding service, no data
sent out. The vector store is yours (an embedded store by default, or your own Qdrant at scale).

## How grounding works

When a grounded assistant answers, it retrieves the most relevant chunks, composes an answer from
them, and verifies the answer against the sources. Every reply carries \`[Source: …]\` citations you
can click through. If the sources don't cover the question, the assistant says so rather than
inventing an answer.

## Manage it

The Knowledge and Retrieval surfaces let you add, list, and remove documents, inspect the vector
store, and reindex — the console is how you run it, not just view it.`,
      },
      {
        slug: 'guides/agents',
        title: 'Agents',
        description: 'Assistants that act — grounded, tool-using, and run through the governed pipeline.',
        body: `An agent is an assistant with a job and capabilities. You give it instructions, ground it in
your knowledge, and grant it tools; every run flows through the governed pipeline.

## Create one

On the **Agents** page, create an agent from plain-language instructions. Ground it in your
knowledge (on by default, so it cites sources and won't hallucinate) and grant it tools — the
connectors your org has set up. Each granted tool still obeys its action policy: allow, needs
approval, or blocked. Capability never bypasses governance.

## Run and watch it

Open an agent and run it. You see the full pipeline execute — policy, guardrails, retrieval, answer,
grounding, provenance — with the steps, guardrail verdicts, and citations shown inline. Re-run,
cancel, or send a run through human review.

## No special powers

A custom agent carries no special access. It runs the same governed path as the built-ins, so it
inherits every convention set on your console.`,
      },
      {
        slug: 'guides/studio',
        title: 'Studio',
        description: 'Build a working assistant in plain language — no technical setup.',
        body: `Studio is for the people who know the work but not the plumbing. You describe an assistant
in plain language and Studio wires the model, policy, guardrails, and grounding for you.

## The flow

1. **Describe** what the assistant should do. Off Grid can suggest a name, the relevant skills, and
   whether it should use your uploaded knowledge — inferred from your description.
2. **Pick skills** — the tools your org has set up.
3. **Choose knowledge** — whether it answers from your documents.
4. **Try it** right there, then **publish** — to just you, your whole org, or a shareable link.

None of the technical settings (model choice, sampling, token limits, embeddings) are exposed. They
are handled for you, under the same governance as everything else.`,
      },
      {
        slug: 'guides/gateway',
        title: 'AI Gateway & routing',
        description: 'One endpoint for every model, with the cloud on a leash.',
        body: `The gateway is the single, OpenAI-compatible endpoint every model call flows through —
open-weight models on your own nodes, and cloud models when your policy allows.

## Routing

For each request, the first matching routing rule (by priority) decides where it runs:

- **local** — an on-prem model. Data stays on the box.
- **cloud** — an external model, and only when cloud egress is ON.
- **block** — the request is refused.

## The egress leash

Egress is the master switch. A \`cloud\` rule is forced to **block** whenever egress is off — so a
rule like \`data_class = PII → block\` means customer data physically cannot route off-box, whatever
anyone asks. You can see the live egress state and test any request against your rules on the Control
page.

## What else it does

The gateway carries fallback, caching, rate limits, key management, per-model cost, and a live view
of which node served each call. Because everything flows through it, it's the one place to route,
observe, and cost your whole model estate.`,
      },
      {
        slug: 'guides/governance',
        title: 'Governance & compliance',
        description: 'Prove to a regulator that your AI is controlled.',
        body: `Governance is why regulated organizations choose Off Grid. It isn't a feature bolted on; it
is the path every request takes.

- **Policy** — attribute-based access, deny by default. Use the first-party engine or bring OPA.
- **Guardrails** — every prompt scanned for PII before it moves; a regex floor always on, Presidio
  for entity-grade detection and masking. A failure degrades safely; it never opens.
- **Access** — one identity model across every surface, through your IdP.
- **Secrets** — connector credentials and signing keys in a vault, not in code.
- **Audit** — a tamper-evident record of every completion: model, tokens, whether data left the box,
  which guardrails fired with what verdict, and the cost key. This is the artifact you hand a
  regulator.
- **Evals & drift** — golden-set tests and drift detection gate quality with evidence, not vibes.
- **Lineage & provenance** — trace a source to an answer, and sign answers and exported reports so
  they're verifiable after the fact.
- **Regulatory** — a governance registry and one-click compliance exports with citations.

Every one of these is a surface you operate, not a dashboard you watch.`,
      },
      {
        slug: 'guides/data',
        title: 'Data & connectors',
        description: 'Connect your systems of record and keep the data real.',
        body: `Connectors bring your systems of record into the platform. Off Grid ships connectors for
databases (Postgres, MySQL, MSSQL), object storage (S3), event streams (Kafka), and REST APIs.

## Manage connectors

On the **Integrations** page, add a connector (point it at an endpoint, choose an auth scheme), edit
it, trigger a sync, and see the ingest history — real row and document counts from the live source,
never fabricated. Delete removes it and its history.

## Real data only

A fresh deployment shows real or empty data — nothing invented. Sync counts come from the source;
metrics trace to real events. When a number can't be read, it's shown as unknown, not guessed.`,
      },
      {
        slug: 'guides/observability',
        title: 'Observability, cost & drift',
        description: 'Know your AI is healthy, safe, and what it costs.',
        body: `The Insights surfaces answer one question for the platform owner: is my AI healthy, safe,
and what is it costing?

- **Observability** — traces of every agent run and gateway call, with latency and error signals,
  read back from your own tracing store.
- **Analytics** — request volume, tokens, outcomes (clean, redacted, blocked), and latency
  percentiles from the real traffic log.
- **FinOps** — cost per model, team, and virtual key, with budgets and chargeback. Local models run
  at zero, so the on-prem dividend is visible.
- **Drift** — distribution shift and quality degradation against a baseline you can reset after a
  deliberate model change, with alert thresholds you set.
- **Security events** — the audit stream, searchable, with suppression rules to keep the feed
  signal.`,
      },
      {
        slug: 'guides/fleet',
        title: 'Fleet',
        description: 'Run the nodes and models that serve your AI.',
        body: `Fleet is how you run the hardware behind the platform. The \`fleet_nodes\` table is the
single source of truth for your topology; everything downstream is derived from it.

## What you manage

- **Nodes** — each gateway node, its role (chat, vision, image, server, spare), the model it serves,
  and whether it's enabled.
- **Models per node** — edit a node's model, context size, or enable/disable it from the console; the
  change saves to the database and is pushed to the node.
- **Routing pool** — the aggregator reads its routing pool from this source of truth, so the console
  is where you decide what the fleet looks like.`,
      },
    ],
  },
  {
    id: 'api',
    label: 'API',
    pages: [
      {
        slug: 'api/overview',
        title: 'API & SDKs',
        description: 'One authed API surface over the whole platform.',
        body: `Everything the console does is available through one authed API surface, so you can build
on the platform without touching the UI.

## The interactive reference

The full OpenAPI reference — every route, with an inline playground for safe calls — is at
[/docs/api](/docs/api). Specs for the underlying services (gateway, vector store, secrets,
observability, and more) are browsable together from **API docs & playground** in the console.

## Authentication

Calls authenticate with a machine-client bearer token (issued from **Access → Machine Clients**) or,
in the browser, your session. The model endpoint is OpenAI-compatible, so existing OpenAI SDKs work
by pointing their base URL at your gateway.

## One public surface

The unified API gateway serves the model API (\`/v1/*\`), the service specs (\`/specs/*\`), and the
console API (\`/api/*\`) from a single origin, with CORS for cross-origin apps. Bearer-token calls
work cross-origin; cookie-authenticated routes do not, so your session surfaces stay protected.`,
      },
    ],
  },
  {
    id: 'operate',
    label: 'Self-hosting',
    pages: [
      {
        slug: 'self-hosting',
        title: 'Self-hosting',
        description: 'It runs on your infrastructure. Here’s the shape of a deployment.',
        body: `Off Grid runs on hardware you control. A deployment has three kinds of machine:

- **Control plane** — the console, identity, database, object storage, and the model aggregator.
- **Gateway nodes** — the machines that run the models (chat, vision, and image). Add or drain nodes
  from the Fleet surface.
- **Auxiliary services** — observability, feature flags, PII detection, and BI, each swappable behind
  a capability port.

Every underlying service is reached through a capability port, so you can swap an implementation with
one environment variable — no code change. The console and the standalone gateway run the same host
code, so you can adopt the whole control plane or just the API.

This page is a map, not a runbook — your deployment's operational details live with your platform
team.`,
      },
    ],
  },
];

const ALL_PAGES: DocPage[] = DOC_SECTIONS.flatMap((s) => s.pages);

export function findDocBySlug(slug: string): DocPage | undefined {
  return ALL_PAGES.find((p) => p.slug === slug);
}

export function allDocSlugs(): string[] {
  return ALL_PAGES.map((p) => p.slug);
}

// Flat list for search / listings.
export function docIndex(): { slug: string; title: string; description: string; section: string }[] {
  return DOC_SECTIONS.flatMap((s) =>
    s.pages.map((p) => ({ slug: p.slug, title: p.title, description: p.description, section: s.label })),
  );
}
