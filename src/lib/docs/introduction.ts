import type { DocSection } from './types';

export const introductionSection: DocSection = {
  id: 'introduction',
  label: 'Introduction',
  pages: [
    {
      slug: '',
      title: 'What is Off Grid AI Console',
      description: 'The one interface that makes your enterprise intelligent — models, data, and governance already set up and connected.',
      body: `Off Grid AI Console is the one interface that makes your enterprise intelligent. Everything you
need to run AI — access to models, evals, guardrails, PII masking, data pipelines, audit, lineage,
knowledge bases — is already set up and connected. You define your organization's rules, policies,
and knowledge once, and everyone builds on top of them, inside the rules. It just works.

Think of it as AWS for AI. AWS meant you stopped racking servers to ship software; Off Grid AI means
you stop assembling AI infrastructure to ship intelligence. No stitching together a router here, a
vector store there, a PII scanner, an eval harness, and an audit log — and praying they agree. It's
one platform, wired together, that you configure once.

![The Off Grid AI Console home — health, governance posture, spend, and activity at a glance](/docs-shots/overview.png)

## What you get

- **AI, everywhere, already governed.** Chat, projects, apps, and agents draw on your models and your
  knowledge — and every one of them runs inside the same rules you set once. No per-team reinvention.
- **Your data, made answerable.** Connect core systems, upload documents, and ask questions in plain
  language. Every answer cites the source it came from.
- **The rules are set once, then reused.** Policy, PII masking, access control, quality bars, and a
  tamper-evident audit trail are defined at the org level and inherited by everything built on top —
  so a new app is governed the moment it exists, without anyone re-doing the work.
- **One surface to run it all.** Models, agents, image generation, evals, cost, drift, lineage, and
  fleet management, in one console instead of a dozen contracts.

## Who it's for

Off Grid AI is how a whole organization runs AI — not just its engineers. A non-technical person in
tax, accounting, or operations can describe what they need in plain language and get a working,
governed workflow, tested in a sandbox first. Around them, four people keep it running: the platform
team keeping it fast and cheap, the compliance officer who has to defend it to a regulator, the
builder shipping AI features, and the finance owner watching the spend. Each gets a surface built for
their job, over the same shared foundation.

## The flow

Everything moves along one path: your **data** feeds a **gateway** to models, requests run through
governed **pipelines**, those power **agents and apps** people actually use, and every step is held to
your **compliance and regulatory** rules. Set that path up once and it carries every use-case you add.

## Runs where you need it

Off Grid AI can run on your own servers or in your own cloud — deployment is flexible, and you choose
what fits. The point isn't where it runs; the point is that the whole AI stack is already assembled,
connected, and governed, so your organization ships intelligence instead of building plumbing.

Ready to try it? Start with the [Quickstart](/docs/quickstart).`,
    },
    {
      slug: 'quickstart',
      title: 'Quickstart',
      description: 'From sign-in to your first grounded answer in a few minutes.',
      body: `This gets you from sign-in to a working, grounded answer. It assumes an Off Grid AI Console is
already deployed for your org (if not, see [Self-hosting](/docs/self-hosting/deployment)).

## 1. Sign in

Open your console (e.g. \`https://console.yourorg.com\`) and sign in with your work account. Access
is managed through your identity provider — Google, Microsoft, or your own SSO — so you use the login
you already have. No account yet? Ask your admin, or book a call from the sign-in screen.

## 2. Ask something

Open **Chat**, pick a model, and ask a question. The answer runs through a governed pipeline — the
footer shows which one — so it's already subject to your org's policy and guardrails without you
setting anything up. This is AI, everywhere, inside the rules.

![Chat — a governed, grounded answer routed through your org's pipeline](/docs-shots/chat.png)

## 3. Give it your knowledge

Go to **Knowledge** and upload a document (a policy PDF, an SOP, a spec). Off Grid AI indexes it so
your models can retrieve it. Back in Chat, ask a question the document answers; the reply now cites the
source, and it won't invent facts beyond what it retrieved.

![Knowledge — upload a document and Off Grid AI indexes it for cited answers](/docs-shots/knowledge.png)

## 4. Build an assistant

Open **Studio → New assistant**. Describe what you want in plain language ("answer HR policy
questions and cite the policy"). Off Grid AI suggests the setup, you pick any skills, and you try it
right there. Publish it to your team.

![Studio — describe an assistant in plain language and publish it to your team](/docs-shots/studio.png)

## 5. Generate an image

In Chat, pick an image model from the model list and describe what you want. The image is generated
through the same governed path and saved to your storage.

That's the loop: ask, ground, build, generate — each running on the same shared, governed foundation.
The guides go capability by capability from here.`,
    },
    {
      slug: 'how-to',
      title: 'How to…',
      description: 'The tasks operators do most, each in a few steps.',
      body: `A task-oriented index. Pick what you need to get done; each links to the full guide.

## Run and answer

- **Ask a grounded question.** Upload a doc in [Knowledge](/docs/guides/knowledge), turn grounding on
  in [Chat](/docs/guides/chat), ask. The reply cites the source.
- **Publish an assistant for your team.** [Studio → New assistant](/docs/guides/studio), describe it,
  pick knowledge and skills, try it, publish to your org or a shareable link.
- **Watch a run's full pipeline.** Open an [agent](/docs/guides/agents), run it, and read the
  [run trace](/docs/guides/agent-runs): policy, guard, retrieve, answer, ground, sign, stage by stage.

## Govern and prove

- **Set a routing rule everything obeys.** In [Control](/docs/guides/control), add a rule like
  \`data_class = PII → keep on the approved model\` so sensitive requests always route where you decided.
  Test it with the routing tester before you commit it.
- **Catch and mask PII.** Turn on entity-grade PII detection, then test a string on the
  [Guardrails](/docs/guides/guardrails) page to see the live redaction.
- **Restrict who can do what.** Add rules on the [Policy](/docs/guides/policy) page; deny wins.
- **Hand a regulator a report.** Generate a signed compliance export in
  [Regulatory](/docs/guides/regulatory); it cites the audit trail and eval evidence.
- **Answer "who did what, when."** Search the [Audit](/docs/guides/audit) ledger or filter the
  [Security events](/docs/guides/security-events) stream.

## Operate the platform

- **Add or drain a model node.** Register it in [Fleet](/docs/guides/fleet), assign a model, enable
  it; disable to drain for maintenance.
- **Check every service is healthy.** The [Services](/docs/guides/services) directory shows live,
  server-probed health for the console, gateway, and every backend.
- **Set a team's budget.** Create a virtual key and a monthly limit in [FinOps](/docs/guides/finops);
  a completion checks the budget before it runs.
- **Connect a system of record.** Add a connector in [Data](/docs/guides/data), point it at an
  endpoint, sync. Real row counts, no fabricated data.
- **Back up the control plane.** Run a backup on demand or verify the schedule in
  [Backups](/docs/guides/backups).`,
    },
    {
      slug: 'why-off-grid',
      title: 'Why Off Grid AI Console',
      description: 'Why one already-connected platform beats assembling a pile of AI point tools yourself.',
      body: `The AI-infrastructure market is a pile of point tools: one product to route model calls,
another to trace them, another to test them, another to police them, another to reach your internal
data. Each is a separate contract, a separate integration, and one more seam where the pieces disagree.
Wiring them into something an enterprise can actually run — and keep running — is a project that never
ends.

Off Grid AI Console is that whole stack, already assembled and connected, as one platform.

![One control plane — routing, policy, quality, and audit governed from a single room](/docs-shots/control.png)

## AWS for AI

AWS meant you stopped assembling servers to ship software — the infrastructure was already there,
connected, and ready. Off Grid AI is the same shift for AI: you stop assembling AI infrastructure. The
model gateway, the pipelines, the guardrails, the evals, the data connectors, the audit and lineage —
all present and wired together from day one. You don't integrate them; you configure them.

## Set the rules once, everyone builds inside them

This is the core idea. You define your organization's rules, policies, guardrails, and knowledge
**once**, at the org level — and everything anyone builds on top inherits them automatically. A new
app is governed the moment it exists. A team can't accidentally ship an ungoverned path, because there
isn't one. The gateway knows about the policy, the policy knows about the PII masking, the verdict
lands in the same audit trail, retrieval respects the same access rules as chat, and every token's
cost is attributed back to the team that spent it. One control plane, one identity model, one audit
ledger. It just works.

## It makes the whole enterprise intelligent — not just its engineers

Because the foundation is set once and shared, the people who build on it don't have to be technical.
Someone in tax, accounting, or operations describes what they need in plain language and gets a
working, governed workflow, tested in a sandbox first. That's the payoff of a platform over a pile of
tools: the hard parts are already solved, so the reach of AI is the whole organization, not the
handful of people who could otherwise wire the plumbing.

## Runs where you need it

Off Grid AI can run on your own servers or in your own cloud — deployment is flexible, and that
flexibility is a convenience, not the pitch. Regulated buyers get a platform they can defend to a
regulator because governance is built into the foundation, wherever it runs; and the platform is
**open source**, so anyone can inspect and trust exactly how it works.`,
    },
  ],
};
